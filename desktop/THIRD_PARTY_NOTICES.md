# Clair Desktop 第三方组件告知（预览版）

Clair 自身代码按仓库根目录的 MIT `LICENSE` 授权。Windows 便携包**动态链接**以下第三方运行库，用户可以替换包内的对应 DLL；请勿将本告知视为对未来正式发行包的完整法律审核。

| 组件 | 预览包中的用途 | 来源与授权信息 |
| --- | --- | --- |
| Qt 6.8.3（Core、Gui、Quick、QML、Multimedia 等） | 原生界面、音频、文件系统 | [Qt 6.8.3 源码](https://download.qt.io/official_releases/qt/6.8/6.8.3/single/)，本包按 LGPL-3.0-only 路径使用；参见 `licenses/LGPL-3.0.txt`、`licenses/GPL-3.0.txt` 和 Qt [开源义务说明](https://www.qt.io/licensing/open-source-lgpl-obligations)。 |
| Qt Multimedia 所附 FFmpeg n7.1 运行库 | FLAC/MP3/WAV 等媒体解码 | [FFmpeg 源码](https://ffmpeg.org/releases/)与[许可证说明](https://ffmpeg.org/legal.html)；包内含 `avcodec`、`avformat`、`avutil`、`swresample`、`swscale` DLL，参见 `licenses/LGPL-2.1.txt`。实际编译配置与可选组件的许可证须在正式分发前再核对。 |
| MinGW-w64 / GCC 13.1 运行库 | Windows C++ 运行时 | [MinGW-w64](https://www.mingw-w64.org/licensing/)与 [GCC Runtime Library Exception](https://www.gnu.org/licenses/gcc-exception-3.1.html)。 |

Qt 安装包自带的 SPDX 软件物料清单位于便携包 `licenses/sbom/`，用于追踪组件来源。Clair 不修改 Qt/FFmpeg DLL，也不将它们静态链接入主程序。若你要公开再分发、修改或重新打包，请按对应许可证履行义务并核对实际 DLL 的完整依赖清单。
