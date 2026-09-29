# Clair Desktop Linux x64 试用版 0.3.9

0.3.9 增加保守的旧转写草稿整理与运行中任务保护，并为本地 Web 静态服务加入半请求超时。未做 24 小时压力测试，不能据此保证长时零泄漏。

解压后运行 `bin/clair-desktop`。这是原生 Qt 桌面应用，播放不依赖浏览器、Node.js 或 Web 服务。可导入目录或任意位置单独文件；支持播放模式、分组、歌词页/浮窗、主题图片组与框选裁剪。`bin/web/` 仅供“打开 Web 版”按钮使用。

默认进入原生“正在聆听”页，包含唱片、曲目信息、当前歌词和底部播放栏；左侧可切换曲库与歌词。包内有 Clair 启动图标与 Linux 桌面入口。离线转写改用源格式解码再转为 16 kHz PCM，避免某些后端直接请求 16 kHz 时得到空数据。实时频谱尚未实现。

Web 和桌面版需选择同一音乐根目录，才会通过 `.Clair/favorites.json`、`playlists.json`、`resume.json` 共享收藏、命名歌单及每曲继续播放位置。两版播放互不抢占，状态不会强制实时控制另一播放器。Web 需使用支持文件夹读写 API 的浏览器；外部单文件和 LAN 只读曲库不参与同步。同一瞬间跨进程编辑同一共享文件尚无事务保护，请备份重要歌单。

这个包在 **Ubuntu 24.04 / WSLg x64** 构建并冷启动验证，尚不能保证兼容其他发行版或更旧 glibc。目标系统仍须有 XCB/OpenGL/音频设备等系统库；Ubuntu 24.04 至少可安装 `libgl1 libxkbcommon-x11-0 libxcb-cursor0 libxcb-icccm4 libxcb-keysyms1`。若 Wayland 合成器不允许歌词浮窗置顶，可使用普通歌词页。此包不适用于 Windows/macOS。

离线歌词转写已内置 CPU 版 whisper.cpp 和轻量多语种模型；Qt Multimedia 本机解码，用户无需选择工具。不上传原音频；识别结果为待校对草稿。指纹歌名匹配仍需 fpcalc 与个人 AcoustID API key。详见 `TRANSCRIPTION.md` 与 `THEMES.md`。第三方许可见 `THIRD_PARTY_NOTICES.md` 与 `licenses/`。

你确认试用效果并反馈修复前，不向 Gitee 或 GitHub 提 PR。
