#include "librarymodel.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QtConcurrent>

#include <algorithm>
#include <utility>

namespace {

QString normalizedRelativePath(QString path, const QString &rootName)
{
    path = QDir::fromNativeSeparators(path);
    if (path.startsWith(rootName + '/', Qt::CaseInsensitive))
        path = path.mid(rootName.size() + 1);
    path = QDir::cleanPath(path);
    if (path == "." || path == ".." || path.startsWith("../") || QDir::isAbsolutePath(path))
        return {};
    return path;
}

QHash<QString, QJsonObject> loadIndex(const QString &rootPath)
{
    QFile file(QDir(rootPath).filePath(".Clair/library.json"));
    if (!file.open(QIODevice::ReadOnly))
        return {};
    const auto document = QJsonDocument::fromJson(file.readAll());
    const auto root = document.object();
    if (root.value("schemaVersion").toInt() != 1)
        return {};

    QHash<QString, QJsonObject> byPath;
    const QString rootName = QFileInfo(rootPath).fileName();
    for (const auto &value : root.value("tracks").toArray()) {
        const auto track = value.toObject();
        const auto relative = normalizedRelativePath(track.value("path").toString(), rootName);
        if (!relative.isEmpty())
            byPath.insert(relative, track);
    }
    return byPath;
}

bool isAudioFile(const QFileInfo &info)
{
    const auto suffix = info.suffix().toLower();
    return suffix == "flac" || suffix == "mp3" || suffix == "wav";
}

void scanDirectory(const QDir &root, const QDir &current,
                   const QHash<QString, QJsonObject> &index, QVector<ClairTrack> &tracks)
{
    const auto entries = current.entryInfoList(QDir::Dirs | QDir::Files | QDir::NoDotAndDotDot | QDir::NoSymLinks,
                                               QDir::Name | QDir::IgnoreCase);
    for (const auto &info : entries) {
        if (info.isSymbolicLink() || info.isJunction())
            continue;
        if (info.isDir()) {
            if (info.fileName().compare(".Clair", Qt::CaseInsensitive) == 0 ||
                info.fileName().compare(".Clair 回收站", Qt::CaseInsensitive) == 0)
                continue;
            scanDirectory(root, QDir(info.absoluteFilePath()), index, tracks);
            continue;
        }
        if (!isAudioFile(info))
            continue;
        const QString relative = QDir::fromNativeSeparators(root.relativeFilePath(info.absoluteFilePath()));
        auto saved = index.value(relative);
        if (saved.contains("fileSize") && saved.value("fileSize").toInteger(-1) != info.size())
            saved = {};
        ClairTrack track;
        track.path = info.absoluteFilePath();
        track.relativePath = relative;
        track.title = saved.value("title").toString().trimmed();
        track.artist = saved.value("artist").toString().trimmed();
        track.album = saved.value("album").toString().trimmed();
        if (track.title.isEmpty())
            track.title = info.completeBaseName();
        if (track.artist.isEmpty())
            track.artist = QStringLiteral("未知艺术家");
        if (track.album.isEmpty())
            track.album = info.dir().dirName();
        tracks.append(std::move(track));
    }
}

} // namespace

LibraryModel::LibraryModel(QObject *parent) : QAbstractListModel(parent)
{
    connect(&m_watcher, &QFutureWatcher<ClairScanResult>::finished, this, [this] {
        const auto result = m_watcher.result();
        beginResetModel();
        m_tracks = result.tracks;
        endResetModel();
        emit countChanged();
        setErrorString(result.error);
        m_loading = false;
        emit loadingChanged();
    });
}

int LibraryModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : m_tracks.size();
}

QVariant LibraryModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_tracks.size())
        return {};
    const auto &track = m_tracks.at(index.row());
    switch (role) {
    case TitleRole: return track.title;
    case ArtistRole: return track.artist;
    case AlbumRole: return track.album;
    case SourceRole: return QUrl::fromLocalFile(track.path);
    case RelativePathRole: return track.relativePath;
    default: return {};
    }
}

QHash<int, QByteArray> LibraryModel::roleNames() const
{
    return {
        {TitleRole, "title"},
        {ArtistRole, "artist"},
        {AlbumRole, "album"},
        {SourceRole, "source"},
        {RelativePathRole, "relativePath"},
    };
}

void LibraryModel::openFolder(const QUrl &folder)
{
    if (m_loading)
        return;
    const QString path = QFileInfo(folder.toLocalFile()).canonicalFilePath();
    if (path.isEmpty() || !QFileInfo(path).isDir()) {
        setErrorString(QStringLiteral("请选择一个可访问的本地音乐目录。"));
        return;
    }
    if (m_rootDirectory != path) {
        m_rootDirectory = path;
        emit rootDirectoryChanged();
    }
    setErrorString({});
    emit scanStarted();
    beginResetModel();
    m_tracks.clear();
    endResetModel();
    emit countChanged();
    m_loading = true;
    emit loadingChanged();
    m_watcher.setFuture(QtConcurrent::run([path] { return scanFolder(path); }));
}

QUrl LibraryModel::sourceAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? QUrl::fromLocalFile(m_tracks.at(index).path) : QUrl();
}

QString LibraryModel::titleAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? m_tracks.at(index).title : QString();
}

ClairScanResult LibraryModel::scanFolder(const QString &rootPath)
{
    ClairScanResult result;
    const QDir root(rootPath);
    if (!root.exists()) {
        result.error = QStringLiteral("音乐目录已不存在或无法访问。");
        return result;
    }
    const auto index = loadIndex(rootPath);
    scanDirectory(root, root, index, result.tracks);
    std::sort(result.tracks.begin(), result.tracks.end(), [](const ClairTrack &a, const ClairTrack &b) {
        const int artist = QString::compare(a.artist, b.artist, Qt::CaseInsensitive);
        if (artist != 0) return artist < 0;
        const int album = QString::compare(a.album, b.album, Qt::CaseInsensitive);
        if (album != 0) return album < 0;
        return QString::compare(a.relativePath, b.relativePath, Qt::CaseInsensitive) < 0;
    });
    return result;
}

void LibraryModel::setErrorString(const QString &error)
{
    if (m_errorString == error)
        return;
    m_errorString = error;
    emit errorStringChanged();
}
