#pragma once

#include <QObject>
#include <QJsonObject>
#include <QJsonArray>
#include <QStringList>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

// Cross-edition, local-folder state. Only writes its own three files under
// .Clair; it never rewrites the Web library index or the audio files.
class SharedState final : public QObject {
    Q_OBJECT
    Q_PROPERTY(int revision READ revision NOTIFY changed)
    Q_PROPERTY(QStringList playlistNames READ playlistNames NOTIFY changed)
    Q_PROPERTY(QVariantMap resume READ resume NOTIFY changed)
    Q_PROPERTY(QString errorString READ errorString NOTIFY changed)
public:
    explicit SharedState(QObject *parent = nullptr);
    int revision() const { return m_revision; }
    QStringList playlistNames() const;
    QVariantMap resume() const { return m_resume.toVariantMap(); }
    QString errorString() const { return m_error; }

    Q_INVOKABLE void setRoot(const QString &path);
    Q_INVOKABLE bool favorite(const QString &key) const;
    Q_INVOKABLE void setFavorite(const QString &key, bool value);
    Q_INVOKABLE void createPlaylist(const QString &name);
    Q_INVOKABLE void addToPlaylist(const QString &name, const QString &key);
    Q_INVOKABLE void removeFromPlaylist(const QString &name, const QString &key);
    Q_INVOKABLE QStringList playlistTracks(const QString &name) const;
    // Selecting a track changes the shared "continue" target; position updates
    // only change that track's bookmark, so two independent players do not
    // repeatedly steal the target from one another while both are playing.
    Q_INVOKABLE void selectResume(const QString &key);
    Q_INVOKABLE void saveResume(const QString &key, qint64 positionMs);
    Q_INVOKABLE bool migrateKey(const QString &oldKey, const QString &newKey);
    Q_INVOKABLE void refresh();

signals:
    void changed();

private:
    bool readFile(const QString &name, QJsonObject &result) const;
    bool writeFile(const QString &name, const QJsonObject &value);
    QString filePath(const QString &name) const;
    void setError(const QString &error);
    void seedFavoritesFromWebIndex();

    QString m_root;
    QJsonObject m_favorites;
    QJsonObject m_resume;
    QJsonArray m_playlists;
    QString m_error;
    int m_revision = 0;
    QTimer m_poll;
};
