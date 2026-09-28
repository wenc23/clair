#include "desktopsettings.h"
#include "librarymodel.h"

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
    DesktopSettings settings;
    QObject::connect(&library, &LibraryModel::rootDirectoryChanged, &settings,
                     [&library, &settings] { settings.setLastLibraryFolder(library.rootDirectory()); });
    const QStringList arguments = app.arguments();
    const int libraryArg = arguments.indexOf("--library");
    if (libraryArg >= 0 && libraryArg + 1 < arguments.size())
        library.openFolder(QUrl::fromLocalFile(arguments.at(libraryArg + 1)));

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("library", &library);
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
    return app.exec();
}
