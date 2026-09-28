#include "../src/transcriptionservice.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTest>
#include <QThread>

namespace {
bool writeFile(const QString &path, const QByteArray &data)
{
    QFile file(path);
    return file.open(QIODevice::WriteOnly | QIODevice::Truncate) && file.write(data) == data.size();
}

QString argumentAfter(const QStringList &args, const QString &key)
{
    const int index = args.indexOf(key);
    return index >= 0 && index + 1 < args.size() ? args.at(index + 1) : QString();
}

int fakeTool(const QStringList &args)
{
    if (args.contains("-acodec")) {
        const QString input = argumentAfter(args, "-i");
        if (input.contains("fail")) return 7;
        return writeFile(args.last(), "RIFFtest") ? 0 : 8;
    }
    if (args.contains("-olrc")) {
        if (argumentAfter(args, "-m").contains("slow")) QThread::msleep(2500);
        const QString output = argumentAfter(args, "-of") + ".lrc";
        return writeFile(output, "[00:01.00]draft line\n[00:03.20]second line\n") ? 0 : 9;
    }
    return 10;
}
}

class TranscriptionServiceTest : public QObject {
    Q_OBJECT
private slots:
    void producesAndReusesCache();
    void reportsConversionFailure();
    void cancelStopsRecognition();
};

void TranscriptionServiceTest::producesAndReusesCache()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.mp3");
    const QString model = dir.filePath("ggml-base.bin");
    QVERIFY(writeFile(audio, "dummy audio"));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    const QUrl executable = QUrl::fromLocalFile(QCoreApplication::applicationFilePath());
    service.setFfmpegExecutable(executable);
    service.setWhisperExecutable(executable);
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_COMPARE_WITH_TIMEOUT(completed.size(), 1, 10000);
    QVERIFY(!service.busy());
    QVERIFY(QFileInfo::exists(service.resultFile().toLocalFile()));
    QCOMPARE(completed.first().at(1).toBool(), false);
    completed.clear();
    service.transcribe(QUrl::fromLocalFile(audio));
    QCOMPARE(completed.size(), 1);
    QCOMPARE(completed.first().at(1).toBool(), true);
}

void TranscriptionServiceTest::reportsConversionFailure()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("fail.mp3");
    const QString model = dir.filePath("ggml-base.bin");
    QVERIFY(writeFile(audio, "dummy audio"));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setFfmpegExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_VERIFY_WITH_TIMEOUT(!service.busy(), 10000);
    QVERIFY2(service.status().contains("ffmpeg"), qPrintable(service.status()));
    QVERIFY(service.resultFile().isEmpty());
}

void TranscriptionServiceTest::cancelStopsRecognition()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.mp3");
    const QString model = dir.filePath("slow.bin");
    QVERIFY(writeFile(audio, "dummy audio"));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setFfmpegExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_VERIFY_WITH_TIMEOUT(service.status().contains("识别"), 10000);
    service.cancel();
    QTRY_VERIFY_WITH_TIMEOUT(!service.busy(), 10000);
    QCOMPARE(completed.size(), 0);
    QVERIFY(service.status().contains("取消"));
    QVERIFY(service.resultFile().isEmpty());
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QStandardPaths::setTestModeEnabled(true);
    const QStringList args = app.arguments().mid(1);
    if (args.contains("-acodec") || args.contains("-olrc")) return fakeTool(args);
    TranscriptionServiceTest test;
    return QTest::qExec(&test, argc, argv);
}

#include "transcriptionservice_test.moc"
