#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QVariantList>

#include "lyricsparser.h"

class QNetworkReply;

class LyricsService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList lines READ lines NOTIFY lyricsChanged)
    Q_PROPERTY(QString plainText READ plainText NOTIFY lyricsChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QVariantList candidates READ candidates NOTIFY candidatesChanged)
public:
    explicit LyricsService(QObject *parent = nullptr, const QString &timingStorePath = {});
    QVariantList lines() const;
    QString plainText() const { return m_plainText; }
    QString status() const { return m_status; }
    QVariantList candidates() const { return m_candidates; }
    Q_INVOKABLE void loadForTrack(const QUrl &audio);
    Q_INVOKABLE void importLrc(const QUrl &file);
    Q_INVOKABLE void search(const QString &title, const QString &artist, qint64 durationMs = 0);
    Q_INVOKABLE void chooseCandidate(int index);
    Q_INVOKABLE bool adjustLineTime(int sourceIndex, qint64 timeMs);
    Q_INVOKABLE bool resetTimingOffset();
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
    void applyLineTimes();
    bool saveTimingOffset();
    QString timingStorePath() const;
    void requestSearch(const QString &title, const QString &artist, qint64 durationMs,
                       bool broad, quint64 generation);
    void cancelPendingSearch();

    QNetworkAccessManager m_network;
    QPointer<QNetworkReply> m_activeReply;
    QVector<LrcLine> m_lines;
    QVector<LrcLine> m_originalLines;
    QVector<int> m_sourceIndices;
    qint64 m_offsetMs = 0;
    QString m_timingKey;
    QString m_timingStorePath;
    QString m_plainText;
    QString m_trackPath;
    QString m_status;
    QVariantList m_candidates;
    QList<QByteArray> m_candidateLyrics;
    quint64 m_searchGeneration = 0;
};
