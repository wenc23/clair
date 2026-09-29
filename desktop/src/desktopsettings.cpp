#include "desktopsettings.h"

#include <QDesktopServices>
#include <QFileInfo>

#include <algorithm>
#include <cmath>

DesktopSettings::DesktopSettings(QObject *parent)
    : QObject(parent), m_settings(QSettings::UserScope, "Clair", "ClairDesktop")
{
}

QString DesktopSettings::webUrl() const
{
    return m_settings.value("webUrl", "").toString();
}

void DesktopSettings::setWebUrl(const QString &url)
{
    if (webUrl() == url)
        return;
    m_settings.setValue("webUrl", url);
    emit webUrlChanged();
}

QUrl DesktopSettings::lastLibraryFolder() const
{
    const auto path = m_settings.value("lastLibraryFolder").toString();
    return path.isEmpty() ? QUrl() : QUrl::fromLocalFile(path);
}

QStringList DesktopSettings::importedFiles() const
{
    return m_settings.value("importedFiles").toStringList();
}

double DesktopSettings::lyricsOverlayOpacity() const
{
    return m_settings.value("lyricsOverlay/opacity", 0.38).toDouble();
}

void DesktopSettings::setLyricsOverlayOpacity(double opacity)
{
    if (!std::isfinite(opacity)) return;
    opacity = std::clamp(opacity, 0.0, 0.9);
    if (qFuzzyCompare(lyricsOverlayOpacity(), opacity)) return;
    m_settings.setValue("lyricsOverlay/opacity", opacity);
    emit lyricsOverlayChanged();
}

bool DesktopSettings::lyricsOverlayLocked() const
{
    return m_settings.value("lyricsOverlay/locked", false).toBool();
}

void DesktopSettings::setLyricsOverlayLocked(bool locked)
{
    if (lyricsOverlayLocked() == locked) return;
    m_settings.setValue("lyricsOverlay/locked", locked);
    emit lyricsOverlayChanged();
}

double DesktopSettings::volume() const
{
    return m_settings.value("playback/volume", 0.8).toDouble();
}

void DesktopSettings::setVolume(double volume)
{
    if (!std::isfinite(volume)) return;
    volume = std::clamp(volume, 0.0, 1.0);
    if (qFuzzyCompare(this->volume(), volume)) return;
    m_settings.setValue("playback/volume", volume);
    emit volumeChanged();
}

void DesktopSettings::setLastLibraryFolder(const QString &path)
{
    if (m_settings.value("lastLibraryFolder").toString() == path)
        return;
    m_settings.setValue("lastLibraryFolder", path);
    emit lastLibraryFolderChanged();
}

void DesktopSettings::setImportedFiles(const QStringList &paths)
{
    m_settings.setValue("importedFiles", paths);
}

void DesktopSettings::openWebVersion()
{
    const QString configured = webUrl().trimmed();
    // Older previews defaulted to port 8000 without starting a server.
    // Treat that obsolete default as the bundled Web mode during migration.
    if (configured.isEmpty() || configured == "http://127.0.0.1:8000" ||
        configured == "http://127.0.0.1:8000/") {
        if (!m_webServer.start()) {
            setErrorString(m_webServer.errorString());
            return;
        }
        if (!QDesktopServices::openUrl(m_webServer.url())) {
            setErrorString(QStringLiteral("无法打开默认浏览器。"));
            return;
        }
        setErrorString({});
        return;
    }
    const QUrl url(configured);
    if (!url.isValid() || (url.scheme() != "http" && url.scheme() != "https") || url.host().isEmpty()) {
        setErrorString(QStringLiteral("Web 地址必须是有效的 http:// 或 https:// 地址。"));
        return;
    }
    if (!QDesktopServices::openUrl(url)) {
        setErrorString(QStringLiteral("无法打开默认浏览器。"));
        return;
    }
    setErrorString({});
}

void DesktopSettings::setErrorString(const QString &error)
{
    if (m_errorString == error)
        return;
    m_errorString = error;
    emit errorStringChanged();
}
