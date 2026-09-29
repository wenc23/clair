#include "webserver.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QHostAddress>
#include <QSet>
#include <QTcpSocket>

namespace {

constexpr qsizetype kMaxRequestBytes = 8192;
const QSet<QByteArray> kPublicFiles {
    "index.html", "styles.css", "app.js", "flac-metadata.js",
    "library-model.js", "theme-model.js", "shared-state-web.js",
};

QByteArray statusLine(int status)
{
    switch (status) {
    case 200: return "HTTP/1.1 200 OK\r\n";
    case 400: return "HTTP/1.1 400 Bad Request\r\n";
    case 405: return "HTTP/1.1 405 Method Not Allowed\r\n";
    default: return "HTTP/1.1 404 Not Found\r\n";
    }
}

} // namespace

WebServer::WebServer(QObject *parent) : QObject(parent)
{
    connect(&m_listener, &QTcpServer::newConnection, this, &WebServer::handleConnection);
}

bool WebServer::start()
{
    if (m_listener.isListening())
        return true;
    const QString packaged = QDir(QCoreApplication::applicationDirPath()).filePath("web");
    if (QFile::exists(QDir(packaged).filePath("index.html"))) {
        m_webRoot = packaged;
    } else {
        m_webRoot = QString::fromUtf8(CLAIR_WEB_SOURCE_DIR);
    }
    if (!QFile::exists(QDir(m_webRoot).filePath("index.html"))) {
        m_errorString = QStringLiteral("未找到 Web 版页面文件；请重新解压完整试用包。");
        return false;
    }
    if (!m_listener.listen(QHostAddress::LocalHost, 0)) {
        m_errorString = QStringLiteral("无法启动本机 Web 入口：") + m_listener.errorString();
        return false;
    }
    m_errorString.clear();
    return true;
}

QUrl WebServer::url() const
{
    return m_listener.isListening()
        ? QUrl(QStringLiteral("http://127.0.0.1:%1/").arg(m_listener.serverPort()))
        : QUrl();
}

void WebServer::handleConnection()
{
    while (QTcpSocket *socket = m_listener.nextPendingConnection()) {
        socket->setParent(this);
        auto *buffer = new QByteArray;
        connect(socket, &QTcpSocket::readyRead, socket, [this, socket, buffer] {
            if (socket->property("answered").toBool()) return;
            buffer->append(socket->readAll());
            if (buffer->size() > kMaxRequestBytes) {
                sendResponse(socket, {});
                return;
            }
            if (buffer->contains("\r\n\r\n"))
                sendResponse(socket, *buffer);
        });
        connect(socket, &QTcpSocket::disconnected, socket, [socket, buffer] {
            delete buffer;
            socket->deleteLater();
        });
    }
}

void WebServer::sendResponse(QTcpSocket *socket, const QByteArray &request)
{
    if (socket->property("answered").toBool()) return;
    socket->setProperty("answered", true);
    const QByteArray firstLine = request.left(request.indexOf("\r\n"));
    const QList<QByteArray> parts = firstLine.split(' ');
    int status = 200;
    bool head = false;
    QByteArray body;
    QByteArray mime = "text/plain; charset=utf-8";
    if (parts.size() != 3 || !parts.at(2).startsWith("HTTP/1.")) {
        status = 400;
        body = "Bad request";
    } else if (parts.at(0) != "GET" && parts.at(0) != "HEAD") {
        status = 405;
        body = "Method not allowed";
    } else {
        head = parts.at(0) == "HEAD";
        // Only literal ASCII names on this allowlist are accepted. Encoded
        // slashes, traversal, absolute paths and unknown files stay 404.
        QByteArray path = parts.at(1).split('?').first();
        if (path == "/") path = "/index.html";
        const QByteArray name = path.mid(1);
        if (!path.startsWith('/') || !kPublicFiles.contains(name)) {
            status = 404;
            body = "Not found";
        } else {
            QFile file(QDir(m_webRoot).filePath(QString::fromLatin1(name)));
            if (!file.open(QIODevice::ReadOnly)) {
                status = 404;
                body = "Not found";
            } else {
                body = file.readAll();
                mime = mimeType(name);
            }
        }
    }
    QByteArray response = statusLine(status);
    response += "Content-Type: " + mime + "\r\n";
    response += "Cache-Control: no-store\r\n";
    response += "X-Content-Type-Options: nosniff\r\n";
    response += "Connection: close\r\n";
    response += "Content-Length: " + QByteArray::number(body.size()) + "\r\n\r\n";
    if (!head)
        response += body;
    socket->write(response);
    socket->disconnectFromHost();
}

QByteArray WebServer::mimeType(const QByteArray &fileName)
{
    if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
    if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
    return "text/javascript; charset=utf-8";
}
