#pragma once

#include <QObject>
#include <QTcpServer>
#include <QUrl>

// Optional loopback-only static host for the existing Web UI. Native playback
// never talks to this server. No write/API endpoints are exposed.
class WebServer final : public QObject {
    Q_OBJECT

public:
    explicit WebServer(QObject *parent = nullptr);
    bool start();
    QUrl url() const;
    QString errorString() const { return m_errorString; }

private:
    void handleConnection();
    void sendResponse(QTcpSocket *socket, const QByteArray &request);
    static QByteArray mimeType(const QByteArray &fileName);

    QTcpServer m_listener;
    QString m_webRoot;
    QString m_errorString;
};
