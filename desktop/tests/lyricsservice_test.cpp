#include "../src/lyricsservice.h"

#include <QDir>
#include <QFile>
#include <QCryptographicHash>
#include <QSettings>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QtTest>

class LyricsServiceTest final : public QObject {
    Q_OBJECT
private slots:
    void loadsMatchingLocalLrcAndManualFile();
    void searchesLrclibWhenRequested();
    void findsSongDespiteVideoFilename();
    void ignoresOldHallucinatedDraftCache();
    void adjustsOneLineWithoutEditingOriginalLrc();
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
                             !lyrics.status().contains(QStringLiteral("搜索")), 20000);
    QVERIFY2(!lyrics.candidates().isEmpty(), qPrintable(lyrics.status()));
}

void LyricsServiceTest::findsSongDespiteVideoFilename()
{
    if (qEnvironmentVariableIsEmpty("CLAIR_TEST_LRCLIB"))
        QSKIP("Set CLAIR_TEST_LRCLIB=1 to run the network integration test.");
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    QFile audio(QDir(temporary.path()).filePath("video.mp3"));
    QVERIFY(audio.open(QIODevice::WriteOnly));
    audio.close();
    LyricsService lyrics;
    lyrics.loadForTrack(QUrl::fromLocalFile(audio.fileName()));
    lyrics.search(QStringLiteral("Glass Animals《The Other Side Of Paradise》百万豪装录音棚大声 - 1.Glass Animals《The Other Side Of Paradi(Av116180845396481,P1)"),
                  QStringLiteral("未知艺术家"), 321500);
    QTRY_VERIFY_WITH_TIMEOUT(!lyrics.candidates().isEmpty() ||
                             !lyrics.status().contains(QStringLiteral("搜索")), 30000);
    QVERIFY2(!lyrics.candidates().isEmpty(), qPrintable(lyrics.status()));
    QVERIFY2(lyrics.candidates().first().toMap().value("label").toString()
                 .startsWith(QStringLiteral("The Other Side Of Paradise — Glass Animals")),
             qPrintable(lyrics.candidates().first().toMap().value("label").toString()));
    QVERIFY(lyrics.candidates().first().toMap().value("synced").toBool());
}

void LyricsServiceTest::ignoresOldHallucinatedDraftCache()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    const QString audioPath = QDir(temporary.path()).filePath("unique-audio.mp3");
    QFile audio(audioPath);
    QVERIFY(audio.open(QIODevice::WriteOnly));
    audio.close();

    const QString cacheRoot = QStandardPaths::writableLocation(QStandardPaths::CacheLocation)
                              + QStringLiteral("/transcriptions");
    QVERIFY(QDir().mkpath(cacheRoot));
    QTemporaryDir cacheDir(cacheRoot + QStringLiteral("/quality-test-XXXXXX"));
    QVERIFY(cacheDir.isValid());
    const QString draftPath = QDir(cacheDir.path()).filePath("old.lrc");
    QFile draft(draftPath);
    QVERIFY(draft.open(QIODevice::WriteOnly));
    for (int i = 0; i < 30; ++i)
        draft.write(QByteArray("[00:") + QByteArray::number(i).rightJustified(2, '0')
                    + ".00]same invented sentence\n");
    draft.close();

    const QString key = QStringLiteral("lyrics/") + QString::fromLatin1(
        QCryptographicHash::hash(audioPath.toUtf8(), QCryptographicHash::Sha256).toHex());
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.setValue(key, draftPath);
    LyricsService lyrics;
    lyrics.loadForTrack(QUrl::fromLocalFile(audioPath));
    QVERIFY(lyrics.lines().isEmpty());
    QVERIFY(lyrics.status().contains(QStringLiteral("旧转写草稿")));
    QVERIFY(!settings.contains(key));
    QVERIFY(QFile::exists(draftPath)); // The user's cache file is not deleted.
}

void LyricsServiceTest::adjustsOneLineWithoutEditingOriginalLrc()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    const QString audioPath = QDir(temporary.path()).filePath("timing-test.mp3");
    QFile audio(audioPath);
    QVERIFY(audio.open(QIODevice::WriteOnly));
    audio.close();
    const QByteArray original = "[00:01.00]first\n[00:03.00]second\n";
    const QString lrcPath = QDir(temporary.path()).filePath("timing-test.lrc");
    QFile lrc(lrcPath);
    QVERIFY(lrc.open(QIODevice::WriteOnly));
    QCOMPARE(lrc.write(original), original.size());
    lrc.close();

    LyricsService lyrics;
    lyrics.loadForTrack(QUrl::fromLocalFile(audioPath));
    QCOMPARE(lyrics.lines().first().toMap().value("sourceIndex").toInt(), 0);
    QVERIFY(lyrics.adjustLineTime(0, 4000));
    QCOMPARE(lyrics.lines().first().toMap().value("text").toString(), QStringLiteral("second"));
    QCOMPARE(lyrics.lineAtPosition(3500), QStringLiteral("second"));
    lyrics.loadForTrack(QUrl::fromLocalFile(audioPath));
    QCOMPARE(lyrics.lines().last().toMap().value("timeMs").toLongLong(), 4000);
    QVERIFY(lyrics.resetLineTime(0));
    QCOMPARE(lyrics.lines().first().toMap().value("timeMs").toLongLong(), 1000);
    QVERIFY(!lyrics.adjustLineTime(10, 1000));
    QVERIFY(!lyrics.adjustLineTime(0, -1));
    QVERIFY(lrc.open(QIODevice::ReadOnly));
    QCOMPARE(lrc.readAll(), original);

    const QString timingKey = QStringLiteral("lyrics/timing/") + QString::fromLatin1(
        QCryptographicHash::hash(audioPath.toUtf8(), QCryptographicHash::Sha256).toHex())
        + QLatin1Char('/') + QString::fromLatin1(
            QCryptographicHash::hash(original, QCryptographicHash::Sha256).toHex());
    QSettings(QSettings::UserScope, "Clair", "ClairDesktop").remove(timingKey);
}

QTEST_GUILESS_MAIN(LyricsServiceTest)
#include "lyricsservice_test.moc"
