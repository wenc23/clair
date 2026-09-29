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
#include <QRegularExpression>
#include <QSettings>
#include <QStandardPaths>
#include <QUrlQuery>

#include <algorithm>
#include <cmath>
#include <limits>

namespace {
struct SearchIdentity { QString title; QString artist; };

SearchIdentity cleanSearchIdentity(QString title, QString artist)
{
    title = title.trimmed();
    artist = artist.trimmed();
    if (artist == QStringLiteral("未知艺术家")) artist.clear();
    // Video downloads often contain a useful song name inside 《…》 and append
    // a second filename/video identifier. Do not send the whole filename to LRCLIB.
    static const QRegularExpression bookTitle(QStringLiteral("《([^》]{2,120})》"));
    const auto match = bookTitle.match(title);
    if (match.hasMatch()) {
        if (artist.isEmpty()) {
            QString prefix = title.left(match.capturedStart()).trimmed();
            prefix.remove(QRegularExpression(QStringLiteral("^[\\s\"'“”‘’–—-]+|[\\s\"'“”‘’–—-]+$")));
            if (!prefix.isEmpty() && prefix.size() <= 80) artist = prefix;
        }
        title = match.captured(1).trimmed();
    } else {
        title.remove(QRegularExpression(QStringLiteral("\\s*[-–—]\\s*\\d+\\..*$")));
        title.remove(QRegularExpression(QStringLiteral("\\s*\\(Av\\d+.*$"),
                                        QRegularExpression::CaseInsensitiveOption));
        title = title.trimmed();
    }
    return {title, artist};
}

QString folded(QString text)
{
    text = text.toCaseFolded();
    text.remove(QRegularExpression(QStringLiteral("[^\\p{L}\\p{N}]+")));
    return text;
}

int candidateScore(const QJsonObject &item, const SearchIdentity &identity, qint64 durationMs)
{
    const QString title = folded(item.value("trackName").toString());
    const QString wanted = folded(identity.title);
    const QString artist = folded(item.value("artistName").toString());
    const QString wantedArtist = folded(identity.artist);
    int score = title == wanted ? 100 : (title.contains(wanted) ? 35 : 0);
    if (!wantedArtist.isEmpty())
        score += artist == wantedArtist ? 70 : (artist.contains(wantedArtist) ? 20 : -15);
    if (!item.value("syncedLyrics").toString().isEmpty()) score += 20;
    const double duration = item.value("duration").toDouble();
    if (durationMs > 0 && duration > 0) {
        const double difference = std::abs(duration - durationMs / 1000.0);
        score += difference <= 3 ? 25 : (difference <= 10 ? 10 : -std::min(30, int(difference / 10)));
    }
    return score;
}
}

LyricsService::LyricsService(QObject *parent) : QObject(parent) {}

QVariantList LyricsService::lines() const
{
    QVariantList result;
    for (int i = 0; i < m_lines.size(); ++i)
        result.append(QVariantMap{{"timeMs", m_lines.at(i).timeMs},
                                  {"text", m_lines.at(i).text},
                                  {"sourceIndex", m_sourceIndices.at(i)}});
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
    m_originalLines = parseLrc(contents);
    m_plainText = m_originalLines.isEmpty() ? contents.trimmed() : QString();
    m_timingKey = QStringLiteral("lyrics/timing/") + keyForCurrentTrack().mid(7)
                  + QLatin1Char('/') + QString::fromLatin1(
                      QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex());
    m_offsetMs = 0;
    const QVariant saved = QSettings(QSettings::UserScope, "Clair", "ClairDesktop")
                               .value(m_timingKey);
    bool offsetValid = false;
    qint64 offset = saved.toLongLong(&offsetValid);
    // 0.3.7 stored per-line overrides. A single correction can be migrated
    // unambiguously to the new whole-song shift; multiple corrections cannot.
    if (!offsetValid && saved.metaType() == QMetaType::fromType<QVariantMap>()) {
        const QVariantMap old = saved.toMap();
        if (old.size() == 1) {
            const auto entry = old.cbegin();
            bool indexValid = false;
            bool timeValid = false;
            const int index = entry.key().toInt(&indexValid);
            const qint64 time = entry.value().toLongLong(&timeValid);
            if (indexValid && timeValid && index >= 0 && index < m_originalLines.size()) {
                offset = time - m_originalLines.at(index).timeMs;
                offsetValid = true;
            }
        }
    }
    if (offsetValid && offset >= -24 * 60 * 60 * 1000LL && offset <= 24 * 60 * 60 * 1000LL)
        m_offsetMs = offset;
    applyLineTimes();
    emit lyricsChanged();
    setStatus(m_lines.isEmpty() && m_plainText.isEmpty()
                  ? QStringLiteral("歌词文件为空。")
                  : QStringLiteral("已加载歌词：") + origin);
}

void LyricsService::applyLineTimes()
{
    m_lines.clear();
    m_sourceIndices.clear();
    m_lines.reserve(m_originalLines.size());
    m_sourceIndices.reserve(m_originalLines.size());
    for (int i = 0; i < m_originalLines.size(); ++i) {
        LrcLine line = m_originalLines.at(i);
        if (m_offsetMs > 0 && line.timeMs > std::numeric_limits<qint64>::max() - m_offsetMs)
            line.timeMs = std::numeric_limits<qint64>::max();
        else if (m_offsetMs < 0 && line.timeMs < std::numeric_limits<qint64>::min() - m_offsetMs)
            line.timeMs = std::numeric_limits<qint64>::min();
        else
            line.timeMs += m_offsetMs;
        m_lines.append(line);
        m_sourceIndices.append(i);
    }
}

bool LyricsService::saveTimingOffset()
{
    if (m_timingKey.isEmpty()) return false;
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    if (m_offsetMs == 0) settings.remove(m_timingKey);
    else settings.setValue(m_timingKey, m_offsetMs);
    settings.sync();
    return settings.status() == QSettings::NoError;
}

bool LyricsService::adjustLineTime(int sourceIndex, qint64 timeMs)
{
    if (sourceIndex < 0 || sourceIndex >= m_originalLines.size() ||
        timeMs < 0 || timeMs > 24 * 60 * 60 * 1000) {
        setStatus(QStringLiteral("歌词时间无效；请输入 0 到 24 小时内的时间。"));
        return false;
    }
    const qint64 originalTime = m_originalLines.at(sourceIndex).timeMs;
    if (originalTime < -24 * 60 * 60 * 1000LL || originalTime > 24 * 60 * 60 * 1000LL) {
        setStatus(QStringLiteral("原歌词时间异常，不能作为整体校时锚点。"));
        return false;
    }
    if (timeMs - originalTime < -24 * 60 * 60 * 1000LL ||
        timeMs - originalTime > 24 * 60 * 60 * 1000LL) {
        setStatus(QStringLiteral("整体校时幅度不能超过 24 小时。"));
        return false;
    }
    m_offsetMs = timeMs - originalTime;
    applyLineTimes();
    emit lyricsChanged();
    const bool saved = saveTimingOffset();
    setStatus(saved ? QStringLiteral("已将整首歌词平移 %1 秒，各句间隔不变；原 LRC 未修改。")
                          .arg(QString::number(m_offsetMs / 1000.0, 'f', 2))
                    : QStringLiteral("已在本次运行中整体平移歌词，但无法保存校时设置。"));
    return saved;
}

bool LyricsService::resetTimingOffset()
{
    if (m_originalLines.isEmpty()) return false;
    m_offsetMs = 0;
    applyLineTimes();
    emit lyricsChanged();
    const bool saved = saveTimingOffset();
    setStatus(saved ? QStringLiteral("已恢复整首歌词的原始时间。")
                    : QStringLiteral("已恢复本次显示，但无法保存校时设置。"));
    return saved;
}

void LyricsService::setStatus(const QString &status)
{
    if (m_status == status) return;
    m_status = status;
    emit statusChanged();
}

void LyricsService::cancelPendingSearch()
{
    ++m_searchGeneration;
    if (m_activeReply) m_activeReply->abort();
    m_activeReply.clear();
}

void LyricsService::loadForTrack(const QUrl &audio)
{
    cancelPendingSearch();
    m_trackPath = audio.toLocalFile();
    m_lines.clear();
    m_originalLines.clear();
    m_sourceIndices.clear();
    m_offsetMs = 0;
    m_timingKey.clear();
    m_plainText.clear();
    m_candidates.clear();
    m_candidateLyrics.clear();
    emit lyricsChanged();
    emit candidatesChanged();
    if (m_trackPath.isEmpty()) { setStatus({}); return; }
    QSettings settings(QSettings::UserScope, "Clair", "ClairDesktop");
    QString path = settings.value(keyForCurrentTrack()).toString();
    bool rejectedOldDraft = false;
    const QString cacheRoot = QDir(QStandardPaths::writableLocation(QStandardPaths::CacheLocation))
                                  .filePath(QStringLiteral("transcriptions"));
    const QString canonical = QDir::fromNativeSeparators(QFileInfo(path).canonicalFilePath());
    const QString canonicalCache = QDir::fromNativeSeparators(QDir(cacheRoot).canonicalPath());
    if (!canonical.isEmpty() && !canonicalCache.isEmpty() &&
        canonical.startsWith(canonicalCache + QLatin1Char('/'), Qt::CaseInsensitive)) {
        QFile draft(path);
        if (draft.open(QIODevice::ReadOnly)) {
            const QByteArray bytes = draft.read(5 * 1024 * 1024 + 1);
            const QString issue = bytes.size() > 5 * 1024 * 1024
                                      ? QStringLiteral("转写缓存过大")
                                      : transcriptionQualityIssue(parseLrc(QString::fromUtf8(bytes)));
            if (!issue.isEmpty()) {
                settings.remove(keyForCurrentTrack());
                path.clear();
                rejectedOldDraft = true;
            }
        }
    }
    if (!QFileInfo::exists(path)) {
        const QFileInfo audioInfo(m_trackPath);
        path = audioInfo.dir().filePath(audioInfo.completeBaseName() + ".lrc");
        if (!QFileInfo::exists(path))
            path = audioInfo.dir().filePath(audioInfo.completeBaseName() + ".LRC");
    }
    QFile file(path);
    if (file.open(QIODevice::ReadOnly)) loadText(file.readAll(), QFileInfo(path).fileName());
    else setStatus(rejectedOldDraft
                       ? QStringLiteral("已停用重复/无效的旧转写草稿。请搜索现成歌词，或选择歌曲语言后重试。")
                       : QStringLiteral("暂无歌词。可导入 LRC，或按歌名/歌手联网搜索。"));
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

void LyricsService::search(const QString &title, const QString &artist, qint64 durationMs)
{
    cancelPendingSearch();
    const SearchIdentity identity = cleanSearchIdentity(title, artist);
    if (m_trackPath.isEmpty() || identity.title.isEmpty()) {
        setStatus(QStringLiteral("请先选择歌曲并填写歌名。")); return;
    }
    const quint64 generation = m_searchGeneration;
    m_candidates.clear();
    m_candidateLyrics.clear();
    emit candidatesChanged();
    setStatus(QStringLiteral("正在按歌名搜索 LRCLIB…"));
    requestSearch(identity.title, identity.artist, durationMs, false, generation);
}

void LyricsService::requestSearch(const QString &title, const QString &artist,
                                  qint64 durationMs, bool broad, quint64 generation)
{
    QUrl url(QStringLiteral("https://lrclib.net/api/search"));
    QUrlQuery query;
    if (broad) query.addQueryItem("q", artist.isEmpty() ? title : title + QLatin1Char(' ') + artist);
    else {
        query.addQueryItem("track_name", title);
        if (!artist.isEmpty()) query.addQueryItem("artist_name", artist);
    }
    url.setQuery(query);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader,
                      QStringLiteral("ClairDesktop/0.3.9 (https://gitee.com/wenc23/clair)"));
    request.setTransferTimeout(15000);
    const QString requestedPath = m_trackPath;
    auto *reply = m_network.get(request);
    m_activeReply = reply;
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, requestedPath, title, artist, durationMs, broad, generation] {
        if (m_activeReply == reply) m_activeReply.clear();
        reply->deleteLater();
        if (requestedPath != m_trackPath || generation != m_searchGeneration) return;
        const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (httpStatus == 429) {
            const QString retry = QString::fromLatin1(reply->rawHeader("Retry-After"));
            setStatus(retry.isEmpty() ? QStringLiteral("LRCLIB 请求过于频繁，请稍后重试。")
                                      : QStringLiteral("LRCLIB 请求过于频繁，请 %1 秒后重试。").arg(retry));
            return;
        }
        if (reply->error() != QNetworkReply::NoError) {
            setStatus(QStringLiteral("歌词搜索失败：") + reply->errorString());
            return;
        }
        QJsonParseError error;
        const auto document = QJsonDocument::fromJson(reply->readAll(), &error);
        if (error.error != QJsonParseError::NoError || !document.isArray()) {
            setStatus(QStringLiteral("歌词服务返回了无法解析的数据。"));
            return;
        }
        QVector<QJsonObject> results;
        for (const auto &entry : document.array()) {
            const QJsonObject item = entry.toObject();
            const QString synced = item.value("syncedLyrics").toString();
            const QString plain = item.value("plainLyrics").toString();
            if (synced.isEmpty() && plain.isEmpty()) continue;
            results.append(item);
        }
        if (results.isEmpty() && !broad) {
            setStatus(QStringLiteral("精确搜索无结果，正在尝试宽松搜索…"));
            requestSearch(title, artist, durationMs, true, generation);
            return;
        }
        const SearchIdentity identity{title, artist};
        std::stable_sort(results.begin(), results.end(), [&](const QJsonObject &a, const QJsonObject &b) {
            return candidateScore(a, identity, durationMs) > candidateScore(b, identity, durationMs);
        });
        m_candidates.clear();
        m_candidateLyrics.clear();
        for (const QJsonObject &item : results) {
            const QString synced = item.value("syncedLyrics").toString();
            const QString plain = item.value("plainLyrics").toString();
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
