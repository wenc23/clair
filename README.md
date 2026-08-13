# Clair

Clair 是一款面向古典音乐收藏的本地 Web 播放器，主要用于播放、整理和检查 FLAC 音乐库。界面分为“正在聆听”“音乐库”“运行日志”三个页面。

## 主要功能

- 选择一个本地音乐目录，保留真实文件夹层级，不把曲目混在一起。
- 提供六种音乐库组织方式：
  - 目录树：严格按照磁盘目录结构展示。
  - 专辑：专辑艺术家 → 专辑。
  - 艺术家：艺术家 → 专辑。
  - 古典作品：作曲家 → 作品 → 具体录音版本。
  - 智能收藏：收藏、高解析度、古典录音、待整理及其他曲目。
  - 年代：按年份归档。
- 古典作品视图会用专辑、指挥、乐团和年份区分同一作品的不同录音，避免错误合并。
- 多碟专辑优先按照碟号和音轨号排序，再应用标题等显示排序规则。
- 使用 FLAC STREAMINFO 的音频 MD5 建立稳定曲目标识；文件重命名或移动后，收藏等状态仍可跟随曲目。
- 解析 FLAC、MP3 和 WAV 的格式、采样率、位深、码率、声道和时长。
- 显示曲名、艺术家/独奏者、作曲家、作品、指挥家、乐团、专辑和年代等资料。
- 直接修改 FLAC 内部 Vorbis Comment；写入后重新读取校验，并保留音频帧、封面及其他元数据块。
- 每次写入 FLAC 前，将原始标签备份至音乐目录的 `.Clair/metadata-backups`。
- 读取 FLAC Picture 和 MP3 APIC 内嵌封面。
- 使用 Web Audio API 显示实时对数频谱、峰值保持和波形。
- 支持分组折叠、全部折叠/展开、搜索、排序、收藏和 M3U 导出。
- 支持批量选择、批量移入回收站、恢复和重命名；回收站保留原有子目录结构。
- 音乐库体检区分普通资料缺失与古典音乐专属资料缺失，并统计重复曲目和缺少年份的曲目。
- 提供三段均衡器、左右声道平衡、随机播放和循环模式。
- 提供夜曲黑、象牙白、深海蓝三套响应式主题。
- 独立运行日志页记录扫描、解析、播放、文件操作和异常，并支持筛选、诊断、导出与清空。

## 启动

文件夹读写依赖浏览器的 File System Access API，请使用较新的 Chrome 或 Edge，并通过 `localhost` 打开。

```powershell
node server.cjs
```

然后访问 `http://127.0.0.1:8000`。

首次点击“选择音乐文件夹”时，请授予读写权限。删除操作不会直接永久删除文件，而是将文件移动到音乐目录内的 `.Clair 回收站`。

## 本地数据

Clair 会在所选音乐目录内创建 `.Clair`：

- `clair.log`：本地运行日志，超过约 5 MB 后自动保留最近内容。
- `library.json`：可读的音乐库索引与收藏状态。
- `settings.json`：主题、排序、组织方式和折叠状态。
- `metadata-backups/`：修改 FLAC 前保存的原始 Vorbis Comment。

浏览器仍会将已授权的目录句柄保存在 IndexedDB 中；实际日志、音乐库数据和设置以 `.Clair` 内的文件为准。

## 主要文件

- `index.html`：页面结构。
- `styles.css`：界面、主题和响应式布局。
- `app.js`：播放、频谱、元数据解析、音乐库管理和日志。
- `library-model.js`：稳定曲目标识、层级组织、排序和智能分类。
- `flac-metadata.js`：FLAC 元数据块读取、重建和校验。
- `server.cjs`：本地只读静态服务器。
- `tests/library-model.test.cjs`：音乐库组织、稳定标识和排序测试。
- `tests/flac-metadata.test.cjs`：FLAC 元数据无损重建测试。

## 自动处理新增 FLAC

`tools/flac-auto-metadata.cjs` 用于接管新加入音乐目录的 FLAC。它默认只显示将要补齐的字段；只有传入 `--apply` 时才会写入文件。

它遵循保守规则：保留已有标签、封面和音频数据，只从明确的文件/目录信息补齐空字段，例如曲名、音轨号、碟号、专辑名和位于目录名中的年份。对于 `vivaldi_the four seasons_sarah chang orpheus chamber orchestra_spring` 这样有下划线分隔、且以已知作曲家开头的古典目录名，它还会补齐作曲家、作品、演奏者和乐团；其他无法可靠判断的古典资料不会猜测。如需为一批导入文件提供确定值，可使用 `--set`。

```powershell
# 先预览，不修改文件
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music"

# 确认后写入；每次修改前会备份原始元数据区
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --apply

# 持续监听新加入或替换的 FLAC（按 Ctrl+C 停止）
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --apply --watch

# 为本次导入的缺失字段提供确定值，不覆盖已有值
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --apply --set ARTIST="演奏者" --set DATE=2025
```

也可以双击或在终端运行 `auto-metadata.cmd`。处理记录保存于音乐目录的 `.Clair/auto-metadata-state.json`，日志写入 `.Clair/auto-metadata.log`，原始 FLAC 元数据区备份至 `.Clair/metadata-backups/auto-*`。

### 使用 DeepSeek 精确匹配

对于文件名或目录名不足以可靠判断的录音，可显式启用 DeepSeek。脚本只发送相对路径、文件名、已有标签、FLAC 技术信息，以及同目录曲目的排序序号和标签摘要；不会发送音频内容、封面、绝对磁盘路径或 API 密钥。

```powershell
# 仅在当前 PowerShell 会话中设置密钥；不要把密钥写进脚本或提交到仓库
$env:DEEPSEEK_API_KEY = "你的 DeepSeek API Key"

# 先生成建议与本地审核记录，不修改 FLAC
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --all --deepseek

# 确认审核记录后写入；--all 会重新检查此前已处理的文件
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --all --deepseek --apply
```

默认使用 `deepseek-v4-flash`，仅接受置信度不低于 `0.92` 的建议；它只会补充缺失字段或替换“音轨01”这类占位标题，绝不覆盖已有的正常标签。若模型依据完整曲序推断乐章标题，提示词要求其置信度至少为 `0.97`，并要求在一次请求中返回整组曲目；罗马数字乐章号与文件序号冲突时，脚本会拒绝整组标题建议。每次模型建议都会记录到 `.Clair/deepseek-metadata-review.jsonl`，其中包含模型、置信度、依据、建议字段和实际接受字段。可通过 `--deepseek-model` 或 `--deepseek-confidence` 调整模型与阈值。
