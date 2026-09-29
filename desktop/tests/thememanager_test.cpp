#include "../src/thememanager.h"

#include <QDir>
#include <QFile>
#include <QImage>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QtTest>

class ThemeManagerTest : public QObject {
    Q_OBJECT
private slots:
    void importAndPersist();
    void importsJpegAndBmpOriginals();
    void cropRejectsInvalidGeometry();
    void importPackRebuildsOutputsAndRejectsTraversal();
    void importsExternalSkillPackWhenRequested();
    void importsOptionalRealImage();
};

static QString makeImage(const QString &directory, const QString &name, const QColor &color)
{
    const QString path = QDir(directory).filePath(name);
    QImage image(160, 90, QImage::Format_RGB32);
    image.fill(color);
    if (!image.save(path)) return {};
    return path;
}

void ThemeManagerTest::importAndPersist()
{
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    const QString path = makeImage(temp.path(), "input.png", Qt::red);
    QVERIFY(!path.isEmpty());
    const QByteArray bytes = [&] { QFile f(path); f.open(QIODevice::ReadOnly); return f.readAll(); }();
    ThemeManager manager(QDir(temp.path()).filePath("themes"));
    QVERIFY(manager.createTheme("  Test  ", {QUrl::fromLocalFile(path)}));
    QCOMPARE(manager.activeThemeName(), QString("Test"));
    QCOMPARE(manager.themeIds().size(), 1);
    const QString id = manager.activeThemeId();
    QVERIFY(!id.isEmpty());
    const QString dir = QDir(temp.path()).filePath("themes/" + id);
    QFile copied(QDir(dir).filePath("original-0.png"));
    QVERIFY(copied.open(QIODevice::ReadOnly));
    QCOMPARE(copied.readAll(), bytes);
    copied.close();
    QCOMPARE(QImage(manager.backgroundUrl().toLocalFile()).size(), QSize(1920, 1080));
    QCOMPARE(QImage(manager.coverUrl().toLocalFile()).size(), QSize(600, 600));
    QCOMPARE(QImage(manager.sidebarUrl().toLocalFile()).size(), QSize(480, 1080));
    ThemeManager reopened(QDir(temp.path()).filePath("themes"));
    QCOMPARE(reopened.activeThemeId(), id);
    QVERIFY(reopened.activateTheme(""));
    QVERIFY(reopened.backgroundUrl().isEmpty());
    QVERIFY(reopened.activateTheme(id));
    QVERIFY(reopened.removeTheme(id));
    QVERIFY(reopened.themeIds().isEmpty());
    QVERIFY(QFile::exists(path));
}

void ThemeManagerTest::importsJpegAndBmpOriginals()
{
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    const QString jpeg = makeImage(temp.path(), "cover.jpg", Qt::yellow);
    const QString bmp = makeImage(temp.path(), "sidebar.bmp", Qt::cyan);
    QVERIFY(!jpeg.isEmpty());
    QVERIFY(!bmp.isEmpty());
    ThemeManager manager(QDir(temp.path()).filePath("themes"));
    // FileDialog URLs are explicitly serialized by QML before crossing the
    // QVariantList boundary; exercise the same string representation here.
    QVERIFY2(manager.createTheme("Mixed originals", {QUrl::fromLocalFile(jpeg).toString(),
                                                    QUrl::fromLocalFile(bmp).toString()}),
             qPrintable(manager.errorString()));
    const QDir saved(QDir(temp.path()).filePath("themes/" + manager.activeThemeId()));
    QVERIFY(QFile::exists(saved.filePath("original-0.jpg")));
    QVERIFY(QFile::exists(saved.filePath("original-1.bmp")));
    QCOMPARE(QImage(manager.backgroundUrl().toLocalFile()).size(), QSize(1920, 1080));
    QCOMPARE(QImage(manager.coverUrl().toLocalFile()).size(), QSize(600, 600));
    QCOMPARE(QImage(manager.sidebarUrl().toLocalFile()).size(), QSize(480, 1080));

    QVERIFY(!manager.createTheme("Missing", {QStringLiteral("https://example.com/test.jpg")}));
    QVERIFY(manager.errorString().contains(QStringLiteral("第 1 张图片")));
    QVERIFY(manager.errorString().contains(QStringLiteral("本地路径")));
}

void ThemeManagerTest::cropRejectsInvalidGeometry()
{
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    const QString path = makeImage(temp.path(), "input.png", Qt::green);
    ThemeManager manager(QDir(temp.path()).filePath("themes"));
    QVERIFY(manager.createTheme("Crop", {QUrl::fromLocalFile(path)}));
    QVERIFY(!manager.cropSlot("cover", -0.1, 0, 0.5, 0.5));
    QVERIFY(!manager.cropSlot("cover", 0, 0, 0, 1));
    QVERIFY(!manager.cropSlot("../outside", 0, 0, 1, 1));
    const QUrl oldUrl = manager.coverUrl();
    QVERIFY(manager.cropSlot("cover", 0.25, 0, 0.5, 1));
    QVERIFY(manager.coverUrl() != oldUrl);
    QCOMPARE(QImage(manager.coverUrl().toLocalFile()).size(), QSize(600, 600));
}

void ThemeManagerTest::importPackRebuildsOutputsAndRejectsTraversal()
{
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    const QString source = makeImage(temp.path(), "input.png", Qt::blue);
    ThemeManager first(QDir(temp.path()).filePath("first"));
    QVERIFY(first.createTheme("Source", {QUrl::fromLocalFile(source)}));
    const QString packDir = QDir(temp.path()).filePath("first/" + first.activeThemeId());
    const QString manifestPath = QDir(packDir).filePath("manifest.json");
    // Imported output images are intentionally ignored; only originals + crop data are trusted.
    QVERIFY(QFile::remove(QDir(packDir).filePath("cover.png")));
    ThemeManager second(QDir(temp.path()).filePath("second"));
    QVERIFY(second.importThemePack(QUrl::fromLocalFile(manifestPath)));
    QCOMPARE(QImage(second.coverUrl().toLocalFile()).size(), QSize(600, 600));
    QVERIFY(second.activeThemeId() != first.activeThemeId());

    QFile manifest(manifestPath);
    QVERIFY(manifest.open(QIODevice::ReadOnly));
    QJsonObject data = QJsonDocument::fromJson(manifest.readAll()).object();
    manifest.close();
    QJsonObject slotEntries = data.value("slots").toObject();
    QJsonObject cover = slotEntries.value("cover").toObject();
    cover.insert("original", "../outside.png");
    slotEntries.insert("cover", cover);
    data.insert("slots", slotEntries);
    QFile invalid(QDir(temp.path()).filePath("manifest.json"));
    QVERIFY(invalid.open(QIODevice::WriteOnly));
    invalid.write(QJsonDocument(data).toJson());
    invalid.close();
    QVERIFY(!second.importThemePack(QUrl::fromLocalFile(invalid.fileName())));
    QCOMPARE(second.themeIds().size(), 1);
}

void ThemeManagerTest::importsExternalSkillPackWhenRequested()
{
    const QString manifest = qEnvironmentVariable("CLAIR_TEST_THEME_PACK");
    if (manifest.isEmpty()) QSKIP("Set CLAIR_TEST_THEME_PACK to a skill-generated manifest.json.");
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    ThemeManager manager(QDir(temporary.path()).filePath("themes"));
    QVERIFY2(manager.importThemePack(QUrl::fromLocalFile(manifest)), qPrintable(manager.errorString()));
    QCOMPARE(QImage(manager.backgroundUrl().toLocalFile()).size(), QSize(1920, 1080));
    QCOMPARE(QImage(manager.coverUrl().toLocalFile()).size(), QSize(600, 600));
    QCOMPARE(QImage(manager.sidebarUrl().toLocalFile()).size(), QSize(480, 1080));
}

void ThemeManagerTest::importsOptionalRealImage()
{
    const QString source = qEnvironmentVariable("CLAIR_TEST_THEME_IMAGE");
    if (source.isEmpty()) QSKIP("Set CLAIR_TEST_THEME_IMAGE to verify a real image read-only.");
    QFile original(source);
    QVERIFY(original.open(QIODevice::ReadOnly));
    const QByteArray before = original.readAll();
    original.close();
    QTemporaryDir temp;
    QVERIFY(temp.isValid());
    ThemeManager manager(QDir(temp.path()).filePath("themes"));
    QVERIFY2(manager.createTheme("Real JPEG", {QUrl::fromLocalFile(source).toString()}),
             qPrintable(manager.errorString()));
    QCOMPARE(QImage(manager.backgroundUrl().toLocalFile()).size(), QSize(1920, 1080));
    QVERIFY(original.open(QIODevice::ReadOnly));
    QCOMPARE(original.readAll(), before);
}

QTEST_GUILESS_MAIN(ThemeManagerTest)
#include "thememanager_test.moc"
