#include "transcriptioncache.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLockFile>
#include <QRegularExpression>
#include <QSet>
#include <QSettings>

#include <algorithm>

namespace {
QString pathKey(const QString &path)
{
    if (path.isEmpty()) return {};
    QString result = QDir::cleanPath(QFileInfo(path).absoluteFilePath());
#ifdef Q_OS_WIN
    result = result.toCaseFolded();
#endif
    return result;
}

bool oldEnough(const QFileInfo &info, const QDateTime &cutoff)
{
    return info.lastModified().isValid() && info.lastModified().toUTC() < cutoff;
}
}

void pruneTranscriptionCache(const QString &cacheDir, const QString &currentLrc,
                             const QSettings &settings)
{
    const QFileInfo cacheInfo(cacheDir);
    if (!cacheInfo.isDir() || cacheInfo.isSymLink()) return;
    const QDir root(cacheDir);
    const QDateTime now = QDateTime::currentDateTimeUtc();
    static const QRegularExpression jobName(QStringLiteral("^job-[A-Za-z0-9]{6}$"));
    static const QRegularExpression lrcName(QStringLiteral("^[a-f0-9]{64}\\.lrc$"));
    static const QRegularExpression lyricKey(QStringLiteral("^lyrics/[a-f0-9]{64}$"));
    const QSet<QString> allowedJobFiles{QStringLiteral("audio.wav"),
                                         QStringLiteral("draft.lrc"),
                                         QStringLiteral(".running.lock")};

    // Failed/canceled jobs are removed by QTemporaryDir. For crash remnants,
    // require an exact job name, only our generated files, and old timestamps.
    // A live job is protected by QLockFile even if its conversion is very slow.
    for (const QFileInfo &dir : root.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot | QDir::Hidden)) {
        if (dir.isSymLink() || !jobName.match(dir.fileName()).hasMatch()) continue;
        QDir job(dir.absoluteFilePath());
        const QFileInfoList contents = job.entryInfoList(QDir::AllEntries | QDir::NoDotAndDotDot |
                                                         QDir::Hidden | QDir::System);
        bool recognized = true;
        for (const QFileInfo &item : contents) {
            if (!item.isFile() || item.isSymLink() || !allowedJobFiles.contains(item.fileName()) ||
                !oldEnough(item, now.addDays(-7))) {
                recognized = false;
                break;
            }
        }
        // Pre-lock versions may still be running; wait a month before touching them.
        const bool hasLock = QFileInfo::exists(job.filePath(QStringLiteral(".running.lock")));
        if (!recognized || !oldEnough(dir, now.addDays(hasLock ? -7 : -30))) continue;
        if (hasLock) {
            QLockFile lock(job.filePath(QStringLiteral(".running.lock")));
            lock.setStaleLockTime(0); // PID check, not an age-based live-job eviction.
            if (!lock.tryLock(0)) continue;
            lock.unlock();
        }
        // Remove only the files we inspected, never a newly appeared or
        // unrecognized file from another process.
        for (const QFileInfo &item : contents) {
            if (item.fileName() != QStringLiteral(".running.lock"))
                QFile::remove(item.absoluteFilePath());
        }
        root.rmdir(dir.fileName()); // Fails harmlessly if anything else remains.
    }

    QSet<QString> protectedPaths{pathKey(currentLrc)};
    for (const QString &key : settings.allKeys()) {
        if (!lyricKey.match(key).hasMatch()) continue;
        const QString path = settings.value(key).toString();
        if (!path.isEmpty()) protectedPaths.insert(pathKey(path));
    }

    QList<QFileInfo> entries;
    qint64 bytes = 0;
    for (const QFileInfo &file : root.entryInfoList(QDir::Files | QDir::NoSymLinks)) {
        if (!lrcName.match(file.fileName()).hasMatch()) continue;
        entries.append(file);
        bytes += file.size();
    }
    std::sort(entries.begin(), entries.end(), [](const QFileInfo &a, const QFileInfo &b) {
        return a.lastModified() < b.lastModified();
    });
    // Only unselected drafts older than a day are candidates. An active result
    // in another process may not yet be saved to QSettings; keep the grace day.
    constexpr qint64 maxBytes = 100LL * 1024 * 1024;
    constexpr qsizetype maxEntries = 256;
    qsizetype remaining = entries.size();
    for (const QFileInfo &file : entries) {
        if (bytes <= maxBytes && remaining <= maxEntries) break;
        if (!oldEnough(file, now.addDays(-1)) ||
            protectedPaths.contains(pathKey(file.absoluteFilePath()))) continue;
        if (QFile::remove(file.absoluteFilePath())) {
            bytes -= file.size();
            --remaining;
        }
    }
}
