#pragma once

#include <QNetworkAccessManager>
#include <QObject>
#include <QProcess>
#include <QTimer>
#include <QUrl>
#include <QVariantList>

class QNetworkReply;

// Optional, user-initiated identification. No audio leaves the computer: fpcalc
// produces a fingerprint, which is sent to AcoustID only after explicit action.
class FingerprintService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QVariantList candidates READ candidates NOTIFY candidatesChanged)
    Q_PROPERTY(QString fpcalcExecutable READ fpcalcExecutable WRITE setFpcalcExecutable NOTIFY fpcalcExecutableChanged)
public:
    explicit FingerprintService(QObject *parent = nullptr);

    bool busy() const { return m_stage != Idle; }
    QString status() const { return m_status; }
    QVariantList candidates() const { return m_candidates; }
    QString fpcalcExecutable() const { return m_fpcalcExecutable; }
    void setFpcalcExecutable(const QString &executable);

    Q_INVOKABLE void identify(const QUrl &audio, const QString &apiKey);
    Q_INVOKABLE void cancel();
    // Selection only proposes metadata. The caller decides whether to save it.
    Q_INVOKABLE void chooseCandidate(int index);

    static QVariantList parseLookupResponse(const QByteArray &json, QString *error = nullptr);

signals:
    void busyChanged();
    void statusChanged();
    void candidatesChanged();
    void fpcalcExecutableChanged();
    void proposalSelected(const QUrl &audio, const QString &title, const QString &artist);

private:
    enum Stage { Idle, Fingerprinting, LookingUp };
    void setStatus(const QString &status);
    void setStage(Stage stage);
    void fingerprintFinished(QProcess *process, int exitCode, QProcess::ExitStatus exitStatus);
    void lookupFinished(QNetworkReply *reply, quint64 requestId);

    QProcess *m_fpcalc = nullptr;
    QTimer m_fingerprintTimeout;
    QNetworkAccessManager m_network;
    QNetworkReply *m_reply = nullptr;
    Stage m_stage = Idle;
    quint64 m_requestId = 0;
    QUrl m_audio;
    QString m_apiKey;
    QString m_fpcalcExecutable = QStringLiteral("fpcalc");
    QString m_status;
    QVariantList m_candidates;
};
