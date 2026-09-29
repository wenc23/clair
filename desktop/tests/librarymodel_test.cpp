#include "../src/librarymodel.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>

namespace {

bool writeFile(const QString &path, const QByteArray &bytes = {})
{
    QFile file(path);
    return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
}

} // namespace

class LibraryModelTest final : public QObject {
    Q_OBJECT

private slots:
    void scansGeneralMusicAndReadsLegacyIndexWithoutWriting();
    void scansUnicodePathsAndIgnoresStaleIndexEntry();
    void clearsOldTracksWhileSwitchingFolders();
    void rejectsInvalidFolder();
    void importsArbitraryFilesAndEditsTitles();
    void refreshesAfterExternalDeletion();
};

void LibraryModelTest::scansGeneralMusicAndReadsLegacyIndexWithoutWriting()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    QDir root(temporary.path());
    QVERIFY(root.mkpath("Rock/Album"));
    QVERIFY(root.mkpath(".Clair"));
    QVERIFY(root.mkpath(".Clair 回收站"));
    QVERIFY(writeFile(root.filePath("Rock/Album/01 Song.FLAC")));
    QVERIFY(writeFile(root.filePath("Rock/Album/02 Song.mp3")));
    QVERIFY(writeFile(root.filePath("Rock/Album/notes.txt")));
    QVERIFY(writeFile(root.filePath(".Clair 回收站/deleted.wav")));

    const QByteArray index = R"({"schemaVersion":1,"tracks":[{"path":")" +
        QFileInfo(root.path()).fileName().toUtf8() +
        R"(/Rock/Album/01 Song.FLAC","title":"Saved title","artist":"Band","album":"Record"}]})";
    QVERIFY(writeFile(root.filePath(".Clair/library.json"), index));

    LibraryModel model;
    QSignalSpy finished(&model, &LibraryModel::loadingChanged);
    model.openFolder(QUrl::fromLocalFile(root.path()));
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(finished.size(), 2);
    QCOMPARE(model.count(), 2);
    QCOMPARE(model.data(model.index(0), LibraryModel::TitleRole).toString(), "Saved title");
    QCOMPARE(model.data(model.index(0), LibraryModel::ArtistRole).toString(), "Band");
    QCOMPARE(model.data(model.index(1), LibraryModel::TitleRole).toString(), "02 Song");
    QCOMPARE(model.data(model.index(1), LibraryModel::ArtistRole).toString(), QStringLiteral("未知艺术家"));
    QVERIFY(model.sourceAt(0).isLocalFile());
    QVERIFY(!QFile::exists(root.filePath(".Clair/settings.json")));
}

void LibraryModelTest::rejectsInvalidFolder()
{
    LibraryModel model;
    model.openFolder(QUrl("https://example.com/music"));
    QVERIFY(!model.loading());
    QVERIFY(!model.errorString().isEmpty());
    QCOMPARE(model.count(), 0);
}

void LibraryModelTest::scansUnicodePathsAndIgnoresStaleIndexEntry()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    QDir root(temporary.path());
    QVERIFY(root.mkpath(QStringLiteral("流行音乐/中文专辑")));
    QVERIFY(root.mkpath(".Clair"));
    const QString relative = QStringLiteral("流行音乐/中文专辑/歌曲.wav");
    QVERIFY(writeFile(root.filePath(relative), "RIFF"));
    const QJsonObject staleTrack {
        {"path", QFileInfo(root.path()).fileName() + '/' + relative},
        {"fileSize", 999},
        {"title", "Stale title"},
    };
    const QJsonObject index {
        {"schemaVersion", 1},
        {"tracks", QJsonArray{staleTrack}},
    };
    QVERIFY(writeFile(root.filePath(".Clair/library.json"), QJsonDocument(index).toJson()));

    LibraryModel model;
    model.openFolder(QUrl::fromLocalFile(root.path()));
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.count(), 1);
    QCOMPARE(model.titleAt(0), QStringLiteral("歌曲"));
    QCOMPARE(model.data(model.index(0), LibraryModel::AlbumRole).toString(), QStringLiteral("中文专辑"));
}

void LibraryModelTest::clearsOldTracksWhileSwitchingFolders()
{
    QTemporaryDir first;
    QTemporaryDir second;
    QVERIFY(first.isValid());
    QVERIFY(second.isValid());
    QVERIFY(writeFile(QDir(first.path()).filePath("old.mp3")));
    QVERIFY(writeFile(QDir(second.path()).filePath("new.flac")));

    LibraryModel model;
    model.openFolder(QUrl::fromLocalFile(first.path()));
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.titleAt(0), "old");

    model.openFolder(QUrl::fromLocalFile(second.path()));
    QVERIFY(model.loading());
    QCOMPARE(model.count(), 0);
    QVERIFY(model.sourceAt(0).isEmpty());
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.titleAt(0), "new");
}

void LibraryModelTest::importsArbitraryFilesAndEditsTitles()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    QDir root(temporary.path());
    QVERIFY(root.mkpath("A"));
    QVERIFY(root.mkpath("B"));
    const QString first = root.filePath("A/one.mp3");
    const QString second = root.filePath("B/two.wav");
    QVERIFY(writeFile(first));
    QVERIFY(writeFile(second));

    LibraryModel model;
    model.addFiles({QUrl::fromLocalFile(first), QUrl::fromLocalFile(second)});
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.count(), 2);
    QCOMPARE(model.importedFiles().size(), 2);
    QCOMPARE(model.groupAt(0, QStringLiteral("文件夹")), QFileInfo(first).dir().absolutePath());
    QVERIFY(model.editTrack(0, "Better name", "Better artist"));
    QCOMPARE(model.titleAt(0), "Better name");
    QCOMPARE(model.artistAt(0), "Better artist");

    LibraryModel restored;
    restored.restoreSources({}, model.importedFiles());
    QTRY_VERIFY_WITH_TIMEOUT(!restored.loading(), 5000);
    QCOMPARE(restored.titleAt(0), "Better name");
    QVERIFY(restored.renameTrackFile(0, "renamed"));
    QVERIFY(QFileInfo::exists(root.filePath("A/renamed.mp3")));
    QVERIFY(!QFileInfo::exists(first));
    QCOMPARE(restored.titleAt(0), "renamed");
    QVERIFY(!restored.renameTrackFile(0, "../escape"));
    QCOMPARE(restored.count(), 2);
    restored.removeImportedFile(restored.importedFiles().first());
    QTRY_VERIFY_WITH_TIMEOUT(!restored.loading(), 5000);
    QCOMPARE(restored.count(), 1);
}

void LibraryModelTest::refreshesAfterExternalDeletion()
{
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    const QString song = QDir(temporary.path()).filePath("song.mp3");
    QVERIFY(writeFile(song));
    LibraryModel model;
    model.openFolder(QUrl::fromLocalFile(temporary.path()));
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.count(), 1);
    QVERIFY(!model.openTrackFolder(-1));
    QVERIFY(QFile::remove(song));
    QVERIFY(!model.openTrackFolder(0));
    QVERIFY(model.errorString().contains(QStringLiteral("不存在")));
    model.refresh();
    QTRY_VERIFY_WITH_TIMEOUT(!model.loading(), 5000);
    QCOMPARE(model.count(), 0);
}

QTEST_GUILESS_MAIN(LibraryModelTest)
#include "librarymodel_test.moc"
