# Clair Desktop（首个原生纵向切片）

这是与现有 Web 版并存的 Qt 6 桌面应用。扫描、曲库及播放均在本地完成，不需要 Node.js、浏览器、WebView 或 HTTP 服务。“打开 Web 版”默认启动仅监听本机的轻量静态页面入口；原生播放不经过该入口。

## 构建

要求 CMake 3.21+、C++17 编译器、Qt 6.8+（Quick、Quick Controls 2、Multimedia、Concurrent、Network、Test）及 Qt 对应平台的部署/编解码运行库。

```sh
cmake -S desktop -B desktop/build -DCMAKE_BUILD_TYPE=Release
cmake --build desktop/build --config Release
ctest --test-dir desktop/build -C Release --output-on-failure
```

在 Windows 上可运行 `desktop/build/clair-desktop.exe`（多配置生成器的可执行文件通常位于 `Release/`）；macOS 使用 `.app`，Linux 使用 `clair-desktop`。发布包尚未制作，直接运行构建产物时需让 Qt 动态库和插件可见。

Windows + Qt 6.8.3 MinGW 的 `qmlimportscanner` 在含非 ASCII 字符的源码路径下可能报 `No such file or directory`。遇到该问题请将仓库放在纯 ASCII 路径，或建立指向仓库的 ASCII 路径 junction，并从该路径配置 CMake；不要把它误判为源码缺失。

Qt 6.8+ 还提供原生安装部署：`cmake --install desktop/build --prefix <目标目录>`。CMake 会部署 QML、Qt 运行库和随包 Web 静态文件；macOS 安装出 `.app`，Linux 安装出 `bin/clair-desktop`。Linux 的系统级 XCB/OpenGL 依赖仍需目标发行版提供（本机 Ubuntu 24.04 已验证 `libxcb-cursor0`、`libxcb-icccm4`、`libxcb-keysyms1` 等）；不能把在 Ubuntu 24.04 打的包宣称兼容所有较旧发行版。

Linux x64 可从 Release 构建生成独立压缩包：`bash desktop/package-linux.sh /absolute/build /absolute/output/Clair-Desktop-Linux-x64-Preview-0.3.3.tar.gz [ASSETS_DIR]`。Windows 使用 `desktop/package-windows.ps1 -BuildDir ... -OutputDir ... [-TranscriptionAssetsDir ...]`。两种脚本均要求提供固定哈希的 whisper.cpp 轻量模型和本机 `whisper-cli`，拒绝生成缺件包；脚本也拒绝覆盖已有目标并写 SHA-256 文件。macOS 目前提供 CMake `.app` 安装路径，尚未在 macOS 主机验证或打包发行。

## 当前能力

- 异步扫描 FLAC、MP3、WAV 文件；自动跳过 `.Clair`、`.Clair 回收站`、符号链接与 junction。格式解码和输出设备仍须逐平台实测。
- 将现有 `.Clair/library.json` schema v1 作为**只读、可能滞后**的标题/艺术家/专辑来源；缺失时用文件名与目录名回退，任何流派均可导入。
- 文件夹和任意位置的单独文件导入，记录来源；逐曲打开原文件所在文件夹、删除后刷新曲库；显示歌名/歌手覆盖及用户显式触发的磁盘文件重命名。
- 本地 LRC、手动导入、LRCLIB 候选搜索、歌词页和置顶浮窗。
- 分组浏览，以及顺序、列表循环、单曲循环、组内随机；上一首/下一首、进度与音量。
- 图片组三槽主题、应用内框选裁剪及 v1 manifest 主题包导入（见 [THEMES.md](THEMES.md)）。
- 可选 Chromaprint/fpcalc + AcoustID 候选歌名匹配（仍需个人 API key 和 fpcalc）；试用包内置 CPU 版 whisper.cpp 和 tiny-q5_1 模型生成离线歌词草稿（见 [TRANSCRIPTION.md](TRANSCRIPTION.md)），无需用户选择工具。
- Web 入口默认使用包内只读静态页面；自定义地址可在 Web 设置中修改。其生命周期和数据与原生播放分离。

## 尚未声称支持

当前仍未实现 Web 端的标签写入、收藏同步、均衡器、频谱、无缝播放、回收站、LAN 模式及内嵌歌词解析。可选的指纹匹配与离线转写并非内置免配置服务，也没有音频/歌词准确率保证。Qt Multimedia 的格式支持和 FFmpeg 部署须在每个目标操作系统验证。路线与歌词效能方案见 [原生桌面端设计](../docs/native-desktop.md)。

测试目录中的 `tone.wav`、`tone.flac`、`tone.mp3` 是由 440 Hz 正弦波生成的原创短样本，用于验证三种格式能被当前 Qt 后端读取。若本机有音频输出设备，可设置 `CLAIR_TEST_AUDIO_OUTPUT=1` 再运行测试，附加检查 WAV 播放进度确实推进；CI 默认跳过该设备相关检查。
