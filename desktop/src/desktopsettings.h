#pragma once

#include <QObject>
#include <QSettings>
#include <QUrl>

#include "webserver.h"

class DesktopSettings final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString webUrl READ webUrl WRITE setWebUrl NOTIFY webUrlChanged)
    Q_PROPERTY(QUrl lastLibraryFolder READ lastLibraryFolder NOTIFY lastLibraryFolderChanged)
    Q_PROPERTY(double lyricsOverlayOpacity READ lyricsOverlayOpacity WRITE setLyricsOverlayOpacity NOTIFY lyricsOverlayChanged)
    Q_PROPERTY(bool lyricsOverlayLocked READ lyricsOverlayLocked WRITE setLyricsOverlayLocked NOTIFY lyricsOverlayChanged)
    Q_PROPERTY(double volume READ volume WRITE setVolume NOTIFY volumeChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY errorStringChanged)

public:
    explicit DesktopSettings(QObject *parent = nullptr);

    QString webUrl() const;
    void setWebUrl(const QString &url);
    QUrl lastLibraryFolder() const;
    QStringList importedFiles() const;
    double lyricsOverlayOpacity() const;
    void setLyricsOverlayOpacity(double opacity);
    bool lyricsOverlayLocked() const;
    void setLyricsOverlayLocked(bool locked);
    double volume() const;
    void setVolume(double volume);
    QString errorString() const { return m_errorString; }

    Q_INVOKABLE void setLastLibraryFolder(const QString &path);
    void setImportedFiles(const QStringList &paths);
    Q_INVOKABLE void openWebVersion();

signals:
    void webUrlChanged();
    void lastLibraryFolderChanged();
    void errorStringChanged();
    void lyricsOverlayChanged();
    void volumeChanged();

private:
    void setErrorString(const QString &error);

    QSettings m_settings;
    WebServer m_webServer;
    QString m_errorString;
};
