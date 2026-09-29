#pragma once

#include <QObject>
#include <QUrl>
#include <QVariantMap>

class ThemeManager final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString activeThemeId READ activeThemeId NOTIFY themeChanged)
    Q_PROPERTY(QString activeThemeName READ activeThemeName NOTIFY themeChanged)
    Q_PROPERTY(QStringList themeIds READ themeIds NOTIFY themesChanged)
    Q_PROPERTY(QUrl backgroundUrl READ backgroundUrl NOTIFY themeChanged)
    Q_PROPERTY(QUrl coverUrl READ coverUrl NOTIFY themeChanged)
    Q_PROPERTY(QUrl sidebarUrl READ sidebarUrl NOTIFY themeChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY errorChanged)

public:
    explicit ThemeManager(const QString &storageRoot = {}, QObject *parent = nullptr);

    QString activeThemeId() const { return m_activeId; }
    QString activeThemeName() const;
    QStringList themeIds() const;
    QUrl backgroundUrl() const { return outputUrl("background"); }
    QUrl coverUrl() const { return outputUrl("cover"); }
    QUrl sidebarUrl() const { return outputUrl("sidebar"); }
    QString errorString() const { return m_error; }

    Q_INVOKABLE QVariantMap slotSpec(const QString &slot) const;
    Q_INVOKABLE QUrl originalForSlot(const QString &slot) const;
    Q_INVOKABLE QString themeName(const QString &id) const;
    Q_INVOKABLE bool createTheme(const QString &name, const QVariantList &files);
    // Import a locally generated v1 manifest and originals; rendered files are regenerated.
    Q_INVOKABLE bool importThemePack(const QUrl &manifestFile);
    // Rect is normalized against the orientation-corrected original, not the thumbnail.
    Q_INVOKABLE bool cropSlot(const QString &slot, double x, double y, double width, double height);
    Q_INVOKABLE bool activateTheme(const QString &id);
    Q_INVOKABLE bool removeTheme(const QString &id);

signals:
    void themeChanged();
    void themesChanged();
    void errorChanged();

private:
    QUrl outputUrl(const QString &slot) const;
    QString themeDir(const QString &id) const;
    QVariantMap readManifest(const QString &id) const;
    bool writeManifest(const QString &dir, const QVariantMap &manifest);
    bool renderSlot(const QString &dir, const QString &originalName, const QString &slot,
                    double x, double y, double width, double height);
    bool createStage(const QString &id, QString &stage);
    void setError(const QString &message);
    bool validId(const QString &id) const;

    QString m_root;
    bool m_autoRoot = false;
    QString m_activeId;
    QString m_error;
    quint64 m_revision = 0;
};
