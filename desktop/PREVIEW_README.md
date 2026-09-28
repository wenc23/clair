# Clair Desktop Windows 试用版 0.1.0

双击 `clair-desktop.exe`，点击“选择音乐目录”即可扫描并播放本机 FLAC、MP3、WAV。此便携包不要求安装 Qt、Node.js 或启动 Web 服务。切换到 Web 版的按钮仅打开指定网页；如需使用，请先按仓库 README 单独启动 Web 服务。

本版是**可试用的原生播放器首期版本，不是全部功能完成版**。现已提供基础曲库、播放/暂停、进度、音量与 Web 入口；尚未实现歌词浮窗、自动歌词识别、图片组主题、标签编辑、收藏同步、均衡器、频谱和完整发行安装器。请不要用它改写或整理重要曲库标签：本版只读音频及 Web 版 `.Clair/library.json`，不会写入音乐文件。

直接解压整个压缩包再运行，不要只取出 EXE；运行库和 `qml/`、`platforms/` 等目录必须保留在一起。若媒体无法播放，请记录文件格式、Windows 版本和错误提示；不同平台的编解码与输出设备仍需验证。

源码与测试位于 Clair 仓库 `desktop/`；第三方许可证与来源见 `THIRD_PARTY_NOTICES.md` 和 `licenses/`。此 Windows x64 包已完成本机原生启动、FLAC/MP3/WAV 解码样本、WAV 播放进度以及便携目录冷启动测试。macOS/Linux 需使用各自的包，不可直接运行此 EXE。
