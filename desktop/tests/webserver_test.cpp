#include "../src/webserver.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSignalSpy>
#include <QtTest>

class WebServerTest final : public QObject {
    Q_OBJECT

private slots:
    void servesBundledPageAndAllowlistedAssets();
};

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
    QCOMPARE(fetch("/index.html", true).first, 200);
    QCOMPARE(fetch("/LICENSE").first, 404);
    QCOMPARE(fetch("/%2e%2e%2fLICENSE").first, 404);
}

QTEST_GUILESS_MAIN(WebServerTest)
#include "webserver_test.moc"
