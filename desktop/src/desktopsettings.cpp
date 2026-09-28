#include "desktopsettings.h"

#include <QDesktopServices>
#include <QFileInfo>

DesktopSettings::DesktopSettings(QObject *parent)
    : QObject(parent), m_settings(QSettings::UserScope, "Clair", "ClairDesktop")
{
}

QString DesktopSettings::webUrl() const
{
    return m_settings.value("webUrl", "http://127.0.0.1:8000").toString();
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

void DesktopSettings::setLastLibraryFolder(const QString &path)
{
    if (m_settings.value("lastLibraryFolder").toString() == path)
        return;
    m_settings.setValue("lastLibraryFolder", path);
    emit lastLibraryFolderChanged();
}

void DesktopSettings::openWebVersion()
{
    const QUrl url(webUrl());
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
