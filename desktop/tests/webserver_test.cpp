#include "../src/webserver.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSignalSpy>
#include <QTcpSocket>
#include <QtTest>

class WebServerTest final : public QObject {
    Q_OBJECT

private slots:
    void servesBundledPageAndAllowlistedAssets();
    void closesIncompleteRequests();
};

void WebServerTest::closesIncompleteRequests()
{
    WebServer server;
    QVERIFY(server.start());
    QTcpSocket partial;
    partial.connectToHost("127.0.0.1", server.url().port());
    QVERIFY(partial.waitForConnected(3000));
    QSignalSpy disconnected(&partial, &QTcpSocket::disconnected);
    const QByteArray request = "GET /index.html HTTP/1.1\r\nHost: localhost\r\n";
    QCOMPARE(partial.write(request), qint64(request.size()));
    partial.flush();
    QTRY_COMPARE_WITH_TIMEOUT(disconnected.size(), 1, 8000);
}

void WebServerTest::servesBundledPageAndAllowlistedAssets()
{
    WebServer server;
    QVERIFY2(server.start(), qPrintable(server.errorString()));
    QCOMPARE(server.url().host(), "127.0.0.1");
    QVERIFY(server.url().port() > 0);

    QNetworkAccessManager client;
    auto fetch = [&client, &server](const QString &path, bool head = false) {
        QNetworkReply *reply = head
            ? client.head(QNetworkRequest(server.url().resolved(QUrl(path))))
            : client.get(QNetworkRequest(server.url().resolved(QUrl(path))));
        QSignalSpy done(reply, &QNetworkReply::finished);
        if (!reply->isFinished())
            done.wait(5000);
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QByteArray bytes = reply->readAll();
        reply->deleteLater();
        return qMakePair(status, bytes);
    };

    const auto home = fetch("/");
    QCOMPARE(home.first, 200);
    QVERIFY(home.second.contains("Clair"));
    QCOMPARE(fetch("/app.js").first, 200);
    QCOMPARE(fetch("/shared-state-web.js").first, 200);
    QCOMPARE(fetch("/index.html", true).first, 200);
    QCOMPARE(fetch("/LICENSE").first, 404);
    QCOMPARE(fetch("/%2e%2e%2fLICENSE").first, 404);
}

QTEST_GUILESS_MAIN(WebServerTest)
#include "webserver_test.moc"
