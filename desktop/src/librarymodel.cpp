#include "librarymodel.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QSettings>
#include <QSet>
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

QString pathKey(const QString &path)
{
#ifdef Q_OS_WIN
    return QDir::fromNativeSeparators(path).toCaseFolded();
#else
    return QDir::fromNativeSeparators(path);
#endif
}

QString overrideKey(const QString &path)
{
    return QStringLiteral("trackOverrides/") +
        QString::fromLatin1(QCryptographicHash::hash(pathKey(path).toUtf8(), QCryptographicHash::Sha256).toHex());
}

void appendTrack(const QFileInfo &info, const QString &relative,
                 QJsonObject saved, QSet<QString> &seen, QVector<ClairTrack> &tracks)
{
    if (!info.isFile() || !isAudioFile(info))
        return;
    const QString canonical = info.canonicalFilePath();
    if (canonical.isEmpty() || seen.contains(pathKey(canonical)))
        return;
    seen.insert(pathKey(canonical));
    if (saved.contains("fileSize") && saved.value("fileSize").toInteger(-1) != info.size())
        saved = {};

    ClairTrack track;
    track.path = canonical;
    track.relativePath = relative;
    track.title = saved.value("title").toString().trimmed();
    track.artist = saved.value("artist").toString().trimmed();
    track.album = saved.value("album").toString().trimmed();
    if (track.title.isEmpty()) track.title = info.completeBaseName();
    if (track.artist.isEmpty()) track.artist = QStringLiteral("未知艺术家");
    if (track.album.isEmpty()) track.album = info.dir().dirName();
    tracks.append(std::move(track));
}

void scanDirectory(const QDir &root, const QDir &current,
                   const QHash<QString, QJsonObject> &index,
                   QSet<QString> &seen, QVector<ClairTrack> &tracks)
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
            scanDirectory(root, QDir(info.absoluteFilePath()), index, seen, tracks);
            continue;
        }
        const QString relative = QDir::fromNativeSeparators(root.relativeFilePath(info.absoluteFilePath()));
        appendTrack(info, relative, index.value(relative), seen, tracks);
    }
}

} // namespace

LibraryModel::LibraryModel(QObject *parent) : QAbstractListModel(parent)
{
    connect(&m_watcher, &QFutureWatcher<ClairScanResult>::finished, this, [this] {
        const auto result = m_watcher.result();
        beginResetModel();
        m_tracks = result.tracks;
        applyOverrides();
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

QString LibraryModel::sourceSummary() const
{
    if (m_rootDirectory.isEmpty() && m_importedFiles.isEmpty())
        return QStringLiteral("尚未添加音乐来源");
    if (m_rootDirectory.isEmpty())
        return QStringLiteral("已记录 %1 个单独文件").arg(m_importedFiles.size());
    if (m_importedFiles.isEmpty())
        return m_rootDirectory;
    return QStringLiteral("%1  ·  另有 %2 个单独文件")
        .arg(m_rootDirectory).arg(m_importedFiles.size());
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
        emit sourcesChanged();
    }
    reload();
}

void LibraryModel::addFiles(const QVariantList &files)
{
    if (m_loading)
        return;
    bool changed = false;
    for (const auto &value : files) {
        const QFileInfo info(value.toUrl().toLocalFile());
        const QString path = info.canonicalFilePath();
        if (path.isEmpty() || !info.isFile() || !isAudioFile(info))
            continue;
        if (std::none_of(m_importedFiles.cbegin(), m_importedFiles.cend(),
                         [&path](const QString &existing) { return pathKey(existing) == pathKey(path); })) {
            m_importedFiles.append(path);
            changed = true;
        }
    }
    if (!changed) {
        setErrorString(QStringLiteral("没有新增可读取的 FLAC、MP3 或 WAV 文件。"));
        return;
    }
    emit importedFilesChanged();
    emit sourcesChanged();
    reload();
}

void LibraryModel::removeImportedFile(const QString &path)
{
    if (m_loading)
        return;
    if (m_importedFiles.removeAll(path) == 0)
        return;
    emit importedFilesChanged();
    emit sourcesChanged();
    reload();
}

void LibraryModel::clearFolder()
{
    if (m_loading || m_rootDirectory.isEmpty())
        return;
    m_rootDirectory.clear();
    emit rootDirectoryChanged();
    emit sourcesChanged();
    reload();
}

void LibraryModel::restoreSources(const QUrl &folder, const QStringList &files)
{
    if (m_loading)
        return;
    m_rootDirectory = folder.toLocalFile();
    m_importedFiles = files;
    emit rootDirectoryChanged();
    emit importedFilesChanged();
    emit sourcesChanged();
    if (!m_rootDirectory.isEmpty() || !m_importedFiles.isEmpty())
        reload();
}

void LibraryModel::reload()
{
    if (m_loading)
        return;
    setErrorString({});
    emit scanStarted();
    beginResetModel();
    m_tracks.clear();
    endResetModel();
    emit countChanged();
    m_loading = true;
    emit loadingChanged();
    const QString root = m_rootDirectory;
    const QStringList files = m_importedFiles;
    m_watcher.setFuture(QtConcurrent::run([root, files] { return scanSources(root, files); }));
}

QUrl LibraryModel::sourceAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? QUrl::fromLocalFile(m_tracks.at(index).path) : QUrl();
}

QString LibraryModel::titleAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? m_tracks.at(index).title : QString();
}

QString LibraryModel::artistAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? m_tracks.at(index).artist : QString();
}

QString LibraryModel::albumAt(int index) const
{
    return index >= 0 && index < m_tracks.size() ? m_tracks.at(index).album : QString();
}

QString LibraryModel::groupAt(int index, const QString &kind) const
{
    if (index < 0 || index >= m_tracks.size()) return {};
    const auto &track = m_tracks.at(index);
    if (kind == QStringLiteral("艺术家")) return track.artist;
    if (kind == QStringLiteral("专辑")) return track.album;
    if (kind == QStringLiteral("文件夹")) return QFileInfo(track.path).dir().absolutePath();
    return QStringLiteral("全部曲目");
}

bool LibraryModel::editTrack(int index, const QString &title, const QString &artist)
{
    if (index < 0 || index >= m_tracks.size() || title.trimmed().isEmpty()) {
        setErrorString(QStringLiteral("歌名不能为空。"));
        return false;
    }
    auto &track = m_tracks[index];
    track.title = title.trimmed();
    track.artist = artist.trimmed().isEmpty() ? QStringLiteral("未知艺术家") : artist.trimmed();
    saveOverride(track);
    emit dataChanged(this->index(index), this->index(index), {TitleRole, ArtistRole});
    setErrorString({});
    return true;
}

bool LibraryModel::renameTrackFile(int index, const QString &baseName)
{
    if (index < 0 || index >= m_tracks.size()) return false;
    const QString name = baseName.trimmed();
    if (name.isEmpty() || name.endsWith('.') || name.contains(QRegularExpression(QStringLiteral(R"([<>:"/\\|?*\x00-\x1f])")))) {
        setErrorString(QStringLiteral("文件名为空或包含非法字符。"));
        return false;
    }
    auto &track = m_tracks[index];
    const QFileInfo oldInfo(track.path);
    const QString oldPath = track.path;
    const QString newPath = oldInfo.dir().filePath(name + '.' + oldInfo.suffix());
    if (pathKey(oldPath) == pathKey(newPath)) return true;
    if (QFileInfo::exists(newPath) || !QFile::rename(oldPath, newPath)) {
        setErrorString(QStringLiteral("无法重命名文件：目标已存在或文件正在使用。请先停止播放。"));
        return false;
    }
    track.path = QFileInfo(newPath).canonicalFilePath();
    track.relativePath = QFileInfo(track.relativePath).dir().filePath(QFileInfo(newPath).fileName());
    track.title = name;
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.remove(overrideKey(oldPath));
    saveOverride(track);
    for (QString &path : m_importedFiles) {
        if (pathKey(path) == pathKey(oldPath)) path = track.path;
    }
    emit importedFilesChanged();
    emit dataChanged(this->index(index), this->index(index));
    setErrorString({});
    return true;
}

void LibraryModel::saveOverride(const ClairTrack &track)
{
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.setValue(overrideKey(track.path), QStringList{track.title, track.artist});
}

void LibraryModel::applyOverrides()
{
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    for (auto &track : m_tracks) {
        const QStringList fields = settings.value(overrideKey(track.path)).toStringList();
        if (fields.size() == 2 && !fields.at(0).trimmed().isEmpty()) {
            track.title = fields.at(0);
            track.artist = fields.at(1);
        }
    }
}

ClairScanResult LibraryModel::scanSources(const QString &rootPath, const QStringList &extraFiles)
{
    ClairScanResult result;
    QSet<QString> seen;
    if (!rootPath.isEmpty()) {
        const QDir root(rootPath);
        if (!root.exists()) {
            result.error = QStringLiteral("已记录的音乐目录无法访问；请重新选择或移除来源。");
        } else {
            const auto index = loadIndex(rootPath);
            scanDirectory(root, root, index, seen, result.tracks);
        }
    }
    int missingFiles = 0;
    for (const QString &path : extraFiles) {
        const QFileInfo info(path);
        if (!info.exists()) {
            ++missingFiles;
            continue;
        }
        appendTrack(info, info.fileName(), {}, seen, result.tracks);
    }
    if (missingFiles > 0) {
        if (!result.error.isEmpty()) result.error += ' ';
        result.error += QStringLiteral("另有 %1 个已记录文件暂时无法访问。").arg(missingFiles);
    }
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
