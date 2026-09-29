#include "transcriptionservice.h"

#include "lyricsparser.h"

#include <QAudioBuffer>
#include <QCryptographicHash>
#include <QCoreApplication>
#include <QDataStream>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace {
QString localPath(const QUrl &url) { return url.isLocalFile() ? url.toLocalFile() : QString(); }

QString bundledPath(const QString &name)
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("transcription/") + name);
}

QString bundledWhisper()
{
#ifdef Q_OS_WIN
    return bundledPath(QStringLiteral("whisper-cli.exe"));
#else
    return bundledPath(QStringLiteral("whisper-cli"));
#endif
}

QString bundledModel() { return bundledPath(QStringLiteral("ggml-tiny-q5_1.bin")); }

QByteArray fileIdentity(const QString &path)
{
    const QFileInfo info(path);
    return (info.canonicalFilePath() + QLatin1Char('\n') + QString::number(info.size())
            + QLatin1Char('\n') + QString::number(info.lastModified().toMSecsSinceEpoch())).toUtf8();
}
}

TranscriptionService::TranscriptionService(QObject *parent) : QObject(parent)
{
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    const QString customWhisper = settings.value("transcription/whisper").toString();
    const QString customModel = settings.value("transcription/model").toString();
    m_whisperPath = validTool(customWhisper) ? customWhisper : bundledWhisper();
    m_modelPath = QFileInfo(customModel).isFile() ? customModel : bundledModel();
    // Requesting 16 kHz/mono here is not portable: some FFmpeg-backed Qt
    // decoders finish successfully without producing any buffer. Decode at
    // the source format and convert the PCM ourselves instead.
    connect(&m_decoder, &QAudioDecoder::bufferReady, this, &TranscriptionService::decoderBufferReady);
    connect(&m_decoder, &QAudioDecoder::finished, this, &TranscriptionService::decoderFinished);
    connect(&m_decoder, &QAudioDecoder::positionChanged, this, [this](qint64 position) {
        const qint64 duration = m_decoder.duration();
        if (m_phase != Phase::Conversion || duration <= 0) return;
        const int percent = int(std::clamp(position * 100 / duration, qint64(0), qint64(99)));
        if (percent / 5 != m_lastDecodePercent / 5) {
            m_lastDecodePercent = percent;
            setStatus(QStringLiteral("正在本机解码音频… %1%").arg(percent));
        }
    });
    connect(&m_decoder, QOverload<QAudioDecoder::Error>::of(&QAudioDecoder::error), this,
            [this](QAudioDecoder::Error) {
                if (m_phase == Phase::Conversion)
                    fail(QStringLiteral("音频解码失败：") + m_decoder.errorString());
            });
    connect(&m_process, &QProcess::finished, this, &TranscriptionService::processFinished);
    connect(&m_process, &QProcess::readyReadStandardOutput, this,
            [this] { m_process.readAllStandardOutput(); });
    connect(&m_process, &QProcess::readyReadStandardError, this, [this] {
        m_errorTail += m_process.readAllStandardError();
        if (m_errorTail.size() > 2048) m_errorTail = m_errorTail.right(2048);
    });
    connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart && m_phase != Phase::Idle)
            fail(QStringLiteral("无法启动外部工具：") + m_process.errorString());
    });
}

TranscriptionService::~TranscriptionService()
{
    m_decoder.stop();
    m_waveFile.close();
    if (m_process.state() != QProcess::NotRunning) {
        m_process.kill();
        m_process.waitForFinished(1000);
    }
}

void TranscriptionService::setWhisperExecutable(const QUrl &file)
{
    const QString path = localPath(file);
    if (path == m_whisperPath) return;
    m_whisperPath = path;
    QSettings(QSettings::UserScope, "Clair", "ClairDesktop").setValue("transcription/whisper", path);
    emit toolsChanged();
}

void TranscriptionService::setModelFile(const QUrl &file)
{
    const QString path = localPath(file);
    if (path == m_modelPath) return;
    m_modelPath = path;
    QSettings(QSettings::UserScope, "Clair", "ClairDesktop").setValue("transcription/model", path);
    emit toolsChanged();
}

bool TranscriptionService::ready() const
{
    return validTool(m_whisperPath) && QFileInfo(m_modelPath).isFile();
}

void TranscriptionService::useBundledTools()
{
    m_whisperPath = bundledWhisper();
    m_modelPath = bundledModel();
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.remove("transcription/whisper");
    settings.remove("transcription/model");
    emit toolsChanged();
}

void TranscriptionService::setStatus(const QString &text)
{
    if (m_status == text) return;
    m_status = text;
    emit statusChanged();
}

void TranscriptionService::setResult(const QUrl &file)
{
    if (m_resultFile == file) return;
    m_resultFile = file;
    emit resultChanged();
}

void TranscriptionService::setPhase(Phase phase)
{
    const bool wasBusy = busy();
    m_phase = phase;
    if (busy() != wasBusy) emit busyChanged();
}

bool TranscriptionService::validTool(const QString &path)
{
    const QFileInfo info(path);
    return info.isFile() && info.isExecutable();
}

QString TranscriptionService::cacheKey(const QString &audioPath) const
{
    QByteArray identity = "clair-whisper-lrc-v2-qt-decode\n";
    for (const QString &path : {audioPath, m_modelPath, m_whisperPath}) {
        identity += fileIdentity(path);
        identity += '\n';
    }
    return QString::fromLatin1(QCryptographicHash::hash(identity, QCryptographicHash::Sha256).toHex());
}

void TranscriptionService::transcribe(const QUrl &audioFile)
{
    if (busy()) { setStatus(QStringLiteral("已有转写任务在运行，请先取消。")); return; }
    setResult({});
    const QString audioPath = localPath(audioFile);
    if (!QFileInfo(audioPath).isFile()) {
        setStatus(QStringLiteral("请选择本机存在的音频文件。")); return;
    }
    if (!ready()) {
        setStatus(QStringLiteral("内置离线转写组件缺失。请解压完整试用包，或在高级设置中选择自定义识别工具和模型。")); return;
    }
    const QString cacheDir = QStandardPaths::writableLocation(QStandardPaths::CacheLocation)
                             + QStringLiteral("/transcriptions");
    if (!QDir().mkpath(cacheDir)) { setStatus(QStringLiteral("无法创建转写缓存目录。")); return; }
    m_cachePath = QDir(cacheDir).filePath(cacheKey(audioPath) + QStringLiteral(".lrc"));
    QFile cache(m_cachePath);
    if (cache.size() <= 5 * 1024 * 1024 && cache.open(QIODevice::ReadOnly)) {
        const auto lines = parseLrc(QString::fromUtf8(cache.readAll()));
        if (std::any_of(lines.cbegin(), lines.cend(), [](const LrcLine &line) {
                return !line.text.trimmed().isEmpty();
            })) {
            setResult(QUrl::fromLocalFile(m_cachePath));
            setStatus(QStringLiteral("已加载离线转写缓存（待校对草稿）。"));
            emit completed(m_resultFile, true);
            return;
        }
    }
    m_workspace = std::make_unique<QTemporaryDir>(QDir(cacheDir).filePath("job-XXXXXX"));
    if (!m_workspace->isValid()) { fail(QStringLiteral("无法创建临时转写目录。")); return; }
    m_pcmBytes = 0;
    m_inputSampleRate = 0;
    m_lastDecodePercent = -1;
    m_resamplePhase = 0.0;
    m_resampleSum = 0.0;
    m_waveFile.setFileName(m_workspace->filePath("audio.wav"));
    if (!m_waveFile.open(QIODevice::WriteOnly) || m_waveFile.write(QByteArray(44, '\0')) != 44) {
        fail(QStringLiteral("无法创建临时 WAV 文件。")); return;
    }
    setPhase(Phase::Conversion);
    setStatus(QStringLiteral("正在本机解码并转换为 16 kHz 单声道…"));
    m_decoder.setSource(audioFile);
    m_decoder.start();
}

void TranscriptionService::decoderBufferReady()
{
    if (m_phase != Phase::Conversion) return;
    const QAudioBuffer buffer = m_decoder.read();
    if (!appendDecodedBuffer(buffer))
        fail(QStringLiteral("音频 PCM 格式不受支持，无法转换为转写所需的 16 kHz 单声道。"));
}

bool TranscriptionService::appendPcmSample(double value, QByteArray &output)
{
    const double step = 16000.0 / m_inputSampleRate;
    double remaining = step;
    while (remaining > 1e-9) {
        const double portion = std::min(remaining, 1.0 - m_resamplePhase);
        m_resampleSum += value * portion;
        m_resamplePhase += portion;
        remaining -= portion;
        if (m_resamplePhase >= 1.0 - 1e-9) {
            const qint16 sample = qint16(std::clamp(m_resampleSum, -1.0, 1.0) * 32767.0);
            output.append(char(quint16(sample) & 0xff));
            output.append(char((quint16(sample) >> 8) & 0xff));
            m_resamplePhase = 0.0;
            m_resampleSum = 0.0;
        }
    }
    return true;
}

bool TranscriptionService::appendDecodedBuffer(const QAudioBuffer &buffer)
{
    const auto format = buffer.format();
    if (!buffer.isValid() || format.sampleRate() <= 0 || format.channelCount() <= 0 ||
        format.bytesPerSample() <= 0 || buffer.frameCount() <= 0)
        return false;
    if (m_inputSampleRate == 0) m_inputSampleRate = format.sampleRate();
    if (m_inputSampleRate != format.sampleRate()) return false;

    const int channels = format.channelCount();
    QByteArray converted;
    converted.reserve(int(double(buffer.frameCount()) * 32000.0 / m_inputSampleRate) + 8);
    const auto *data = buffer.constData<quint8>();
    const int sampleBytes = format.bytesPerSample();
    for (int frame = 0; frame < buffer.frameCount(); ++frame) {
        double mono = 0.0;
        for (int channel = 0; channel < channels; ++channel) {
            const auto *sample = data + (frame * channels + channel) * sampleBytes;
            double value = 0.0;
            switch (format.sampleFormat()) {
            case QAudioFormat::UInt8: value = (double(*sample) - 128.0) / 128.0; break;
            case QAudioFormat::Int16: {
                const qint16 s = qint16(quint16(sample[0]) | (quint16(sample[1]) << 8));
                value = double(s) / 32768.0; break;
            }
            case QAudioFormat::Int32: {
                const quint32 bits = quint32(sample[0]) | (quint32(sample[1]) << 8)
                                     | (quint32(sample[2]) << 16) | (quint32(sample[3]) << 24);
                value = double(qint32(bits)) / 2147483648.0; break;
            }
            case QAudioFormat::Float: {
                float s;
                static_assert(sizeof(s) == 4);
                std::memcpy(&s, sample, 4);
                value = std::isfinite(s) ? double(s) : 0.0; break;
            }
            default: return false;
            }
            mono += value;
        }
        appendPcmSample(mono / channels, converted);
    }
    if (m_pcmBytes + quint64(converted.size()) > 0xFFFFFFFFull - 36ull ||
        m_waveFile.write(converted) != converted.size())
        return false;
    m_pcmBytes += quint64(converted.size());
    return true;
}

void TranscriptionService::decoderFinished()
{
    if (m_phase != Phase::Conversion) return;
    while (m_decoder.bufferAvailable() && m_phase == Phase::Conversion)
        decoderBufferReady();
    if (m_phase != Phase::Conversion) return;
    if (m_pcmBytes == 0) {
        fail(QStringLiteral("音频解码未产生 PCM 数据；请确认文件能正常播放，或尝试转换为 WAV 后重试。"));
        return;
    }
    QByteArray header;
    QDataStream stream(&header, QIODevice::WriteOnly);
    stream.setByteOrder(QDataStream::LittleEndian);
    stream.writeRawData("RIFF", 4);
    stream << quint32(36 + m_pcmBytes);
    stream.writeRawData("WAVEfmt ", 8);
    stream << quint32(16) << quint16(1) << quint16(1) << quint32(16000)
           << quint32(32000) << quint16(2) << quint16(16);
    stream.writeRawData("data", 4);
    stream << quint32(m_pcmBytes);
    if (header.size() != 44 || !m_waveFile.seek(0) || m_waveFile.write(header) != 44) {
        fail(QStringLiteral("无法完成临时 WAV 文件。")); return;
    }
    m_waveFile.close();
    startRecognition();
}

void TranscriptionService::startRecognition()
{
    const QString wav = m_workspace->filePath("audio.wav");
    if (!QFileInfo(wav).isFile() || QFileInfo(wav).size() == 0) {
        fail(QStringLiteral("音频解码器未生成可用的 WAV 文件。")); return;
    }
    m_process.setProgram(m_whisperPath);
    m_errorTail.clear();
    m_process.setArguments({"-m", m_modelPath, "-f", wav, "-l", "auto", "-olrc", "-of",
                            m_workspace->filePath("draft")});
    setPhase(Phase::Recognition);
    setStatus(QStringLiteral("正在离线识别歌词；不会阻塞播放，可随时取消…"));
    m_process.start();
}

void TranscriptionService::processFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    const Phase phase = m_phase;
    if (phase == Phase::Idle) return;
    if (phase == Phase::Canceling) {
        m_workspace.reset();
        setPhase(Phase::Idle);
        setStatus(QStringLiteral("已取消离线转写。"));
        return;
    }
    if (exitStatus != QProcess::NormalExit || exitCode != 0) {
        const QString detail = QString::fromLocal8Bit(m_errorTail + m_process.readAllStandardError()).trimmed().right(500);
        fail(QStringLiteral("whisper.cpp 识别失败")
             + QStringLiteral("（退出码 %1）").arg(exitCode)
             + (detail.isEmpty() ? QString() : QStringLiteral("：") + detail));
        return;
    }
    const QString draftPath = m_workspace->filePath("draft.lrc");
    QFile draft(draftPath);
    if (!draft.open(QIODevice::ReadOnly)) {
        fail(QStringLiteral("识别程序未生成 LRC；请确认所选的是支持 -olrc 的 whisper-cli。")); return;
    }
    const QByteArray contents = draft.readAll();
    draft.close();
    const auto lines = contents.size() <= 5 * 1024 * 1024
                           ? parseLrc(QString::fromUtf8(contents)) : QVector<LrcLine>();
    if (!std::any_of(lines.cbegin(), lines.cend(), [](const LrcLine &line) {
            return !line.text.trimmed().isEmpty();
        })) {
        fail(QStringLiteral("识别结果为空或格式无效；纯器乐、强伴奏也可能无法识别。")); return;
    }
    QSaveFile cache(m_cachePath);
    if (!cache.open(QIODevice::WriteOnly) || cache.write(contents) != contents.size() || !cache.commit()) {
        fail(QStringLiteral("无法保存转写草稿缓存。")); return;
    }
    m_workspace.reset();
    setResult(QUrl::fromLocalFile(m_cachePath));
    setPhase(Phase::Idle);
    setStatus(QStringLiteral("离线转写完成：待校对草稿，可能存在错词或幻觉。"));
    emit completed(m_resultFile, false);
}

void TranscriptionService::fail(const QString &message)
{
    const Phase oldPhase = m_phase;
    setPhase(Phase::Idle);
    if (oldPhase == Phase::Conversion) m_decoder.stop();
    m_waveFile.close();
    m_workspace.reset();
    setStatus(message);
}

void TranscriptionService::cancel()
{
    if (!busy() || m_phase == Phase::Canceling) return;
    if (m_phase == Phase::Conversion) {
        setPhase(Phase::Idle);
        m_decoder.stop();
        m_waveFile.close();
        m_workspace.reset();
        setStatus(QStringLiteral("已取消离线转写。"));
        return;
    }
    setPhase(Phase::Canceling);
    setStatus(QStringLiteral("正在取消转写…"));
    m_process.kill();
}
