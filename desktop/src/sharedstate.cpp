#include "sharedstate.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSaveFile>
#include <QDateTime>

namespace {
constexpr auto kFavorites = "favorites.json";
constexpr auto kPlaylists = "playlists.json";
constexpr auto kResume = "resume.json";

bool validKey(const QString &key)
{
    return !key.isEmpty() && key.size() <= 2048 && !key.contains(QChar::Null);
}

bool validDocument(const QString &name, const QJsonObject &value)
{
    if (value.value("schemaVersion").toInt() != 1) return false;
    if (name == QLatin1String(kFavorites)) {
        if (!value.value("tracks").isObject()) return false;
        const auto tracks = value.value("tracks").toObject();
        for (auto it = tracks.begin(); it != tracks.end(); ++it)
            if (!it.value().isBool()) return false;
    } else if (name == QLatin1String(kPlaylists)) {
        if (!value.value("lists").isArray()) return false;
        for (const auto &entry : value.value("lists").toArray()) {
            if (!entry.isObject()) return false;
            const auto list = entry.toObject();
            if (!list.value("name").isString() || !list.value("paths").isArray()) return false;
            for (const auto &path : list.value("paths").toArray())
                if (!path.isString()) return false;
        }
    } else if (name == QLatin1String(kResume)) {
        if (!value.value("bookmarks").isObject()) return false;
        if (value.contains("lastPath") && !value.value("lastPath").isString()) return false;
        if (value.contains("updatedAt") && !value.value("updatedAt").isString()) return false;
        const auto bookmarks = value.value("bookmarks").toObject();
        for (auto it = bookmarks.begin(); it != bookmarks.end(); ++it)
            if (!it.value().isDouble() || it.value().toDouble() < 0) return false;
    }
    return true;
}
}

SharedState::SharedState(QObject *parent) : QObject(parent)
{
    m_poll.setInterval(2500);
    connect(&m_poll, &QTimer::timeout, this, &SharedState::refresh);
    m_poll.start();
}

QString SharedState::filePath(const QString &name) const
{
    return QDir(m_root).filePath(QStringLiteral(".Clair/") + name);
}

void SharedState::setError(const QString &error)
{
    if (m_error == error) return;
    m_error = error;
    emit changed();
}

bool SharedState::readFile(const QString &name, QJsonObject &result) const
{
    result = {};
    if (m_root.isEmpty()) return true;
    QFile file(filePath(name));
    if (!file.exists()) return true;
    if (!file.open(QIODevice::ReadOnly) || file.size() > 4 * 1024 * 1024) return false;
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) return false;
    result = document.object();
    return validDocument(name, result);
}

bool SharedState::writeFile(const QString &name, const QJsonObject &value)
{
    if (m_root.isEmpty()) { setError(QStringLiteral("请先选择音乐文件夹后再同步。")); return false; }
    QJsonObject old;
    if (!readFile(name, old)) {
        setError(QStringLiteral("共享状态文件损坏，未覆盖原文件：") + filePath(name));
        return false;
    }
    if (!QDir().mkpath(QDir(m_root).filePath(".Clair"))) {
        setError(QStringLiteral("无法创建共享状态目录。")); return false;
    }
    QSaveFile file(filePath(name));
    const QByteArray bytes = QJsonDocument(value).toJson(QJsonDocument::Indented);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit()) {
        setError(QStringLiteral("无法保存共享状态：") + filePath(name)); return false;
    }
    setError({});
    refresh();
    return true;
}

void SharedState::setRoot(const QString &path)
{
    const QString clean = QFileInfo(path).isDir() ? QDir(path).absolutePath() : QString();
    if (clean == m_root) return;
    m_root = clean;
    m_favorites = {};
    m_resume = {};
    m_playlists = {};
    ++m_revision;
    emit changed();
    if (!m_root.isEmpty()) seedFavoritesFromWebIndex();
    refresh();
}

void SharedState::seedFavoritesFromWebIndex()
{
    if (QFileInfo::exists(filePath(kFavorites))) return;
    QFile index(QDir(m_root).filePath(".Clair/library.json"));
    if (!index.open(QIODevice::ReadOnly) || index.size() > 16 * 1024 * 1024) return;
    const auto root = QJsonDocument::fromJson(index.readAll()).object();
    if (root.value("schemaVersion").toInt() != 1) return;
    QJsonObject tracks;
    for (const auto &value : root.value("tracks").toArray()) {
        const auto item = value.toObject();
        if (item.value("favorite").toBool() && validKey(item.value("path").toString()))
            tracks.insert(item.value("path").toString(), true);
    }
    if (!tracks.isEmpty()) writeFile(kFavorites, {{"schemaVersion", 1}, {"tracks", tracks}});
}

void SharedState::refresh()
{
    QJsonObject favorites, playlists, resume;
    if (!readFile(kFavorites, favorites) || !readFile(kPlaylists, playlists) || !readFile(kResume, resume)) {
        setError(QStringLiteral("共享状态文件格式无效；为保护数据，已停止读取与覆盖。"));
        return;
    }
    setError({});
    const auto favoriteValues = favorites.value("tracks").toObject();
    const auto listValues = playlists.value("lists").toArray();
    if (favoriteValues == m_favorites && listValues == m_playlists && resume == m_resume) return;
    m_favorites = favoriteValues;
    m_playlists = listValues;
    m_resume = resume;
    ++m_revision;
    emit changed();
}

bool SharedState::favorite(const QString &key) const
{
    return m_favorites.value(key).toBool();
}

void SharedState::setFavorite(const QString &key, bool value)
{
    if (!validKey(key)) return;
    QJsonObject document;
    if (!readFile(kFavorites, document)) { setError(QStringLiteral("收藏文件格式无效，未覆盖。")); return; }
    auto tracks = document.value("tracks").toObject();
    tracks.insert(key, value);
    writeFile(kFavorites, {{"schemaVersion", 1}, {"tracks", tracks}});
}

QStringList SharedState::playlistNames() const
{
    QStringList names;
    for (const auto &value : m_playlists) names.append(value.toObject().value("name").toString());
    return names;
}

QStringList SharedState::playlistTracks(const QString &name) const
{
    for (const auto &value : m_playlists) {
        const auto list = value.toObject();
        if (list.value("name").toString() != name) continue;
        QStringList keys;
        for (const auto &item : list.value("paths").toArray()) keys.append(item.toString());
        return keys;
    }
    return {};
}

void SharedState::createPlaylist(const QString &name)
{
    const QString clean = name.trimmed();
    if (clean.isEmpty() || clean.size() > 64 || clean.contains('/') || clean.contains('\\')) {
        setError(QStringLiteral("歌单名称应为 1–64 字符，且不能包含斜杠。")); return;
    }
    QJsonObject document;
    if (!readFile(kPlaylists, document)) { setError(QStringLiteral("歌单文件格式无效，未覆盖。")); return; }
    auto lists = document.value("lists").toArray();
    for (const auto &value : lists) if (value.toObject().value("name").toString() == clean) return;
    lists.append(QJsonObject{{"name", clean}, {"paths", QJsonArray{}}});
    writeFile(kPlaylists, {{"schemaVersion", 1}, {"lists", lists}});
}

void SharedState::addToPlaylist(const QString &name, const QString &key)
{
    if (!validKey(key)) return;
    QJsonObject document;
    if (!readFile(kPlaylists, document)) { setError(QStringLiteral("歌单文件格式无效，未覆盖。")); return; }
    auto lists = document.value("lists").toArray();
    for (qsizetype i = 0; i < lists.size(); ++i) {
        auto list = lists.at(i).toObject();
        if (list.value("name").toString() != name) continue;
        auto paths = list.value("paths").toArray();
        if (!paths.contains(key)) paths.append(key);
        list.insert("paths", paths);
        lists.replace(i, list);
        writeFile(kPlaylists, {{"schemaVersion", 1}, {"lists", lists}});
        return;
    }
    setError(QStringLiteral("请先创建或选择歌单。"));
}

void SharedState::removeFromPlaylist(const QString &name, const QString &key)
{
    QJsonObject document;
    if (!readFile(kPlaylists, document)) { setError(QStringLiteral("歌单文件格式无效，未覆盖。")); return; }
    auto lists = document.value("lists").toArray();
    for (qsizetype i = 0; i < lists.size(); ++i) {
        auto list = lists.at(i).toObject();
        if (list.value("name").toString() != name) continue;
        auto paths = list.value("paths").toArray();
        for (qsizetype j = paths.size(); j-- > 0;)
            if (paths.at(j).toString() == key) paths.removeAt(j);
        list.insert("paths", paths);
        lists.replace(i, list);
        writeFile(kPlaylists, {{"schemaVersion", 1}, {"lists", lists}});
        return;
    }
}

void SharedState::selectResume(const QString &key)
{
    if (!validKey(key) || m_root.isEmpty()) return;
    QJsonObject document;
    if (!readFile(kResume, document)) { setError(QStringLiteral("播放进度文件格式无效，未覆盖。")); return; }
    document.insert("schemaVersion", 1);
    document.insert("lastPath", key);
    if (!document.value("bookmarks").isObject()) document.insert("bookmarks", QJsonObject{});
    document.insert("updatedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    writeFile(kResume, document);
}

void SharedState::saveResume(const QString &key, qint64 positionMs)
{
    if (!validKey(key) || m_root.isEmpty()) return;
    QJsonObject document;
    if (!readFile(kResume, document)) { setError(QStringLiteral("播放进度文件格式无效，未覆盖。")); return; }
    auto bookmarks = document.value("bookmarks").toObject();
    bookmarks.insert(key, qMax(qint64(0), positionMs));
    document.insert("schemaVersion", 1);
    document.insert("bookmarks", bookmarks);
    document.insert("updatedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    writeFile(kResume, document);
}

bool SharedState::migrateKey(const QString &oldKey, const QString &newKey)
{
    if (!validKey(oldKey) || !validKey(newKey) || m_root.isEmpty()) return false;
    if (oldKey == newKey) return true;

    // Validate every source before writing any of the three files. A corrupt
    // playlist must not leave an otherwise-successful rename half-migrated.
    QJsonObject favorites, playlists, resume;
    if (!readFile(kFavorites, favorites) || !readFile(kPlaylists, playlists) || !readFile(kResume, resume)) {
        setError(QStringLiteral("共享状态文件格式无效；重命名后的状态路径未迁移，请保留原文件。"));
        return false;
    }

    bool favoritesChanged = false;
    auto tracks = favorites.value("tracks").toObject();
    if (tracks.contains(oldKey)) {
        const bool favorite = tracks.take(oldKey).toBool();
        tracks.insert(newKey, favorite || tracks.value(newKey).toBool());
        favorites.insert("schemaVersion", 1);
        favorites.insert("tracks", tracks);
        favoritesChanged = true;
    }

    bool playlistsChanged = false;
    auto lists = playlists.value("lists").toArray();
    for (qsizetype i = 0; i < lists.size(); ++i) {
        auto list = lists.at(i).toObject();
        auto paths = list.value("paths").toArray();
        QJsonArray migrated;
        bool changed = false;
        for (const auto &entry : paths) {
            const QString path = entry.toString() == oldKey ? newKey : entry.toString();
            if (entry.toString() == oldKey) changed = true;
            if (!migrated.contains(path)) migrated.append(path);
        }
        if (!changed) continue;
        list.insert("paths", migrated);
        lists.replace(i, list);
        playlistsChanged = true;
    }
    if (playlistsChanged) {
        playlists.insert("schemaVersion", 1);
        playlists.insert("lists", lists);
    }

    bool resumeChanged = false;
    auto bookmarks = resume.value("bookmarks").toObject();
    if (bookmarks.contains(oldKey)) {
        bookmarks.insert(newKey, bookmarks.take(oldKey));
        resume.insert("bookmarks", bookmarks);
        resumeChanged = true;
    }
    if (resume.value("lastPath").toString() == oldKey) {
        resume.insert("lastPath", newKey);
        resumeChanged = true;
    }
    if (resumeChanged) {
        resume.insert("schemaVersion", 1);
        resume.insert("updatedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    }

    if (favoritesChanged && !writeFile(kFavorites, favorites)) return false;
    if (playlistsChanged && !writeFile(kPlaylists, playlists)) return false;
    if (resumeChanged && !writeFile(kResume, resume)) return false;
    return true;
}
