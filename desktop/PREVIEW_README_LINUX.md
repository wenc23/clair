# Clair Desktop Linux x64 试用版 0.3.3

解压后运行 `bin/clair-desktop`。这是原生 Qt 桌面应用，播放不依赖浏览器、Node.js 或 Web 服务。可导入目录或任意位置单独文件；支持播放模式、分组、歌词页/浮窗、主题图片组与框选裁剪。`bin/web/` 仅供“打开 Web 版”按钮使用。

这个包在 **Ubuntu 24.04 / WSLg x64** 构建并冷启动验证，尚不能保证兼容其他发行版或更旧 glibc。目标系统仍须有 XCB/OpenGL/音频设备等系统库；Ubuntu 24.04 至少可安装 `libgl1 libxkbcommon-x11-0 libxcb-cursor0 libxcb-icccm4 libxcb-keysyms1`。若 Wayland 合成器不允许歌词浮窗置顶，可使用普通歌词页。此包不适用于 Windows/macOS。

离线歌词转写已内置 CPU 版 whisper.cpp 和轻量多语种模型；Qt Multimedia 本机解码，用户无需选择工具。不上传原音频；识别结果为待校对草稿。指纹歌名匹配仍需 fpcalc 与个人 AcoustID API key。详见 `TRANSCRIPTION.md` 与 `THEMES.md`。第三方许可见 `THIRD_PARTY_NOTICES.md` 与 `licenses/`。

你确认试用效果并反馈修复前，不向 Gitee 或 GitHub 提 PR。
