#pragma once

#include <QAbstractListModel>
#include <QFutureWatcher>
#include <QUrl>
#include <QVector>

struct ClairTrack {
    QString title;
    QString artist;
    QString album;
    QString path;
    QString relativePath;
};

struct ClairScanResult {
    QVector<ClairTrack> tracks;
    QString error;
};

class LibraryModel final : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(QString rootDirectory READ rootDirectory NOTIFY rootDirectoryChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY errorStringChanged)
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    enum Role {
        TitleRole = Qt::UserRole + 1,
        ArtistRole,
        AlbumRole,
        SourceRole,
        RelativePathRole,
    };

    explicit LibraryModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    bool loading() const { return m_loading; }
    QString rootDirectory() const { return m_rootDirectory; }
    QString errorString() const { return m_errorString; }
    int count() const { return m_tracks.size(); }

    Q_INVOKABLE void openFolder(const QUrl &folder);
    Q_INVOKABLE QUrl sourceAt(int index) const;
    Q_INVOKABLE QString titleAt(int index) const;

signals:
    void scanStarted();
    void loadingChanged();
    void rootDirectoryChanged();
    void errorStringChanged();
    void countChanged();

private:
    static ClairScanResult scanFolder(const QString &rootPath);
    void setErrorString(const QString &error);

    QVector<ClairTrack> m_tracks;
    QFutureWatcher<ClairScanResult> m_watcher;
    QString m_rootDirectory;
    QString m_errorString;
    bool m_loading = false;
};
