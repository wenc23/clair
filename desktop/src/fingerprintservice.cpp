#include "fingerprintservice.h"

#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QSet>
#include <QStringList>
#include <QUrlQuery>

#include <cmath>

namespace {
QString artistNames(const QJsonArray &artists)
{
    QStringList names;
    for (const auto &artist : artists) {
        const QString name = artist.toObject().value(QStringLiteral("name")).toString().trimmed();
        if (!name.isEmpty() && !names.contains(name)) names.append(name);
    }
    return names.join(QStringLiteral(", "));
}
}

FingerprintService::FingerprintService(QObject *parent) : QObject(parent)
{
    m_fingerprintTimeout.setSingleShot(true);
    connect(&m_fingerprintTimeout, &QTimer::timeout, this, [this] {
        if (m_stage != Fingerprinting) return;
        cancel();
        setStatus(QStringLiteral("指纹计算超时（120 秒），请换一首歌重试。"));
    });
}

void FingerprintService::setFpcalcExecutable(const QString &executable)
{
    const QString trimmed = executable.trimmed();
    if (trimmed.isEmpty() || trimmed == m_fpcalcExecutable) return;
    m_fpcalcExecutable = trimmed;
    emit fpcalcExecutableChanged();
}

void FingerprintService::setStatus(const QString &status)
{
    if (m_status == status) return;
    m_status = status;
    emit statusChanged();
}

void FingerprintService::setStage(Stage stage)
{
    if (m_stage == stage) return;
    const bool wasBusy = busy();
    m_stage = stage;
    if (wasBusy != busy()) emit busyChanged();
}

void FingerprintService::cancel()
{
    ++m_requestId;
    m_fingerprintTimeout.stop();
    if (m_fpcalc) {
        auto *oldProcess = m_fpcalc;
        m_fpcalc = nullptr;
        oldProcess->disconnect(this);
        if (oldProcess->state() != QProcess::NotRunning) oldProcess->kill();
        oldProcess->deleteLater();
    }
    if (m_reply) {
        auto *oldReply = m_reply;
        m_reply = nullptr;
        oldReply->abort();
        oldReply->deleteLater();
    }
    m_apiKey.clear();
    setStage(Idle);
    setStatus(QStringLiteral("已取消识别。"));
}

void FingerprintService::identify(const QUrl &audio, const QString &apiKey)
{
    cancel();
    m_audio = QUrl();
    m_candidates.clear();
    emit candidatesChanged();

    const QFileInfo file(audio.toLocalFile());
    if (!audio.isLocalFile() || !file.isFile() || !file.isReadable()) {
        setStatus(QStringLiteral("请先选择一个可读取的本地音频文件。"));
        return;
    }
    if (apiKey.trimmed().isEmpty()) {
        setStatus(QStringLiteral("请输入自己的 AcoustID API key 后再识别。"));
        return;
    }
    m_audio = QUrl::fromLocalFile(file.canonicalFilePath());
    m_apiKey = apiKey.trimmed();
    setStage(Fingerprinting);
    setStatus(QStringLiteral("正在本机计算 Chromaprint 指纹…"));
    m_fpcalc = new QProcess(this);
    auto *process = m_fpcalc;
    process->setProgram(m_fpcalcExecutable);
    process->setArguments({QStringLiteral("-json"), file.absoluteFilePath()});
    process->setProcessChannelMode(QProcess::SeparateChannels);
    connect(process, &QProcess::finished, this,
            [this, process](int exitCode, QProcess::ExitStatus exitStatus) {
                fingerprintFinished(process, exitCode, exitStatus);
            });
    connect(process, &QProcess::errorOccurred, this, [this, process](QProcess::ProcessError error) {
        if (m_fpcalc != process || m_stage != Fingerprinting || error != QProcess::FailedToStart) return;
        cancel();
        setStatus(QStringLiteral("无法启动 fpcalc。请安装 Chromaprint，并确认 fpcalc 在 PATH 中，或指定其可执行文件路径。"));
    });
    process->start();
    m_fingerprintTimeout.start(120000);
}

void FingerprintService::fingerprintFinished(QProcess *process, int exitCode, QProcess::ExitStatus exitStatus)
{
    if (m_stage != Fingerprinting || m_fpcalc != process) return;
    m_fingerprintTimeout.stop();
    m_fpcalc = nullptr;
    const QByteArray output = process->readAllStandardOutput();
    const QString stderrText = QString::fromUtf8(process->readAllStandardError()).trimmed();
    process->deleteLater();
    if (exitStatus != QProcess::NormalExit || exitCode != 0) {
        m_apiKey.clear();
        setStage(Idle);
        setStatus(QStringLiteral("fpcalc 无法读取该音频文件%1。")
                      .arg(stderrText.isEmpty() ? QString() : QStringLiteral("：") + stderrText.left(300)));
        return;
    }
    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(output, &parseError);
    const auto object = document.object();
    const QString fingerprint = object.value(QStringLiteral("fingerprint")).toString();
    const int duration = object.value(QStringLiteral("duration")).toInt();
    if (parseError.error != QJsonParseError::NoError || !document.isObject() ||
        fingerprint.isEmpty() || duration <= 0) {
        m_apiKey.clear();
        setStage(Idle);
        setStatus(QStringLiteral("fpcalc 未返回有效指纹或时长。"));
        return;
    }

    QNetworkRequest request(QUrl(QStringLiteral("https://api.acoustid.org/v2/lookup")));
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                      QStringLiteral("application/x-www-form-urlencoded; charset=utf-8"));
    request.setHeader(QNetworkRequest::UserAgentHeader,
                      QStringLiteral("ClairDesktop/0.3 (https://gitee.com/wenc23/clair)"));
    // Do not forward the user-supplied client key in a redirected POST.
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(20000);
    QUrlQuery form;
    form.addQueryItem(QStringLiteral("client"), m_apiKey);
    form.addQueryItem(QStringLiteral("duration"), QString::number(duration));
    form.addQueryItem(QStringLiteral("fingerprint"), fingerprint);
    form.addQueryItem(QStringLiteral("meta"), QStringLiteral("recordings"));
    m_apiKey.clear(); // Do not persist the key or retain it after the request is formed.
    setStage(LookingUp);
    setStatus(QStringLiteral("正在查询 AcoustID 候选歌名…"));
    m_reply = m_network.post(request, form.query(QUrl::FullyEncoded).toUtf8());
    const quint64 requestId = ++m_requestId;
    auto *reply = m_reply;
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, requestId] { lookupFinished(reply, requestId); });
}

QVariantList FingerprintService::parseLookupResponse(const QByteArray &json, QString *error)
{
    if (error) error->clear();
    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(json, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        if (error) *error = QStringLiteral("AcoustID 返回的数据无法解析。");
        return {};
    }
    const QJsonObject root = document.object();
    if (root.value(QStringLiteral("status")).toString() != QStringLiteral("ok")) {
        const auto responseError = root.value(QStringLiteral("error")).toObject();
        if (error) *error = QStringLiteral("AcoustID 查询失败（%1）。")
                                .arg(responseError.value(QStringLiteral("message")).toString(
                                    QStringLiteral("未知错误")));
        return {};
    }
    QVariantList candidates;
    QSet<QString> seen;
    for (const auto &resultValue : root.value(QStringLiteral("results")).toArray()) {
        const auto result = resultValue.toObject();
        const double score = result.value(QStringLiteral("score")).toDouble();
        if (!std::isfinite(score) || score < 0.0 || score > 1.0) continue;
        for (const auto &recordingValue : result.value(QStringLiteral("recordings")).toArray()) {
            const auto recording = recordingValue.toObject();
            const QString title = recording.value(QStringLiteral("title")).toString().trimmed();
            const QString artist = artistNames(recording.value(QStringLiteral("artists")).toArray());
            if (title.isEmpty()) continue;
            const QString key = title.toCaseFolded() + QChar(0x1f) + artist.toCaseFolded();
            if (seen.contains(key)) continue;
            seen.insert(key);
            candidates.append(QVariantMap{{QStringLiteral("title"), title},
                                          {QStringLiteral("artist"), artist},
                                          {QStringLiteral("score"), score},
                                          {QStringLiteral("recordingId"), recording.value(QStringLiteral("id")).toString()},
                                          {QStringLiteral("acoustid"), result.value(QStringLiteral("id")).toString()}});
            if (candidates.size() >= 20) return candidates;
        }
    }
    return candidates;
}

void FingerprintService::lookupFinished(QNetworkReply *reply, quint64 requestId)
{
    if (requestId != m_requestId || m_reply != reply || m_stage != LookingUp) return;
    m_reply = nullptr;
    reply->deleteLater();
    setStage(Idle);
    const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (httpStatus == 429) {
        bool validSeconds = false;
        const int retrySeconds = QString::fromLatin1(reply->rawHeader("Retry-After")).toInt(&validSeconds);
        setStatus(validSeconds && retrySeconds > 0
                      ? QStringLiteral("AcoustID 请求过于频繁，请 %1 秒后重试。").arg(retrySeconds)
                      : QStringLiteral("AcoustID 请求过于频繁，请稍后重试。"));
        return;
    }
    if (reply->error() != QNetworkReply::NoError || httpStatus < 200 || httpStatus >= 300) {
        setStatus(QStringLiteral("AcoustID 网络请求失败（HTTP %1）：%2")
                      .arg(httpStatus).arg(reply->errorString()));
        return;
    }
    QString error;
    m_candidates = parseLookupResponse(reply->readAll(), &error);
    emit candidatesChanged();
    setStatus(!error.isEmpty() ? error
              : m_candidates.isEmpty() ? QStringLiteral("没有找到可用歌名；可手动编辑曲目信息。")
                                       : QStringLiteral("请核对候选歌名并手动选择；不会修改原始音频文件或标签。"));
}

void FingerprintService::chooseCandidate(int index)
{
    if (busy() || index < 0 || index >= m_candidates.size() || m_audio.isEmpty()) return;
    const auto candidate = m_candidates.at(index).toMap();
    emit proposalSelected(m_audio, candidate.value(QStringLiteral("title")).toString(),
                          candidate.value(QStringLiteral("artist")).toString());
}
