# 可选离线歌词转写适配器

`TranscriptionService` 是 Qt `QProcess` 适配器，**不是内置识别引擎**。应用和音频播放不依赖它。用户须自行选择三项本机文件：

1. FFmpeg 可执行文件，用于把 FLAC/MP3/WAV 等输入转换为 16 kHz、单声道、16-bit PCM WAV。
2. [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 的 `whisper-cli` 可执行文件；须支持 `-olrc` 和 `-of` 参数。
3. 与该 `whisper-cli` 版本兼容的多语种 ggml 模型文件。建议先尝试 `base` 级别得到速度优先的草稿，质量不够再试 `small`；CPU/GPU 性能和音乐歌词准确率尚未实测，不能承诺具体耗时、准确率或“实时”效果。GPU 加速取决于用户自行安装的二进制版本。

仅当用户主动点击“离线转写”时调用。服务先在应用缓存下建立临时目录，转换音频，再让 whisper.cpp 生成带行级时间戳的 LRC；成功后写入按音频、工具和模型的路径/大小/修改时间计算的缓存。再次处理未变化的输入会直接读缓存。任务异步运行，可取消，不改写原音频文件或相邻歌词文件。只允许一个任务同时执行。应用退出时终止子进程。

**转写结果是待校对草稿**：歌曲的伴奏、和声、拉长音、叠唱及纯器乐可能造成漏词、错词或幻觉；不提供逐字高亮。用户应先在歌词页面检查，再决定是否另存/使用。缓存仅是本机数据；不上传音频或模型。注意选中的外部可执行文件会以当前用户权限运行，只能使用可信来源。`whisper.cpp`、FFmpeg 二进制及模型各自有独立的许可条款，正式分发前必须逐一核对；此预览版不捆绑这些工具或模型。

## 接入要点

在 `desktop/CMakeLists.txt` 的 `clair-desktop` 源文件列表增加 `src/transcriptionservice.{h,cpp}`；无需额外 Qt 模块，已有 `Qt6::Core`（由 Quick 依赖）即可。`main.cpp` 创建 `TranscriptionService`，以现有 QML context property 方式暴露。界面用三个 `FileDialog` 分别选择 FFmpeg、whisper-cli、模型文件，赋给 `ffmpegExecutable`、`whisperExecutable`、`modelFile`。当前曲目本机 URL 传给 `transcribe(audioUrl)`；“取消”按钮调用 `cancel()`。监听 `completed(lrcFile, fromCache)` 后，以已有 `LyricsService::importLrc(lrcFile)` 装入歌词页；不要在切歌后自动把旧曲转写结果装入新曲，需核对触发时的曲目 URL。`busy`、`status`、`resultFile` 可直接显示。

单独测试目标包含 `tests/transcriptionservice_test.cpp`、`src/transcriptionservice.{h,cpp}`、`src/lyricsparser.{h,cpp}`，链接 `Qt6::Test`，用 `add_test(NAME transcription-service COMMAND ...)` 注册。测试用测试可执行文件自身模拟两个 CLI，不需要安装 FFmpeg/whisper.cpp/模型；覆盖成功、缓存、错误与取消。真实工具的音乐样本准确率仍须另测。
