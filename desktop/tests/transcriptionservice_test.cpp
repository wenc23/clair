#include "../src/transcriptionservice.h"

#include <QCoreApplication>
#include <QDataStream>
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

bool writeWave(const QString &path)
{
    QByteArray wave;
    QDataStream stream(&wave, QIODevice::WriteOnly);
    stream.setByteOrder(QDataStream::LittleEndian);
    stream.writeRawData("RIFF", 4);
    stream << quint32(36 + 32000);
    stream.writeRawData("WAVEfmt ", 8);
    stream << quint32(16) << quint16(1) << quint16(1) << quint32(16000)
           << quint32(32000) << quint16(2) << quint16(16);
    stream.writeRawData("data", 4);
    stream << quint32(32000);
    wave.append(QByteArray(32000, '\0'));
    return writeFile(path, wave);
}

QString argumentAfter(const QStringList &args, const QString &key)
{
    const int index = args.indexOf(key);
    return index >= 0 && index + 1 < args.size() ? args.at(index + 1) : QString();
}

int fakeTool(const QStringList &args)
{
    if (args.contains("-olrc")) {
        if (argumentAfter(args, "-m").contains("slow")) QThread::msleep(2500);
        const QString output = argumentAfter(args, "-of") + ".lrc";
        if (argumentAfter(args, "-m").contains("hallucination")) {
            QByteArray repeated;
            for (int i = 0; i < 30; ++i)
                repeated += QByteArray("[00:") + QByteArray::number(i).rightJustified(2, '0')
                            + ".00]same invented line\n";
            return writeFile(output, repeated) ? 0 : 9;
        }
        if (argumentAfter(args, "-m").contains("language"))
            return writeFile(output, "[00:01.00]" + argumentAfter(args, "-l").toUtf8() + "\n") ? 0 : 9;
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
    void cancelStopsConversion();
    void rejectsRepeatedHallucination();
    void infersEnglishFromBracketedSongTitle();
    void decodesOptionalRealAudio();
    void usesBundledModelIfRequested();
};

void TranscriptionServiceTest::producesAndReusesCache()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.wav");
    const QString model = dir.filePath("ggml-base.bin");
    QVERIFY(writeWave(audio));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    const QUrl executable = QUrl::fromLocalFile(QCoreApplication::applicationFilePath());
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
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_VERIFY_WITH_TIMEOUT(!service.busy(), 10000);
    QVERIFY2(service.status().contains("解码"), qPrintable(service.status()));
    QVERIFY(service.resultFile().isEmpty());
}

void TranscriptionServiceTest::cancelStopsRecognition()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.wav");
    const QString model = dir.filePath("slow.bin");
    QVERIFY(writeWave(audio));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
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

void TranscriptionServiceTest::cancelStopsConversion()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.wav");
    const QString model = dir.filePath("dummy-model.bin");
    QVERIFY(writeWave(audio));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QVERIFY(service.busy());
    service.cancel();
    QVERIFY(!service.busy());
    QCOMPARE(completed.size(), 0);
    QVERIFY(service.status().contains(QStringLiteral("取消")));
}

void TranscriptionServiceTest::rejectsRepeatedHallucination()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath("sample.wav");
    const QString model = dir.filePath("hallucination.bin");
    QVERIFY(writeWave(audio));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_VERIFY_WITH_TIMEOUT(!service.busy(), 10000);
    QCOMPARE(completed.size(), 0);
    QVERIFY(service.resultFile().isEmpty());
    QVERIFY2(service.status().contains(QStringLiteral("重复")), qPrintable(service.status()));
}

void TranscriptionServiceTest::infersEnglishFromBracketedSongTitle()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString audio = dir.filePath(QStringLiteral("Glass Animals《The Other Side Of Paradise》试听.wav"));
    const QString model = dir.filePath("language.bin");
    QVERIFY(writeWave(audio));
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_COMPARE_WITH_TIMEOUT(completed.size(), 1, 10000);
    QFile result(service.resultFile().toLocalFile());
    QVERIFY(result.open(QIODevice::ReadOnly));
    QVERIFY(result.readAll().contains("]en"));
}

void TranscriptionServiceTest::decodesOptionalRealAudio()
{
    const QString audio = qEnvironmentVariable("CLAIR_TEST_AUDIO_FILE");
    if (audio.isEmpty()) QSKIP("Set CLAIR_TEST_AUDIO_FILE to test a real MP3/FLAC decoder path.");
    QVERIFY(QFileInfo::exists(audio));
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString model = dir.filePath("dummy-model.bin");
    QVERIFY(writeFile(model, "dummy model"));
    TranscriptionService service;
    service.setWhisperExecutable(QUrl::fromLocalFile(QCoreApplication::applicationFilePath()));
    service.setModelFile(QUrl::fromLocalFile(model));
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_COMPARE_WITH_TIMEOUT(completed.size(), 1, 120000);
    QVERIFY2(service.status().contains(QStringLiteral("草稿")), qPrintable(service.status()));
}

void TranscriptionServiceTest::usesBundledModelIfRequested()
{
    const QString audio = qEnvironmentVariable("CLAIR_TEST_BUNDLED_ASR_AUDIO");
    if (audio.isEmpty()) QSKIP("Set CLAIR_TEST_BUNDLED_ASR_AUDIO for the optional real-model test.");
    QVERIFY(QFileInfo::exists(audio));
    TranscriptionService service;
    service.useBundledTools();
    QVERIFY(service.ready());
    QSignalSpy completed(&service, &TranscriptionService::completed);
    service.transcribe(QUrl::fromLocalFile(audio));
    QTRY_COMPARE_WITH_TIMEOUT(completed.size(), 1, 180000);
    QVERIFY(QFileInfo::exists(service.resultFile().toLocalFile()));
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QStandardPaths::setTestModeEnabled(true);
    const QStringList args = app.arguments().mid(1);
    if (args.contains("-olrc")) return fakeTool(args);
    TranscriptionServiceTest test;
    return QTest::qExec(&test, argc, argv);
}

#include "transcriptionservice_test.moc"
