#include "lyricsparser.h"

#include <QRegularExpression>

#include <algorithm>
#include <limits>

QVector<LrcLine> parseLrc(const QString &contents)
{
    const QRegularExpression timestamp(
        QStringLiteral(R"(\[(\d+):(\d{2})(?:\.(\d{2,3}))?\])"));
    const QRegularExpression offsetTag(
        QStringLiteral(R"(^\[offset:([+-]?\d+)\]\s*$)"),
        QRegularExpression::CaseInsensitiveOption);
    const QRegularExpression newline(QStringLiteral(R"(\r\n|\r|\n)"));

    QVector<LrcLine> lines;
    qint64 offsetMs = 0;
    QString input = contents;
    if (input.startsWith(QChar(0xfeff)))
        input.remove(0, 1);

    for (const QString &raw : input.split(newline)) {
        const QString row = raw.trimmed();
        const auto offsetMatch = offsetTag.match(row);
        if (offsetMatch.hasMatch()) {
            bool valid = false;
            const qint64 parsed = offsetMatch.captured(1).toLongLong(&valid);
            if (valid)
                offsetMs = parsed;
            continue;
        }

        QVector<qint64> times;
        qsizetype position = 0;
        while (position < row.size()) {
            const auto match = timestamp.match(row, position,
                                               QRegularExpression::NormalMatch,
                                               QRegularExpression::AnchorAtOffsetMatchOption);
            if (!match.hasMatch())
                break;
            bool minutesValid = false;
            const qint64 minutes = match.captured(1).toLongLong(&minutesValid);
            const qint64 seconds = match.captured(2).toLongLong();
            const QString fractional = match.captured(3);
            const qint64 fractionMs = fractional.isEmpty() ? 0
                : fractional.toLongLong() * (fractional.size() == 2 ? 10 : 1);
            if (minutesValid && seconds < 60 &&
                minutes <= (std::numeric_limits<qint64>::max() - 59999) / 60000)
                times.append(minutes * 60000 + seconds * 1000 + fractionMs);
            position = match.capturedEnd();
        }
        if (times.isEmpty())
            continue; // Metadata and unsynchronised text are not lyric lines.
        const QString lyric = row.mid(position).trimmed();
        for (const qint64 time : times)
            lines.append({time, lyric});
    }

    for (auto &line : lines) {
        // Saturate rather than overflow for a malformed, extreme offset.
        if (offsetMs > 0 && line.timeMs > std::numeric_limits<qint64>::max() - offsetMs)
            line.timeMs = std::numeric_limits<qint64>::max();
        else if (offsetMs < 0 && line.timeMs < std::numeric_limits<qint64>::min() - offsetMs)
            line.timeMs = std::numeric_limits<qint64>::min();
        else
            line.timeMs += offsetMs;
    }
    std::stable_sort(lines.begin(), lines.end(), [](const LrcLine &a, const LrcLine &b) {
        return a.timeMs < b.timeMs;
    });
    return lines;
}

int lineAt(const QVector<LrcLine> &lines, qint64 positionMs)
{
    const auto next = std::upper_bound(lines.cbegin(), lines.cend(), positionMs,
                                       [](qint64 position, const LrcLine &line) {
                                           return position < line.timeMs;
                                       });
    return next == lines.cbegin() ? -1 : static_cast<int>(next - lines.cbegin() - 1);
}
