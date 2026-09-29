#include "thememanager.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QImageReader>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QStandardPaths>
#include <QUuid>
#include <cmath>

namespace {
struct Slot { const char *key; int width; int height; };
constexpr Slot kSlots[] = {{"background", 1920, 1080}, {"cover", 600, 600},
                          {"sidebar", 480, 1080}};
const Slot *findSlot(const QString &name)
{
    for (const Slot &slot : kSlots)
        if (name == QLatin1String(slot.key)) return &slot;
    return nullptr;
}
QString safeName(const QString &name)
{
    const QString trimmed = name.trimmed();
    return trimmed.isEmpty() ? QStringLiteral("未命名主题") : trimmed.left(80);
}
}

ThemeManager::ThemeManager(const QString &storageRoot, QObject *parent)
    : QObject(parent),
      m_root(storageRoot.isEmpty()
                 ? QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/themes"
                 : storageRoot),
      m_autoRoot(storageRoot.isEmpty())
{
    if (m_autoRoot) {
        // If a previous import had to fall back to local data, keep using it
        // on the next launch instead of hiding the user's newly saved theme.
        const QString localRoot = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
                                  + QStringLiteral("/themes");
        if (localRoot != m_root) {
            QFile localCurrent(QDir(localRoot).filePath("current.txt"));
            if (localCurrent.open(QIODevice::ReadOnly)) {
                const QString localId = QString::fromUtf8(localCurrent.readAll()).trimmed();
                const QString previousRoot = m_root;
                m_root = localRoot;
                if (!validId(localId) || readManifest(localId).isEmpty()) m_root = previousRoot;
            }
        }
    }
    QDir().mkpath(m_root);
    QFile current(QDir(m_root).filePath("current.txt"));
    if (current.open(QIODevice::ReadOnly)) {
        const QString id = QString::fromUtf8(current.readAll()).trimmed();
        if (validId(id) && !readManifest(id).isEmpty()) m_activeId = id;
    }
}

bool ThemeManager::createStage(const QString &id, QString &stage)
{
    stage = QDir(m_root).filePath(QStringLiteral(".staging-") + id);
    if (QDir().mkpath(stage)) return true;
    if (m_autoRoot) {
        const QString localRoot = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)
                                  + QStringLiteral("/themes");
        if (localRoot != m_root) {
            const QString localStage = QDir(localRoot).filePath(QStringLiteral(".staging-") + id);
            if (QDir().mkpath(localStage)) {
                m_root = localRoot;
                m_activeId.clear();
                stage = localStage;
                emit themeChanged();
                emit themesChanged();
                return true;
            }
        }
    }
    setError(QStringLiteral("无法创建主题目录：") + QDir::toNativeSeparators(m_root)
             + QStringLiteral("。请检查该位置的写入权限或可用空间。"));
    return false;
}

bool ThemeManager::validId(const QString &id) const
{
    const QUuid parsed(id);
    return !parsed.isNull() && parsed.toString(QUuid::WithoutBraces) == id;
}

QString ThemeManager::themeDir(const QString &id) const
{
    return QDir(m_root).filePath(id);
}

QVariantMap ThemeManager::readManifest(const QString &id) const
{
    if (!validId(id)) return {};
    QFile file(QDir(themeDir(id)).filePath("manifest.json"));
    if (!file.open(QIODevice::ReadOnly)) return {};
    QJsonParseError error;
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject()) return {};
    const QVariantMap result = doc.object().toVariantMap();
    if (result.value("version").toInt() != 1 || result.value("id").toString() != id) return {};
    return result;
}

bool ThemeManager::writeManifest(const QString &dir, const QVariantMap &manifest)
{
    QSaveFile file(QDir(dir).filePath("manifest.json"));
    if (!file.open(QIODevice::WriteOnly)) return false;
    const QByteArray content = QJsonDocument::fromVariant(manifest).toJson(QJsonDocument::Indented);
    return file.write(content) == content.size() && file.commit();
}

QStringList ThemeManager::themeIds() const
{
    QStringList ids;
    const QDir root(m_root);
    for (const QString &id : root.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name))
        if (!readManifest(id).isEmpty()) ids.append(id);
    return ids;
}

QString ThemeManager::themeName(const QString &id) const
{
    return readManifest(id).value("name").toString();
}

QString ThemeManager::activeThemeName() const { return themeName(m_activeId); }

QVariantMap ThemeManager::slotSpec(const QString &slot) const
{
    const Slot *s = findSlot(slot);
    if (!s) return {};
    return {{"name", slot}, {"width", s->width}, {"height", s->height},
            {"aspect", double(s->width) / s->height}};
}

QUrl ThemeManager::originalForSlot(const QString &slot) const
{
    if (!findSlot(slot)) return {};
    const QVariantMap data = readManifest(m_activeId).value("slots").toMap().value(slot).toMap();
    const QString original = data.value("original").toString();
    if (original.isEmpty() || original.contains('/') || original.contains('\\')) return {};
    const QString path = QDir(themeDir(m_activeId)).filePath(original);
    return QFileInfo::exists(path) ? QUrl::fromLocalFile(path) : QUrl();
}

QUrl ThemeManager::outputUrl(const QString &slot) const
{
    if (!findSlot(slot)) return {};
    const QVariantMap data = readManifest(m_activeId).value("slots").toMap().value(slot).toMap();
    const QString output = data.value("output").toString();
    if (output != slot + ".png") return {};
    const QString path = QDir(themeDir(m_activeId)).filePath(output);
    if (!QFileInfo::exists(path)) return {};
    QUrl url = QUrl::fromLocalFile(path);
    url.setQuery(QStringLiteral("v=%1").arg(m_revision));
    return url;
}

void ThemeManager::setError(const QString &message)
{
    if (m_error == message) return;
    m_error = message;
    emit errorChanged();
}

bool ThemeManager::renderSlot(const QString &dir, const QString &originalName,
                              const QString &slot, double x, double y, double width, double height)
{
    const Slot *spec = findSlot(slot);
    if (!spec || !std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) ||
        !std::isfinite(height) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
        x + width > 1.000001 || y + height > 1.000001) {
        setError(QStringLiteral("裁剪区域无效。"));
        return false;
    }
    const QString input = QDir(dir).filePath(originalName);
    QImageReader reader(input);
    reader.setAutoTransform(true);
    const QSize sourceSize = reader.size();
    if (!sourceSize.isValid() || qint64(sourceSize.width()) * sourceSize.height() > 50000000) {
        setError(QStringLiteral("图片无效或超过 5000 万像素上限。"));
        return false;
    }
    const QImage source = reader.read();
    if (source.isNull()) {
        setError(QStringLiteral("无法读取图片：") + reader.errorString());
        return false;
    }
    QRect area(qRound(x * source.width()), qRound(y * source.height()),
               qRound(width * source.width()), qRound(height * source.height()));
    area = area.intersected(source.rect());
    if (area.width() < 2 || area.height() < 2) {
        setError(QStringLiteral("裁剪区域过小。"));
        return false;
    }
    // Keep exact slot dimensions without stretching the original image.
    const double targetAspect = double(spec->width) / spec->height;
    const double areaAspect = double(area.width()) / area.height();
    if (areaAspect > targetAspect) {
        const int newWidth = qMax(2, qRound(area.height() * targetAspect));
        area.setX(area.x() + (area.width() - newWidth) / 2);
        area.setWidth(newWidth);
    } else {
        const int newHeight = qMax(2, qRound(area.width() / targetAspect));
        area.setY(area.y() + (area.height() - newHeight) / 2);
        area.setHeight(newHeight);
    }
    const QImage result = source.copy(area).scaled(spec->width, spec->height,
                                                    Qt::IgnoreAspectRatio,
                                                    Qt::SmoothTransformation);
    QSaveFile output(QDir(dir).filePath(slot + ".png"));
    if (!output.open(QIODevice::WriteOnly) || !result.save(&output, "PNG") || !output.commit()) {
        setError(QStringLiteral("无法保存裁剪图片。"));
        return false;
    }
    return true;
}

bool ThemeManager::createTheme(const QString &name, const QVariantList &files)
{
    if (files.isEmpty() || files.size() > 3) {
        setError(QStringLiteral("请选择 1 至 3 张图片。"));
        return false;
    }
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    QString stage;
    if (!createStage(id, stage)) return false;
    QStringList originalNames;
    for (int i = 0; i < files.size(); ++i) {
        const QUrl url = files.at(i).toUrl();
        const QFileInfo info(url.toLocalFile());
        const QString position = QStringLiteral("第 %1 张图片").arg(i + 1);
        if (!url.isLocalFile() || info.filePath().isEmpty()) {
            setError(position + QStringLiteral("的本地路径没有传到导入程序。请重新选择本机图片；如仍出现请反馈文件路径。"));
            QDir(stage).removeRecursively();
            return false;
        }
        if (!info.isFile()) {
            setError(position + QStringLiteral("不存在或无法访问：") + info.filePath());
            QDir(stage).removeRecursively();
            return false;
        }
        if (info.size() > 100 * 1024 * 1024) {
            setError(position + QStringLiteral("超过 100 MB 上限：") + info.fileName());
            QDir(stage).removeRecursively();
            return false;
        }
        if (QImageReader::imageFormat(info.filePath()).isEmpty()) {
            setError(position + QStringLiteral("无法解码：") + info.fileName()
                     + QStringLiteral("。当前支持 PNG、JPG/JPEG、BMP；WebP/HEIC 或损坏的图片暂不能导入。"));
            QDir(stage).removeRecursively();
            return false;
        }
        const QString stored = QString("original-%1.%2").arg(i).arg(info.suffix().toLower());
        if (!QFile::copy(info.filePath(), QDir(stage).filePath(stored))) {
            setError(QStringLiteral("无法复制图片：") + info.fileName());
            QDir(stage).removeRecursively();
            return false;
        }
        originalNames.append(stored);
    }
    QVariantMap slotData;
    for (int i = 0; i < 3; ++i) {
        const Slot &slot = kSlots[i];
        const QString original = originalNames.at(qMin(i, originalNames.size() - 1));
        QImageReader reader(QDir(stage).filePath(original));
        reader.setAutoTransform(true);
        const QSize size = reader.size();
        if (!size.isValid() || qint64(size.width()) * size.height() > 50000000) {
            setError(QStringLiteral("图片无效或超过 5000 万像素上限。"));
            QDir(stage).removeRecursively();
            return false;
        }
        const double ratio = double(slot.width) / slot.height;
        const double imageRatio = double(size.width()) / size.height();
        const double w = qMin(1.0, ratio / imageRatio);
        const double h = qMin(1.0, imageRatio / ratio);
        const double x = (1.0 - w) / 2.0;
        const double y = (1.0 - h) / 2.0;
        if (!renderSlot(stage, original, slot.key, x, y, w, h)) {
            QDir(stage).removeRecursively();
            return false;
        }
        slotData.insert(slot.key, QVariantMap{{"original", original}, {"output", QString(slot.key) + ".png"},
                                          {"crop", QVariantList{x, y, w, h}},
                                          {"width", slot.width}, {"height", slot.height}});
    }
    const QVariantMap manifest{{"version", 1}, {"id", id}, {"name", safeName(name)},
                               {"slots", slotData}};
    if (!writeManifest(stage, manifest) || !QDir().rename(stage, themeDir(id))) {
        setError(QStringLiteral("无法保存主题配置。"));
        QDir(stage).removeRecursively();
        return false;
    }
    emit themesChanged();
    return activateTheme(id);
}

bool ThemeManager::importThemePack(const QUrl &manifestFile)
{
    const QFileInfo fileInfo(manifestFile.toLocalFile());
    if (!manifestFile.isLocalFile() || fileInfo.fileName() != "manifest.json" || !fileInfo.isFile() ||
        fileInfo.size() > 1024 * 1024) {
        setError(QStringLiteral("请选择本地主题包的 manifest.json（不超过 1 MB）。"));
        return false;
    }
    QFile file(fileInfo.filePath());
    if (!file.open(QIODevice::ReadOnly)) {
        setError(QStringLiteral("无法读取主题清单。"));
        return false;
    }
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        setError(QStringLiteral("主题清单不是有效 JSON。"));
        return false;
    }
    const QVariantMap input = document.object().toVariantMap();
    if (input.value("version").toInt() != 1) {
        setError(QStringLiteral("仅支持 v1 主题清单。"));
        return false;
    }
    const QVariantMap inputSlots = input.value("slots").toMap();
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    QString stage;
    if (!createStage(id, stage)) return false;
    QVariantMap outputSlots;
    QStringList copied;
    for (const Slot &slot : kSlots) {
        const QString key = QString::fromLatin1(slot.key);
        const QVariantMap entry = inputSlots.value(key).toMap();
        const QString original = entry.value("original").toString();
        const QVariantList crop = entry.value("crop").toList();
        if (!original.startsWith("original-") || original.contains('/') ||
            original.contains('\\') || original.contains("..") ||
            entry.value("output").toString() != key + ".png" ||
            entry.value("width").toInt() != slot.width ||
            entry.value("height").toInt() != slot.height || crop.size() != 4) {
            setError(QStringLiteral("主题清单的文件名、裁剪区域或尺寸不匹配。"));
            QDir(stage).removeRecursively();
            return false;
        }
        if (!copied.contains(original)) {
            const QFileInfo source(QDir(fileInfo.dir()).filePath(original));
            const QString packRoot = fileInfo.dir().canonicalPath();
            const QString sourceRoot = source.dir().canonicalPath();
            if (!source.isFile() || source.isSymbolicLink() || sourceRoot != packRoot ||
                source.size() > 100 * 1024 * 1024 ||
                QImageReader::imageFormat(source.filePath()).isEmpty() ||
                !QFile::copy(source.filePath(), QDir(stage).filePath(original))) {
                setError(QStringLiteral("主题原图缺失、过大或格式不受支持：") + original);
                QDir(stage).removeRecursively();
                return false;
            }
            copied.append(original);
        }
        if (!renderSlot(stage, original, key, crop.at(0).toDouble(), crop.at(1).toDouble(),
                        crop.at(2).toDouble(), crop.at(3).toDouble())) {
            QDir(stage).removeRecursively();
            return false;
        }
        outputSlots.insert(key, QVariantMap{{"original", original}, {"output", key + ".png"},
                                           {"crop", crop}, {"width", slot.width},
                                           {"height", slot.height}});
    }
    const QVariantMap manifest{{"version", 1}, {"id", id},
                               {"name", safeName(input.value("name").toString())},
                               {"slots", outputSlots}};
    if (!writeManifest(stage, manifest) || !QDir().rename(stage, themeDir(id))) {
        setError(QStringLiteral("无法保存导入的主题。"));
        QDir(stage).removeRecursively();
        return false;
    }
    emit themesChanged();
    return activateTheme(id);
}

bool ThemeManager::cropSlot(const QString &slot, double x, double y, double width, double height)
{
    QVariantMap manifest = readManifest(m_activeId);
    QVariantMap entries = manifest.value("slots").toMap();
    QVariantMap entry = entries.value(slot).toMap();
    const QString original = entry.value("original").toString();
    if (!findSlot(slot) || original.isEmpty() || original.contains('/') || original.contains('\\')) {
        setError(QStringLiteral("请先创建并启用主题。"));
        return false;
    }
    if (!renderSlot(themeDir(m_activeId), original, slot, x, y, width, height)) return false;
    entry.insert("crop", QVariantList{x, y, width, height});
    entries.insert(slot, entry);
    manifest.insert("slots", entries);
    if (!writeManifest(themeDir(m_activeId), manifest)) {
        setError(QStringLiteral("裁剪图已生成，但配置保存失败，请重试。"));
        return false;
    }
    setError({});
    ++m_revision;
    emit themeChanged();
    return true;
}

bool ThemeManager::activateTheme(const QString &id)
{
    if (!id.isEmpty() && readManifest(id).isEmpty()) {
        setError(QStringLiteral("主题不存在或配置版本不受支持。"));
        return false;
    }
    QSaveFile current(QDir(m_root).filePath("current.txt"));
    if (!current.open(QIODevice::WriteOnly) ||
        current.write(id.toUtf8()) != id.toUtf8().size() || !current.commit()) {
        setError(QStringLiteral("无法保存当前主题。"));
        return false;
    }
    m_activeId = id;
    setError({});
    ++m_revision;
    emit themeChanged();
    return true;
}

bool ThemeManager::removeTheme(const QString &id)
{
    if (readManifest(id).isEmpty()) {
        setError(QStringLiteral("主题不存在。"));
        return false;
    }
    if (m_activeId == id && !activateTheme({})) return false;
    if (!QDir(themeDir(id)).removeRecursively()) {
        setError(QStringLiteral("无法删除主题。"));
        return false;
    }
    setError({});
    emit themesChanged();
    return true;
}
