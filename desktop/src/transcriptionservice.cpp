#include "transcriptionservice.h"

#include "lyricsparser.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>

#include <algorithm>

namespace {
QString localPath(const QUrl &url) { return url.isLocalFile() ? url.toLocalFile() : QString(); }

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
    m_ffmpegPath = settings.value("transcription/ffmpeg").toString();
    m_whisperPath = settings.value("transcription/whisper").toString();
    m_modelPath = settings.value("transcription/model").toString();
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
    if (m_process.state() != QProcess::NotRunning) {
        m_process.kill();
        m_process.waitForFinished(1000);
    }
}

void TranscriptionService::setFfmpegExecutable(const QUrl &file)
{
    const QString path = localPath(file);
    if (path == m_ffmpegPath) return;
    m_ffmpegPath = path;
    QSettings(QSettings::UserScope, "Clair", "ClairDesktop").setValue("transcription/ffmpeg", path);
    emit toolsChanged();
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
    QByteArray identity = "clair-whisper-lrc-v1\n";
    for (const QString &path : {audioPath, m_modelPath, m_whisperPath, m_ffmpegPath}) {
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
    if (!validTool(m_ffmpegPath) || !validTool(m_whisperPath) || !QFileInfo(m_modelPath).isFile()) {
        setStatus(QStringLiteral("请先选择可执行的 ffmpeg、whisper-cli 和兼容的 ggml 模型文件。")); return;
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
    m_process.setProgram(m_ffmpegPath);
    m_errorTail.clear();
    m_process.setArguments({"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", audioPath,
                            "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le",
                            m_workspace->filePath("audio.wav")});
    setPhase(Phase::Conversion);
    setStatus(QStringLiteral("正在离线转换音频（16 kHz 单声道）…"));
    m_process.start();
}

void TranscriptionService::startRecognition()
{
    const QString wav = m_workspace->filePath("audio.wav");
    if (!QFileInfo(wav).isFile() || QFileInfo(wav).size() == 0) {
        fail(QStringLiteral("ffmpeg 未生成可用的 WAV 文件。")); return;
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
        fail((phase == Phase::Conversion ? QStringLiteral("ffmpeg 转换失败")
                                           : QStringLiteral("whisper.cpp 识别失败"))
             + QStringLiteral("（退出码 %1）").arg(exitCode)
             + (detail.isEmpty() ? QString() : QStringLiteral("：") + detail));
        return;
    }
    if (phase == Phase::Conversion) { startRecognition(); return; }
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
    m_workspace.reset();
    setPhase(Phase::Idle);
    setStatus(message);
}

void TranscriptionService::cancel()
{
    if (!busy() || m_phase == Phase::Canceling) return;
    setPhase(Phase::Canceling);
    setStatus(QStringLiteral("正在取消转写…"));
    m_process.kill();
}
