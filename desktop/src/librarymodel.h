#pragma once

#include <QAbstractListModel>
#include <QFutureWatcher>
#include <QUrl>
#include <QVariantList>
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
    Q_PROPERTY(QStringList importedFiles READ importedFiles NOTIFY importedFilesChanged)
    Q_PROPERTY(QString sourceSummary READ sourceSummary NOTIFY sourcesChanged)
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
    QStringList importedFiles() const { return m_importedFiles; }
    QString sourceSummary() const;
    QString errorString() const { return m_errorString; }
    int count() const { return m_tracks.size(); }

    Q_INVOKABLE void openFolder(const QUrl &folder);
    Q_INVOKABLE void addFiles(const QVariantList &files);
    Q_INVOKABLE void removeImportedFile(const QString &path);
    Q_INVOKABLE void clearFolder();
    Q_INVOKABLE void refresh();
    void restoreSources(const QUrl &folder, const QStringList &files);
    Q_INVOKABLE QUrl sourceAt(int index) const;
    Q_INVOKABLE bool openTrackFolder(int index);
    Q_INVOKABLE QString titleAt(int index) const;
    Q_INVOKABLE QString artistAt(int index) const;
    Q_INVOKABLE QString albumAt(int index) const;
    Q_INVOKABLE QString syncKeyAt(int index) const;
    Q_INVOKABLE QString groupAt(int index, const QString &kind) const;
    Q_INVOKABLE bool editTrack(int index, const QString &title, const QString &artist);
    Q_INVOKABLE bool renameTrackFile(int index, const QString &baseName);

signals:
    void scanStarted();
    void loadingChanged();
    void rootDirectoryChanged();
    void importedFilesChanged();
    void sourcesChanged();
    void errorStringChanged();
    void countChanged();

private:
    static ClairScanResult scanSources(const QString &rootPath, const QStringList &extraFiles);
    void reload();
    void setErrorString(const QString &error);
    void saveOverride(const ClairTrack &track);
    void applyOverrides();

    QVector<ClairTrack> m_tracks;
    QFutureWatcher<ClairScanResult> m_watcher;
    QString m_rootDirectory;
    QStringList m_importedFiles;
    QString m_errorString;
    bool m_loading = false;
};
