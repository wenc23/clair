#include "../src/fingerprintservice.h"

#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>

class FingerprintServiceTest final : public QObject {
    Q_OBJECT
private slots:
    void parsesCandidatesWithoutInventingMetadata();
    void handlesMalformedOrRejectedResponse();
    void requiresLocalFileAndUserKey();
    void reportsMissingFpcalcAndCanCancel();
};

void FingerprintServiceTest::parsesCandidatesWithoutInventingMetadata()
{
    const QByteArray json = R"({"status":"ok","results":[
      {"id":"a1","score":0.96,"recordings":[
        {"id":"r1","title":"Catch Catch","artists":[{"name":"Singer"},{"name":"Guest"}]},
        {"id":"r2","title":"Instrumental"}]},
      {"id":"a2","score":0.8,"recordings":[
        {"id":"r3","title":"Catch Catch","artists":[{"name":"Singer"},{"name":"Guest"}]}]}
    ]})";
    QString error;
    const auto candidates = FingerprintService::parseLookupResponse(json, &error);
    QVERIFY(error.isEmpty());
    QCOMPARE(candidates.size(), 2); // Identical title/artist candidates are deduplicated.
    const auto first = candidates.at(0).toMap();
    QCOMPARE(first.value("title").toString(), QStringLiteral("Catch Catch"));
    QCOMPARE(first.value("artist").toString(), QStringLiteral("Singer, Guest"));
    QCOMPARE(first.value("score").toDouble(), 0.96);
    QCOMPARE(first.value("recordingId").toString(), QStringLiteral("r1"));
    QCOMPARE(candidates.at(1).toMap().value("artist").toString(), QString());
}

void FingerprintServiceTest::handlesMalformedOrRejectedResponse()
{
    QString error;
    QVERIFY(FingerprintService::parseLookupResponse("not json", &error).isEmpty());
    QVERIFY(!error.isEmpty());
    error.clear();
    QVERIFY(FingerprintService::parseLookupResponse(
        R"({"status":"error","error":{"message":"invalid client"}})", &error).isEmpty());
    QVERIFY(error.contains(QStringLiteral("invalid client")));
    error.clear();
    QVERIFY(FingerprintService::parseLookupResponse(
        R"({"status":"ok","results":[{"score":0.7,"recordings":[{"title":""}]}]})", &error).isEmpty());
    QVERIFY(error.isEmpty());
}

void FingerprintServiceTest::requiresLocalFileAndUserKey()
{
    FingerprintService service;
    service.identify(QUrl(QStringLiteral("https://example.com/music.mp3")), QStringLiteral("key"));
    QVERIFY(service.status().contains(QStringLiteral("本地音频")));
    QVERIFY(!service.busy());
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    QFile file(temp.filePath("song.mp3"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.close();
    service.identify(QUrl::fromLocalFile(file.fileName()), QString());
    QVERIFY(service.status().contains(QStringLiteral("API key")));
    QVERIFY(!service.busy());
}

void FingerprintServiceTest::reportsMissingFpcalcAndCanCancel()
{
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    QFile file(temp.filePath("song.mp3"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.close();
    FingerprintService service;
    service.setFpcalcExecutable(temp.filePath("nonexistent-fpcalc"));
    service.identify(QUrl::fromLocalFile(file.fileName()), QStringLiteral("dummy-key"));
    QTRY_VERIFY_WITH_TIMEOUT(!service.busy(), 10000);
    QVERIFY(service.status().contains(QStringLiteral("fpcalc")));
    QVERIFY(service.candidates().isEmpty());
    service.cancel();
    QCOMPARE(service.status(), QStringLiteral("已取消识别。"));
}

QTEST_GUILESS_MAIN(FingerprintServiceTest)
#include "fingerprintservice_test.moc"
