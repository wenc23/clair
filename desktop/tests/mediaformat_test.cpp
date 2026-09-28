#include <QDir>
#include <QFile>
#include <QAudioOutput>
#include <QMediaPlayer>
#include <QtTest>

class MediaFormatTest final : public QObject {
    Q_OBJECT

private slots:
    void decodesFixture_data();
    void decodesFixture();
    void playsWavWithAudioOutputWhenRequested();
};

void MediaFormatTest::decodesFixture_data()
{
    QTest::addColumn<QString>("fileName");
    QTest::newRow("wav") << QStringLiteral("tone.wav");
    QTest::newRow("flac") << QStringLiteral("tone.flac");
    QTest::newRow("mp3") << QStringLiteral("tone.mp3");
}

void MediaFormatTest::decodesFixture()
{
    QFETCH(QString, fileName);
    const QString path = QDir(QString::fromUtf8(CLAIR_FIXTURE_DIR)).filePath(fileName);
    QVERIFY2(QFile::exists(path), qPrintable(path));

    QMediaPlayer player;
    player.setSource(QUrl::fromLocalFile(path));
    QTRY_VERIFY_WITH_TIMEOUT(player.duration() >= 400 || player.error() != QMediaPlayer::NoError, 10000);
    QCOMPARE(player.error(), QMediaPlayer::NoError);
    QVERIFY(player.duration() >= 400);
}

void MediaFormatTest::playsWavWithAudioOutputWhenRequested()
{
    if (qEnvironmentVariableIsEmpty("CLAIR_TEST_AUDIO_OUTPUT"))
        QSKIP("Set CLAIR_TEST_AUDIO_OUTPUT=1 on a machine with an audio output device.");

    const QString path = QDir(QString::fromUtf8(CLAIR_FIXTURE_DIR)).filePath("tone.wav");
    QAudioOutput output;
    QMediaPlayer player;
    player.setAudioOutput(&output);
    player.setSource(QUrl::fromLocalFile(path));
    player.play();
    QTRY_VERIFY_WITH_TIMEOUT(player.position() > 0 || player.error() != QMediaPlayer::NoError, 5000);
    QCOMPARE(player.error(), QMediaPlayer::NoError);
    QVERIFY(player.position() > 0);
}

QTEST_GUILESS_MAIN(MediaFormatTest)
#include "mediaformat_test.moc"
