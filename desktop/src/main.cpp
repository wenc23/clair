#include "desktopsettings.h"
#include "librarymodel.h"
#include "lyricsservice.h"
#include "fingerprintservice.h"
#include "transcriptionservice.h"
#include "thememanager.h"

#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QTimer>

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    QCoreApplication::setOrganizationName("Clair");
    QCoreApplication::setApplicationName("Clair Desktop");

    LibraryModel library;
    LyricsService lyrics;
    FingerprintService fingerprint;
    TranscriptionService transcription;
    ThemeManager theme;
    DesktopSettings settings;
    QObject::connect(&library, &LibraryModel::rootDirectoryChanged, &settings,
                     [&library, &settings] { settings.setLastLibraryFolder(library.rootDirectory()); });
    QObject::connect(&library, &LibraryModel::importedFilesChanged, &settings,
                     [&library, &settings] { settings.setImportedFiles(library.importedFiles()); });
    const QStringList arguments = app.arguments();
    const int libraryArg = arguments.indexOf("--library");
    if (libraryArg >= 0 && libraryArg + 1 < arguments.size())
        library.restoreSources(QUrl::fromLocalFile(arguments.at(libraryArg + 1)), settings.importedFiles());
    else
        library.restoreSources(settings.lastLibraryFolder(), settings.importedFiles());

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("library", &library);
    engine.rootContext()->setContextProperty("lyrics", &lyrics);
    engine.rootContext()->setContextProperty("fingerprint", &fingerprint);
    engine.rootContext()->setContextProperty("transcription", &transcription);
    engine.rootContext()->setContextProperty("themeManager", &theme);
    engine.rootContext()->setContextProperty("desktopSettings", &settings);
    engine.loadFromModule("Clair", "Main");
    if (engine.rootObjects().isEmpty())
        return 1;
    if (arguments.contains("--smoke"))
        QTimer::singleShot(250, &app, &QCoreApplication::quit);
    const int screenshotArg = arguments.indexOf("--screenshot");
    if (screenshotArg >= 0 && screenshotArg + 1 < arguments.size()) {
        const QString path = arguments.at(screenshotArg + 1);
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        QTimer::singleShot(800, &app, [window, path, &app] {
            app.exit(window && window->grabWindow().save(path) ? 0 : 2);
        });
    }
    const int themeScreenshotArg = arguments.indexOf("--screenshot-theme");
    if (themeScreenshotArg >= 0 && themeScreenshotArg + 1 < arguments.size()) {
        const QString path = arguments.at(themeScreenshotArg + 1);
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        if (auto *dialog = window ? window->findChild<QObject *>("themeEditor") : nullptr)
            QMetaObject::invokeMethod(dialog, "open");
        QTimer::singleShot(800, &app, [window, path, &app] {
            app.exit(window && window->grabWindow().save(path) ? 0 : 2);
        });
    }
    const int lyricsScreenshotArg = arguments.indexOf("--screenshot-lyrics");
    if (lyricsScreenshotArg >= 0 && lyricsScreenshotArg + 1 < arguments.size()) {
        const QString path = arguments.at(lyricsScreenshotArg + 1);
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        auto *overlay = window ? window->findChild<QQuickWindow *>("floatingLyrics") : nullptr;
        if (overlay) overlay->setVisible(true);
        QTimer::singleShot(800, &app, [overlay, path, &app] {
            app.exit(overlay && overlay->grabWindow().save(path) ? 0 : 2);
        });
    }
    const int controlsScreenshotArg = arguments.indexOf("--screenshot-lyrics-controls");
    if (controlsScreenshotArg >= 0 && controlsScreenshotArg + 1 < arguments.size()) {
        const QString path = arguments.at(controlsScreenshotArg + 1);
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        auto *overlay = window ? window->findChild<QQuickWindow *>("floatingLyrics") : nullptr;
        if (overlay) {
            overlay->setProperty("previewControls", true);
            overlay->setVisible(true);
        }
        QTimer::singleShot(800, &app, [overlay, path, &app] {
            app.exit(overlay && overlay->grabWindow().save(path) ? 0 : 2);
        });
    }
    return app.exec();
}
