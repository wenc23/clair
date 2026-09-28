#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QVariantList>

#include "lyricsparser.h"

class LyricsService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList lines READ lines NOTIFY lyricsChanged)
    Q_PROPERTY(QString plainText READ plainText NOTIFY lyricsChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QVariantList candidates READ candidates NOTIFY candidatesChanged)
public:
    explicit LyricsService(QObject *parent = nullptr);
    QVariantList lines() const;
    QString plainText() const { return m_plainText; }
    QString status() const { return m_status; }
    QVariantList candidates() const { return m_candidates; }
    Q_INVOKABLE void loadForTrack(const QUrl &audio);
    Q_INVOKABLE void importLrc(const QUrl &file);
    Q_INVOKABLE void search(const QString &title, const QString &artist);
    Q_INVOKABLE void chooseCandidate(int index);
    Q_INVOKABLE QString lineAtPosition(qint64 positionMs) const;
    Q_INVOKABLE int lineIndexAtPosition(qint64 positionMs) const;
signals:
    void lyricsChanged();
    void statusChanged();
    void candidatesChanged();
private:
    void loadText(const QByteArray &bytes, const QString &origin);
    void setStatus(const QString &status);
    QString keyForCurrentTrack() const;

    QNetworkAccessManager m_network;
    QVector<LrcLine> m_lines;
    QString m_plainText;
    QString m_trackPath;
    QString m_status;
    QVariantList m_candidates;
    QList<QByteArray> m_candidateLyrics;
};
