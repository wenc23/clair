#pragma once

#include <QString>
#include <QVector>

struct LrcLine {
    qint64 timeMs = 0;
    QString text;
};

// Parse synced LRC text. The timestamp offset is applied to every line,
// including lines appearing before the [offset:] tag in the input.
QVector<LrcLine> parseLrc(const QString &contents);

// Return the active line's index, or -1 before the first timestamp.
// Equal timestamps select the last line at that timestamp.
int lineAt(const QVector<LrcLine> &lines, qint64 positionMs);

// Conservative guard for Whisper drafts, not a validator for user-provided lyrics.
// Empty return means no obvious repetition/music-only hallucination was found.
QString transcriptionQualityIssue(const QVector<LrcLine> &lines);
