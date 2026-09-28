#include "../src/lyricsservice.h"

#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QtTest>

class LyricsServiceTest final : public QObject {
    Q_OBJECT
private slots:
    void loadsMatchingLocalLrcAndManualFile();
    void searchesLrclibWhenRequested();
};

void LyricsServiceTest::loadsMatchingLocalLrcAndManualFile()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    const QDir dir(temporary.path());
    QFile audio(dir.filePath("sample.mp3"));
    QVERIFY(audio.open(QIODevice::WriteOnly));
    audio.close();
    QFile lrc(dir.filePath("sample.lrc"));
    QVERIFY(lrc.open(QIODevice::WriteOnly));
    const QByteArray contents = "[00:01.00]first\n[00:02.00]second\n";
    QCOMPARE(lrc.write(contents), contents.size());
    lrc.close();

    LyricsService lyrics;
    lyrics.loadForTrack(QUrl::fromLocalFile(audio.fileName()));
    QCOMPARE(lyrics.lines().size(), 2);
    QCOMPARE(lyrics.lineAtPosition(1500), QStringLiteral("first"));
    QCOMPARE(lyrics.lineAtPosition(2000), QStringLiteral("second"));
    lyrics.loadForTrack({});
    QCOMPARE(lyrics.lines().size(), 0);
}

void LyricsServiceTest::searchesLrclibWhenRequested()
{
    if (qEnvironmentVariableIsEmpty("CLAIR_TEST_LRCLIB"))
        QSKIP("Set CLAIR_TEST_LRCLIB=1 to run the network integration test.");
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    QFile audio(QDir(temporary.path()).filePath("Yesterday.mp3"));
    QVERIFY(audio.open(QIODevice::WriteOnly));
    audio.close();
    LyricsService lyrics;
    lyrics.loadForTrack(QUrl::fromLocalFile(audio.fileName()));
    lyrics.search("Yesterday", "The Beatles");
    QTRY_VERIFY_WITH_TIMEOUT(!lyrics.candidates().isEmpty() ||
                             !lyrics.status().contains(QStringLiteral("正在搜索")), 20000);
    QVERIFY2(!lyrics.candidates().isEmpty(), qPrintable(lyrics.status()));
}

QTEST_GUILESS_MAIN(LyricsServiceTest)
#include "lyricsservice_test.moc"
