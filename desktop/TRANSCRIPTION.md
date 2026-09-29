# 内置离线歌词转写（预览）

Windows/Linux 0.3.6 试用包自带 CPU 版 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) `whisper-cli` 和多语种 `ggml-tiny-q5_1.bin`（约 32 MB）。用户在“歌词”页点击“离线转写”→“开始转写”即可；无需自行选择 FFmpeg、程序或模型。识别只在用户主动触发时运行，不上传音频。未打包的开发构建仍可在“高级设置”中自选程序和模型。

应用使用已有 Qt Multimedia/FFmpeg 媒体后端的 `QAudioDecoder` 在本机把音频转换成 16 kHz、单声道、16-bit PCM WAV，再异步调用 `whisper-cli` 生成行级 LRC。这样不额外分发一份 FFmpeg 命令行程序。成功结果缓存于用户缓存目录；输入音频、模型或识别程序变化后缓存失效。任务可取消，退出时终止子进程。不会修改原音频、同目录 LRC 或 Web 版曲库。

**这是待人工校对的草稿，不是准确歌词承诺。** tiny 模型省空间和 CPU，但歌曲伴奏、和声、拉长音、叠唱、语言自动判定及纯器乐都可能造成错词、漏词或幻觉。先检查已有本地 LRC 或在线歌词候选；找不到时再转写。CPU 速度取决于机器和曲目长度，不能称为实时字幕。高级设置选中的第三方可执行文件以当前用户权限运行，只能使用可信来源。

## 捆绑组件与复现

- whisper.cpp 源码：`v1.9.4`，提交 `927cfce34f31707e17f2bff35c349632fb9e2c3a`，MIT。Windows/Linux 均构建 CPU 版本，不要求 GPU。Windows 使用 MinGW 13.1；Linux 试用构建在 Ubuntu 24.04。
- 模型：[ggerganov/whisper.cpp 的 `ggml-tiny-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny-q5_1.bin)，仓库版本 `5359861c739e955e79d9a303bcbc70fb988958b1`，模型卡标记 MIT；固定 SHA-256：`818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`。该文件来自 OpenAI Whisper 权重的 ggml 量化版本；许可证见 `licenses/whisper-model-MIT.txt`。
- Windows 打包脚本从 `-TranscriptionAssetsDir`（默认为构建目录内的 `transcription/`）复制 `whisper-cli.exe`、模型及 MinGW 运行库；Linux 打包脚本从第三参数（默认为构建目录内的 `transcription/`）复制 `whisper-cli` 和模型。两者在打包前校验模型 SHA-256，缺件即拒绝生成不完整试用包。二进制/模型不提交进 Git 仓库。

单元测试以测试进程模拟识别 CLI，覆盖成功、缓存、错误与取消；可用 `CLAIR_TEST_BUNDLED_ASR_AUDIO` 对本地短音频进行真实模型端到端测试。Windows 已对 15 秒 MP3 片段验证了 Qt 解码→捆绑模型→LRC 流程；这证明管线可运行，**不证明歌词识别准确率**。macOS 尚无实机发行验证。
