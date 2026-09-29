#pragma once

#include <QString>

class QSettings;

// Only removes old, reproducible files inside Clair's transcription cache.
// Never touches audio files, imported lyrics, or a lyric draft selected in settings.
void pruneTranscriptionCache(const QString &cacheDir, const QString &currentLrc,
                             const QSettings &settings);
