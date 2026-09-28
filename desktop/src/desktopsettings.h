#pragma once

#include <QObject>
#include <QSettings>
#include <QUrl>

class DesktopSettings final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString webUrl READ webUrl WRITE setWebUrl NOTIFY webUrlChanged)
    Q_PROPERTY(QUrl lastLibraryFolder READ lastLibraryFolder NOTIFY lastLibraryFolderChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY errorStringChanged)

public:
    explicit DesktopSettings(QObject *parent = nullptr);

    QString webUrl() const;
    void setWebUrl(const QString &url);
    QUrl lastLibraryFolder() const;
    QString errorString() const { return m_errorString; }

    Q_INVOKABLE void setLastLibraryFolder(const QString &path);
    Q_INVOKABLE void openWebVersion();

signals:
    void webUrlChanged();
    void lastLibraryFolderChanged();
    void errorStringChanged();

private:
    void setErrorString(const QString &error);

    QSettings m_settings;
    QString m_errorString;
};
