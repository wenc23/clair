#include "lyricsservice.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSettings>
#include <QStandardPaths>
#include <QUrlQuery>

LyricsService::LyricsService(QObject *parent) : QObject(parent) {}

QVariantList LyricsService::lines() const
{
    QVariantList result;
    for (const auto &line : m_lines)
        result.append(QVariantMap{{"timeMs", line.timeMs}, {"text", line.text}});
    return result;
}

QString LyricsService::keyForCurrentTrack() const
{
    return QStringLiteral("lyrics/") + QString::fromLatin1(
        QCryptographicHash::hash(m_trackPath.toUtf8(), QCryptographicHash::Sha256).toHex());
}

void LyricsService::loadText(const QByteArray &bytes, const QString &origin)
{
    const QString contents = QString::fromUtf8(bytes);
    m_lines = parseLrc(contents);
    m_plainText = m_lines.isEmpty() ? contents.trimmed() : QString();
    emit lyricsChanged();
    setStatus(m_lines.isEmpty() && m_plainText.isEmpty()
                  ? QStringLiteral("歌词文件为空。")
                  : QStringLiteral("已加载歌词：") + origin);
}

void LyricsService::setStatus(const QString &status)
{
    if (m_status == status) return;
    m_status = status;
    emit statusChanged();
}

void LyricsService::loadForTrack(const QUrl &audio)
{
    m_trackPath = audio.toLocalFile();
    m_lines.clear();
    m_plainText.clear();
    m_candidates.clear();
    m_candidateLyrics.clear();
    emit lyricsChanged();
    emit candidatesChanged();
    if (m_trackPath.isEmpty()) { setStatus({}); return; }
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    QString path = settings.value(keyForCurrentTrack()).toString();
    if (!QFileInfo::exists(path)) {
        const QFileInfo audioInfo(m_trackPath);
        path = audioInfo.dir().filePath(audioInfo.completeBaseName() + ".lrc");
        if (!QFileInfo::exists(path))
            path = audioInfo.dir().filePath(audioInfo.completeBaseName() + ".LRC");
    }
    QFile file(path);
    if (file.open(QIODevice::ReadOnly)) loadText(file.readAll(), QFileInfo(path).fileName());
    else setStatus(QStringLiteral("暂无歌词。可导入 LRC，或按歌名/歌手联网搜索。"));
}

void LyricsService::importLrc(const QUrl &fileUrl)
{
    if (m_trackPath.isEmpty()) { setStatus(QStringLiteral("请先选择一首歌曲。")); return; }
    QFile file(fileUrl.toLocalFile());
    if (!file.open(QIODevice::ReadOnly)) { setStatus(QStringLiteral("无法读取所选歌词文件。")); return; }
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.setValue(keyForCurrentTrack(), file.fileName());
    loadText(file.readAll(), QFileInfo(file).fileName());
}

void LyricsService::search(const QString &title, const QString &artist)
{
    if (m_trackPath.isEmpty() || title.trimmed().isEmpty()) {
        setStatus(QStringLiteral("请先选择歌曲并填写歌名。")); return;
    }
    QUrl url(QStringLiteral("https://lrclib.net/api/search"));
    QUrlQuery query;
    query.addQueryItem("track_name", title.trimmed());
    if (!artist.trimmed().isEmpty() && artist != QStringLiteral("未知艺术家"))
        query.addQueryItem("artist_name", artist.trimmed());
    url.setQuery(query);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader,
                      QStringLiteral("ClairDesktop/0.2 (https://gitee.com/wenc23/clair)"));
    request.setTransferTimeout(15000);
    const QString requestedPath = m_trackPath;
    setStatus(QStringLiteral("正在搜索 LRCLIB…"));
    auto *reply = m_network.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, requestedPath] {
        reply->deleteLater();
        if (requestedPath != m_trackPath) return;
        m_candidates.clear();
        m_candidateLyrics.clear();
        if (reply->error() != QNetworkReply::NoError) {
            setStatus(QStringLiteral("歌词搜索失败：") + reply->errorString());
            emit candidatesChanged();
            return;
        }
        QJsonParseError error;
        const auto document = QJsonDocument::fromJson(reply->readAll(), &error);
        if (error.error != QJsonParseError::NoError || !document.isArray()) {
            setStatus(QStringLiteral("歌词服务返回了无法解析的数据。"));
            emit candidatesChanged();
            return;
        }
        for (const auto &entry : document.array()) {
            const auto item = entry.toObject();
            const QString synced = item.value("syncedLyrics").toString();
            const QString plain = item.value("plainLyrics").toString();
            if (synced.isEmpty() && plain.isEmpty()) continue;
            m_candidates.append(QVariantMap{
                {"label", item.value("trackName").toString() + " — " + item.value("artistName").toString()
                              + QStringLiteral(" (%1 秒)").arg(item.value("duration").toInt())},
                {"synced", !synced.isEmpty()}});
            m_candidateLyrics.append((synced.isEmpty() ? plain : synced).toUtf8());
            if (m_candidates.size() >= 20) break;
        }
        emit candidatesChanged();
        setStatus(m_candidates.isEmpty() ? QStringLiteral("未找到歌词；可尝试编辑歌名/歌手或导入 LRC。")
                                         : QStringLiteral("请选择匹配的歌词，应用不会自动覆盖。"));
    });
}

void LyricsService::chooseCandidate(int index)
{
    if (index < 0 || index >= m_candidateLyrics.size() || m_trackPath.isEmpty()) return;
    const QString directory = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/lyrics";
    if (!QDir().mkpath(directory)) { setStatus(QStringLiteral("无法创建本机歌词目录。")); return; }
    const QString path = QDir(directory).filePath(keyForCurrentTrack().mid(7) + ".lrc");
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate) ||
        file.write(m_candidateLyrics.at(index)) != m_candidateLyrics.at(index).size()) {
        setStatus(QStringLiteral("无法保存所选歌词。")); return;
    }
    file.close();
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    settings.setValue(keyForCurrentTrack(), path);
    loadText(m_candidateLyrics.at(index), QStringLiteral("LRCLIB 匹配结果"));
    m_candidates.clear();
    m_candidateLyrics.clear();
    emit candidatesChanged();
}

QString LyricsService::lineAtPosition(qint64 positionMs) const
{
    const int index = lineAt(m_lines, positionMs);
    return index >= 0 ? m_lines.at(index).text : QString();
}

int LyricsService::lineIndexAtPosition(qint64 positionMs) const
{
    return lineAt(m_lines, positionMs);
}
