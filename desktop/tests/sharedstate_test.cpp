#include "../src/sharedstate.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QTest>

class SharedStateTest : public QObject {
    Q_OBJECT
private slots:
    void migratesAndSharesWithoutTouchingIndex();
    void refusesMalformedFile();
    void refusesWrongFieldTypes_data();
    void refusesWrongFieldTypes();
    void positionUpdatesDoNotReplaceSelectedTrack();
    void migratesRenamedTrackReferences();
    void refusesRenameMigrationWhenAnyFileIsMalformed();
};

void SharedStateTest::migratesAndSharesWithoutTouchingIndex()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    QVERIFY(QDir().mkpath(dir.filePath(".Clair")));
    const QByteArray favoriteKey = (QFileInfo(dir.path()).fileName() + "/Songs/favorite.mp3").toUtf8();
    const QByteArray otherKey = (QFileInfo(dir.path()).fileName() + "/Songs/other.mp3").toUtf8();
    const QByteArray index = QByteArray(R"({"schemaVersion":1,"tracks":[{"path":")") +
        favoriteKey + R"(","favorite":true}]})";
    QFile source(dir.filePath(".Clair/library.json"));
    QVERIFY(source.open(QIODevice::WriteOnly));
    QCOMPARE(source.write(index), index.size());
    source.close();

    SharedState state;
    state.setRoot(dir.path());
    QVERIFY(state.favorite(QString::fromUtf8(favoriteKey)));
    state.setFavorite(QString::fromUtf8(otherKey), true);
    state.createPlaylist("日常");
    state.addToPlaylist("日常", QString::fromUtf8(otherKey));
    QCOMPARE(state.playlistTracks("日常"), QStringList{QString::fromUtf8(otherKey)});
    state.selectResume(QString::fromUtf8(otherKey));
    state.saveResume(QString::fromUtf8(otherKey), 12345);
    QCOMPARE(state.resume().value("lastPath").toString(), QString::fromUtf8(otherKey));
    QCOMPARE(state.resume().value("bookmarks").toMap().value(QString::fromUtf8(otherKey)).toLongLong(), 12345);
    QVERIFY(source.open(QIODevice::ReadOnly));
    QCOMPARE(source.readAll(), index);
    source.close();

    // Simulate a write from the browser, then check live refresh.
    QFile web(dir.filePath(".Clair/favorites.json"));
    QVERIFY(web.open(QIODevice::WriteOnly | QIODevice::Truncate));
    web.write(QByteArray(R"({"schemaVersion":1,"tracks":{")") + favoriteKey + R"(":false}})");
    web.close();
    state.refresh();
    QVERIFY(!state.favorite(QString::fromUtf8(favoriteKey)));

    QFile webLists(dir.filePath(".Clair/playlists.json"));
    QVERIFY(webLists.open(QIODevice::WriteOnly | QIODevice::Truncate));
    webLists.write(QByteArray(R"({"schemaVersion":1,"lists":[{"name":"Web 歌单","paths":[")") + favoriteKey + R"("]}]})");
    webLists.close();
    QFile webResume(dir.filePath(".Clair/resume.json"));
    QVERIFY(webResume.open(QIODevice::WriteOnly | QIODevice::Truncate));
    webResume.write(QByteArray(R"({"schemaVersion":1,"lastPath":")") + favoriteKey +
                    QByteArray("\",\"bookmarks\":{\"") + favoriteKey + R"(":9876}})");
    webResume.close();
    state.refresh();
    QCOMPARE(state.playlistTracks("Web 歌单"), QStringList{QString::fromUtf8(favoriteKey)});
    QCOMPARE(state.resume().value("bookmarks").toMap().value(QString::fromUtf8(favoriteKey)).toLongLong(), 9876);
}

void SharedStateTest::refusesMalformedFile()
{
    QTemporaryDir dir;
    QVERIFY(QDir().mkpath(dir.filePath(".Clair")));
    QFile file(dir.filePath(".Clair/favorites.json"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.write("user data that is not JSON");
    file.close();
    SharedState state;
    state.setRoot(dir.path());
    state.setFavorite("Song.mp3", true);
    QVERIFY(!state.errorString().isEmpty());
    QVERIFY(file.open(QIODevice::ReadOnly));
    QCOMPARE(file.readAll(), QByteArray("user data that is not JSON"));
}

void SharedStateTest::refusesWrongFieldTypes_data()
{
    QTest::addColumn<QString>("name");
    QTest::addColumn<QByteArray>("contents");
    QTest::newRow("favorites-tracks-string") << QString("favorites.json") << QByteArray(R"({"schemaVersion":1,"tracks":"do not discard"})");
    QTest::newRow("playlists-lists-object") << QString("playlists.json") << QByteArray(R"({"schemaVersion":1,"lists":{"important":"data"}})");
    QTest::newRow("playlists-nested-paths") << QString("playlists.json") << QByteArray(R"({"schemaVersion":1,"lists":[{"name":"keep","paths":{"important":"data"}}]})");
    QTest::newRow("resume-bookmarks-array") << QString("resume.json") << QByteArray(R"({"schemaVersion":1,"bookmarks":[123]})");
}

void SharedStateTest::refusesWrongFieldTypes()
{
    QFETCH(QString, name);
    QFETCH(QByteArray, contents);
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    QVERIFY(QDir().mkpath(dir.filePath(".Clair")));
    QFile file(dir.filePath(".Clair/" + name));
    QVERIFY(file.open(QIODevice::WriteOnly));
    QCOMPARE(file.write(contents), contents.size());
    file.close();
    SharedState state;
    state.setRoot(dir.path());
    if (name == "favorites.json") state.setFavorite("Song.mp3", true);
    else if (name == "playlists.json") state.createPlaylist("New");
    else state.saveResume("Song.mp3", 1234);
    QVERIFY(!state.errorString().isEmpty());
    QVERIFY(file.open(QIODevice::ReadOnly));
    QCOMPARE(file.readAll(), contents);
}

void SharedStateTest::positionUpdatesDoNotReplaceSelectedTrack()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    SharedState state;
    state.setRoot(dir.path());
    state.selectResume("Songs/one.mp3");
    state.saveResume("Songs/one.mp3", 12000);
    state.saveResume("Songs/two.mp3", 9000);
    QCOMPARE(state.resume().value("lastPath").toString(), "Songs/one.mp3");
    QCOMPARE(state.resume().value("bookmarks").toMap().value("Songs/one.mp3").toLongLong(), 12000);
    QCOMPARE(state.resume().value("bookmarks").toMap().value("Songs/two.mp3").toLongLong(), 9000);
    state.selectResume("Songs/two.mp3");
    QCOMPARE(state.resume().value("lastPath").toString(), "Songs/two.mp3");
    QCOMPARE(state.resume().value("bookmarks").toMap().value("Songs/two.mp3").toLongLong(), 9000);
}

void SharedStateTest::migratesRenamedTrackReferences()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    SharedState state;
    state.setRoot(dir.path());
    state.setFavorite("Songs/old.mp3", true);
    state.createPlaylist("My list");
    state.addToPlaylist("My list", "Songs/old.mp3");
    state.addToPlaylist("My list", "Songs/new.mp3");
    state.selectResume("Songs/old.mp3");
    state.saveResume("Songs/old.mp3", 4321);
    QVERIFY(state.migrateKey("Songs/old.mp3", "Songs/new.mp3"));
    QVERIFY(!state.favorite("Songs/old.mp3"));
    QVERIFY(state.favorite("Songs/new.mp3"));
    QCOMPARE(state.playlistTracks("My list"), QStringList{"Songs/new.mp3"});
    QCOMPARE(state.resume().value("lastPath").toString(), "Songs/new.mp3");
    const auto bookmarks = state.resume().value("bookmarks").toMap();
    QVERIFY(!bookmarks.contains("Songs/old.mp3"));
    QCOMPARE(bookmarks.value("Songs/new.mp3").toLongLong(), 4321);
}

void SharedStateTest::refusesRenameMigrationWhenAnyFileIsMalformed()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    SharedState state;
    state.setRoot(dir.path());
    state.setFavorite("Songs/old.mp3", true);
    QFile file(dir.filePath(".Clair/playlists.json"));
    QVERIFY(file.open(QIODevice::WriteOnly));
    const QByteArray original = R"({"schemaVersion":1,"lists":"private data"})";
    QCOMPARE(file.write(original), original.size());
    file.close();
    QVERIFY(!state.migrateKey("Songs/old.mp3", "Songs/new.mp3"));
    QVERIFY(file.open(QIODevice::ReadOnly));
    QCOMPARE(file.readAll(), original);
    file.close();
    QFile favorites(dir.filePath(".Clair/favorites.json"));
    QVERIFY(favorites.open(QIODevice::ReadOnly));
    const auto values = QJsonDocument::fromJson(favorites.readAll()).object().value("tracks").toObject();
    QVERIFY(values.value("Songs/old.mp3").toBool());
    QVERIFY(!values.contains("Songs/new.mp3"));
}

QTEST_GUILESS_MAIN(SharedStateTest)
#include "sharedstate_test.moc"
