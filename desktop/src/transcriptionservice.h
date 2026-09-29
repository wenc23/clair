#pragma once

#include <QObject>
#include <QAudioDecoder>
#include <QFile>
#include <QProcess>
#include <QTemporaryDir>
#include <QUrl>

#include <memory>

// Offline adapter: Qt Multimedia decodes to WAV and a bundled whisper.cpp
// executable/model generates a draft. Advanced users may override the latter.
class TranscriptionService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QUrl whisperExecutable READ whisperExecutable WRITE setWhisperExecutable NOTIFY toolsChanged)
    Q_PROPERTY(QUrl modelFile READ modelFile WRITE setModelFile NOTIFY toolsChanged)
    Q_PROPERTY(bool ready READ ready NOTIFY toolsChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QUrl resultFile READ resultFile NOTIFY resultChanged)
public:
    explicit TranscriptionService(QObject *parent = nullptr);
    ~TranscriptionService() override;

    QUrl whisperExecutable() const { return m_whisperPath.isEmpty() ? QUrl() : QUrl::fromLocalFile(m_whisperPath); }
    QUrl modelFile() const { return m_modelPath.isEmpty() ? QUrl() : QUrl::fromLocalFile(m_modelPath); }
    bool ready() const;
    bool busy() const { return m_phase != Phase::Idle; }
    QString status() const { return m_status; }
    QUrl resultFile() const { return m_resultFile; }

    void setWhisperExecutable(const QUrl &file);
    void setModelFile(const QUrl &file);
    Q_INVOKABLE void useBundledTools();
    Q_INVOKABLE void transcribe(const QUrl &audioFile);
    Q_INVOKABLE void cancel();

signals:
    void toolsChanged();
    void busyChanged();
    void statusChanged();
    void resultChanged();
    void completed(const QUrl &lrcFile, bool fromCache);

private:
    enum class Phase { Idle, Conversion, Recognition, Canceling };
    void setStatus(const QString &text);
    void setResult(const QUrl &file);
    void setPhase(Phase phase);
    void fail(const QString &message);
    void decoderBufferReady();
    void decoderFinished();
    void startRecognition();
    void processFinished(int exitCode, QProcess::ExitStatus exitStatus);
    QString cacheKey(const QString &audioPath) const;
    static bool validTool(const QString &path);

    QString m_whisperPath;
    QString m_modelPath;
    QString m_cachePath;
    QString m_status;
    QUrl m_resultFile;
    QAudioDecoder m_decoder;
    QFile m_waveFile;
    quint64 m_pcmBytes = 0;
    QProcess m_process;
    std::unique_ptr<QTemporaryDir> m_workspace;
    QByteArray m_errorTail;
    Phase m_phase = Phase::Idle;
};
