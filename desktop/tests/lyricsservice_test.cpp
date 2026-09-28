#include "../src/lyricsservice.h"

#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QtTest>

class LyricsServiceTest final : public QObject {
    Q_OBJECT
private slots:
    void loadsMatchingLocalLrcAndManualFile();
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

QTEST_GUILESS_MAIN(LyricsServiceTest)
#include "lyricsservice_test.moc"
