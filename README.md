# Clair

![CI](https://github.com/wenc23/clair/actions/workflows/ci.yml/badge.svg)

Clair 是一款面向古典音乐收藏的本地 Web 播放器，主要用于播放、整理和检查 FLAC 音乐库。界面分为“正在聆听”“音乐库”“运行日志”三个页面。

仓库还包含一个与 Web 版并存的[原生 Qt 桌面端](desktop/README.md)，面向任意流派，无需浏览器或本地 Web 服务即可导入、分组和播放本地音乐。桌面预览版已加入可拖动/锁定的半透明歌词浮窗、图片组主题与裁剪、可选音频指纹歌名候选及试用包内置的轻量离线歌词草稿；它与 Web 版仍非全功能对等，完成范围和限制见[桌面端路线](docs/native-desktop.md)。

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
- 使用 Web Audio API 显示实时对数频谱与波形。镀铬用镜面金属带（高光扫过）、极光用三层错位光带、潮汐用声呐回波、樱花用花瓣。
- 支持分组折叠、全部折叠/展开、搜索、排序、收藏和 M3U 导出。
- 支持批量选择、批量移入回收站、恢复和重命名；回收站保留原有子目录结构。
- 音乐库体检区分普通资料缺失与古典音乐专属资料缺失，并统计重复曲目和缺少年份的曲目。
- 提供三段均衡器、左右声道平衡、随机播放和循环模式。
- 播放页在常规窗口下**不需要滚动**即可看到全部内容：唱片区与曲目板并排、频谱带与规格铭牌在下、播放条固定在最底。窗口偏矮时（≤780px 高）或窄屏下自动切换为紧凑布局或允许滚动，避免内容被裁切或面板互相压住。四套主题 × 明暗两态在桌面、笔记本、平板横竖屏与手机（390px）下均已验证：无横向溢出、无面板重叠、唱片尺寸正常。
- 提供四套响应式主题，按**生成机制家族**各保留一套，每套都有**明 / 暗两种模式**，并且**强调色与底色都可以自己挑**。

  主题不是"单色换皮"，这套约束是可执行的：每套主题必须声明唯一的 `--mechanism` 且 `--panel-recipe` 互不相同，由 `tests/theme-contract.test.cjs` 断言，重复即测试失败。每套主题还取自一个**不同的设计运动**，并带**可测量的结构差异**（侧栏宽度、面板左右次序、栏比、间距、表头对齐）：

  | 分类 | 主题 | 机制 | 设计运动 | 结构特征（实测） |
  |---|---|---|---|---|
  | 纸墨 | 樱花 `sakura` | `washi` | 和风极简 · 纸与墨 | **结构与色系都不同于其余 3 套**：和纸底 + 漆墨线脚 + 朱砂印；封面满幅做背景、唱片缩成左下角印章、信息以暗玻璃题签浮于封面之上（宽屏专用，880px 以下退回常规排布） |
  | 光带 | 极光 `aurora` | `bands` | 电影沉浸 | 侧栏 236px，居中表头，间距 26px |
  | 镜面 | 镀铬 `chrome` | `metal` | Y2K 拟物仪器 | 侧栏 216px，唱片区在右，间距 12px，2px 亮边凸起 |
  | 水波 | 潮汐 `tide` | `caustics` | 瑞士国际主义 | 侧栏 200px，左对齐、无影、间距 30px |

  机制通过三个令牌落地：`--panel-recipe`（面板背景配方）、`--panel-effect`（面板滤镜配方）、`--mechanism`（机制标签）；结构通过 `--layout-*`（侧栏宽度、面板次序、栏比、间距、表头对齐）。`--flourish` 是装饰强度总开关。樱花还把 `background-clip: text` 的渐变字改回实色，其数量由测试锁定。

  **明暗模式**：调色板按 `body[data-theme="X"][data-mode="light|dark"]` 分成两块，机制与形制仍留在 `body[data-theme="X"]`，因此明暗只换颜色、不改性格。默认**跟随系统**（`prefers-color-scheme`），也可以手动锁定"明"或"暗"；手动选择后换主题仍会保留。`tools/theme-contrast.cjs` 会逐个校验 4 × 2 = 8 个调色板块的 WCAG 对比度。

  **自选颜色**：侧栏可改**强调色**与**底色**（取色器、十六进制输入、预设色点、一键恢复默认）。派生在 `theme-model.js` 中完成——它按当前模式把底色钳到合适的明度区间，并逐条复核 `CONTRAST_RULES`（正文 ≥7:1，次级/小标签/强调/危险 ≥4.5:1），不达标的颜色会被自动校正并在提示行说明，因此"随便挑一个颜色"也不会把界面变成不可读。覆盖只落在 L1 调色板里与强调/底色相关的令牌上（`--accent*`、`--bg`、`--surface*`、`--text`、`--muted`、`--faint`、`--good/--warn/--danger`、`--grad-1/2/3/4`）；未自定义的令牌一律清除内联覆盖，回到主题作者值。

  深链支持 `?theme=sakura&mode=light&accent=c8452f&base=0b1220`，便于分享与逐组合截图；旧的 `?theme=bloom|ember|mono` 会归并到同类保留主题，旧存档与旧设置文件同样兼容。
- `npm run themes:report` 可生成主题差异报告（颜色维度）。注意它**只能证明颜色不雷同，不能证明机制不同**——机制差异由上面的契约测试与截图验证，工具自身的注释里写明了这个能力边界。
- 独立运行日志页记录扫描、解析、播放、文件操作和异常，并支持筛选、诊断、导出与清空。

## 启动

文件夹读写依赖浏览器的 File System Access API，请使用较新的 Chrome 或 Edge，并通过 `localhost` 打开。

```powershell
node server.cjs
```

然后访问 `http://127.0.0.1:8000`。

首次点击“选择音乐文件夹”时，请授予读写权限。删除操作不会直接永久删除文件，而是将文件移动到音乐目录内的 `.Clair 回收站`。

## 手机通过 Samba 曲库访问

手机浏览器不能直接打开 `smb://`。Clair 的局域网模式由运行 Node.js 的电脑读取 Samba 映射目录，再向同一局域网内的手机提供只读曲库和支持 Range 的音频流。

1. 先在运行 Clair 的电脑上挂载共享目录，例如 `Z:\Music`；也可以直接使用 UNC 路径，例如 `\\NAS\Music`。
2. 启动局域网服务：

   ```powershell
   .\start-lan.cmd "Z:\Music"
   # 或
   .\start-lan.cmd "\\NAS\Music"
   ```

3. 运行 `ipconfig` 查看这台电脑的局域网 IPv4 地址，然后在手机浏览器打开 `http://电脑IP:8000`，例如 `http://192.168.1.20:8000`。
4. 页面会自动连接曲库；也可在“音乐库”页点击“局域网曲库”重新连接或刷新。

也可以使用 npm 启动：

```powershell
npm run start:lan -- "Z:\Music"
```

局域网模式默认只读，页面会隐藏重命名、回收站和 FLAC 标签写入。若音乐目录已有桌面端生成的 `.Clair/library.json`，手机端会复用其中的标题、艺术家和音频参数；没有索引时仍可按目录与文件名浏览播放。首次启动时请允许 Windows 防火墙在“专用网络”放行 Node.js/8000 端口。服务未提供账号认证，只应在可信局域网内使用，不要将端口转发到公网。

## 开发与测试

需要 Node.js 20 或更高版本（无第三方依赖，`npm ci` 仅用于安装空锁文件）。

```powershell
npm test                 # 用 node --test 运行 tests/ 下全部测试（库模型、FLAC 元数据、
                         # 自动补齐工具、版本一致性、服务器冒烟、局域网服务器）
npm run check:syntax     # 对仓库内全部 JS 文件做 node --check 语法检查
npm run check:static     # 校验 index.html 引用的静态资源均存在于两个服务器的白名单
npm run check:themes     # 校验主题清单、艺术方向和关键色彩对比度
npm start                # 等价于 node server.cjs
```

GitHub Actions 会在 push / pull request 时，于 Node 20 与 22、Ubuntu 与 Windows 上自动运行语法检查、静态契约检查、主题对比度检查和全部测试。`.cmd` 启动器是 Windows 便利脚本；命令行工具本身跨平台可用。

> Node 24 起测试运行器不再接受"目录"参数，`npm test`（`node --test tests/`）在 Node 24 上会报 `Cannot find module .../tests`。这是运行器行为变化，与代码无关；在本机可用
> `node --test "tests/*.test.cjs"` 等价地跑全部测试（CI 仍使用 Node 20 / 22 的目录形式）。

## 关于主题与首帧

页面在 JS 生效前用的是 `:root` 的回退调色板（等同默认主题「樱花 · 暗」），因此当系统偏好为亮色而保存的模式是"跟随系统"时，会在启动瞬间闪一帧暗色。这是 `index.html` 的 CSP（`script-src 'self'`，禁止内联引导脚本）换来的代价：不引入内联脚本，就无法在解析 CSS 之前读出 `prefers-color-scheme`。选定主题与明暗后刷新不再有闪烁。

## 本地数据

Clair 会在所选音乐目录内创建 `.Clair`：

- `clair.log`：本地运行日志，超过约 5 MB 后自动保留最近内容。
- `library.json`：可读的音乐库索引与收藏状态。
- `settings.json`：主题、明暗模式、自选配色、排序、组织方式和折叠状态。
- `metadata-backups/`：修改 FLAC 前保存的原始 Vorbis Comment。

浏览器仍会将已授权的目录句柄保存在 IndexedDB 中；实际日志、音乐库数据和设置以 `.Clair` 内的文件为准。

## 主要文件

- `index.html`：页面结构。
- `styles.css`：界面、主题和响应式布局。主题令牌分四层，改主题只需动令牌：
  - **L0 全局常量**（`--font-*`、`--sidebar-width`、`--transport-height`、`--dur-*`、`--ease*`）：与主题、明暗都无关，只允许声明在 `:root`。它们曾被误放进 `body[data-theme="aurora"]`，导致其余主题里 `var(--font-sans)` / `var(--transport-height)` / `var(--hairline)` 解析为空（字体回落、播放条行轨退化、边框消失），`tests/theme-contract.test.cjs` 现在有专门断言防它复发。
  - **L1 调色板**（`--bg`、`--surface*`、`--accent`…）：只回答"是什么颜色"，**按模式**声明在 `body[data-theme="X"][data-mode="light|dark"]`，同时是 `npm run check:themes` 校验对比度的对象。
  - **L2 材质**（`--panel-material`、`--card-material`、`--side-material`、`--bar-material`、`--sheen-material`、`--hi-edge`、`--hairline`）：把调色板解释成有光源、有厚度、有朝向的介质。组件背景一律读这里，不再各自拼 `color-mix()`。
  - **L3 形制**（`--mechanism`、`--panel-recipe`、`--shape-*`、`--layout-*`、`--sheen-*`）：机制配方、角语言、栏比与结构差异，按主题声明在 `body[data-theme="X"]`。

  关键约束：自定义属性在**声明它的元素**上完成 `var()` 替换。凡是引用了 L1 的令牌必须声明在 `body` 的主题块或模式块里；写进 `:root` 会被烘焙成回退主题的色值，主题改写将完全无效。组件里不再出现主题选择器，四套主题的艺术方向集中在 §15。
- `theme-model.js`：自选配色的派生与对比度兜底（`deriveBase` / `deriveAccent` / `deriveOverlayAccent` / `buildOverrides`）。它与 `tools/theme-contrast.cjs` 共用同一套 WCAG 数学与阈值，保证"静态校验通过的配色"与"用户随手挑的颜色"按同一把尺子衡量。
- `app.js`：播放、频谱、元数据解析、音乐库管理、主题 / 明暗 / 自定义配色和日志。
- `library-model.js`：稳定曲目标识、层级组织、排序和智能分类。
- `flac-metadata.js`：FLAC 元数据块读取、重建和校验。
- `server.cjs`：本地只读静态服务器。
- `tests/theme-contract.test.cjs`：主题清单、机制唯一性、明暗调色板块、optgroup 分类、共享全局令牌与配色控件契约。
- `tests/theme-model.test.cjs`：任意强调色 × 底色 × 明暗模式的对比度矩阵与派生结果结构。
- `tests/library-model.test.cjs`：音乐库组织、稳定标识和排序测试。
- `tests/flac-metadata.test.cjs`：FLAC 元数据无损重建测试。
- `tests/flac-auto-metadata.test.cjs`：自动补齐工具的推断规则与 DeepSeek 校验测试。

## 命令行工具

所有工具均支持 `--help`；预览类命令默认只读，只有显式参数（如 `--apply`）才会写文件。

- `tools/flac-auto-metadata.cjs`：接管新加入音乐库的 FLAC，保守补齐空标签（见下节）。
- `tools/metadata-audit.cjs`：扫描音乐库（FLAC/MP3），报告缺失标签、非 UTF-8 标签与疑似乱码，可输出 JSON 报告；`--fail-on-issues` 会在发现错误/非法编码/疑似乱码时以非零码退出（适合接入脚本或 CI）：
  ```powershell
  node tools/metadata-audit.cjs "Z:\wc-zh\Music" audit-report.json
  node tools/metadata-audit.cjs "Z:\wc-zh\Music" --fail-on-issues
  ```
- `tools/metadata-repair.cjs`：修复编码损坏（GB18030 与 Shift-JIS 标签均可自动识别恢复）、移除下载站广告标签、补充规范日期字段；也内置了针对本库的硬编码修复项（`MANUAL_FIXES`，路径与专辑信息固定，仅适用于匹配的目录，预览时即会提示）。`--apply` 写入时逐文件容错——单个文件失败会清理临时文件并继续处理其余文件，结束时汇总成功/失败数：
  ```powershell
  node tools/metadata-repair.cjs "Z:\wc-zh\Music"          # 仅预览
  node tools/metadata-repair.cjs "Z:\wc-zh\Music" --apply  # 写入并备份到 .Clair/metadata-repair-*
  ```
- `tools/extract-flac-cover.cjs`：提取 FLAC 内嵌封面图。
  ```powershell
  node tools/extract-flac-cover.cjs "file.flac" "cover.jpg"
  ```

## 自动处理新增 FLAC

`tools/flac-auto-metadata.cjs` 用于接管新加入音乐目录的 FLAC。它默认只显示将要补齐的字段；只有传入 `--apply` 时才会写入文件。

它遵循保守规则：保留已有标签、封面和音频数据，只从明确的文件/目录信息补齐空字段，例如曲名、音轨号、碟号、专辑名和位于目录名中的年份。对于 `vivaldi_the four seasons_sarah chang orpheus chamber orchestra_spring` 这样有下划线分隔、且以已知作曲家开头的古典目录名，它还会补齐作曲家、作品、演奏者和乐团；其他无法可靠判断的古典资料不会猜测。如需为一批导入文件提供确定值，可使用 `--set`。

```powershell
# 先预览，不修改文件
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music"

# 确认后写入；每次修改前会备份原始元数据区
node tools/flac-auto-metadata.cjs "Z:\wc-zh\Music" --apply

# 持续监听新加入或替换的 FLAC（按 Ctrl+C 停止）
# macOS/Windows 使用递归文件监听；Linux/WSL 上自动退化为约 2 秒轮询
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

默认使用 `deepseek-v4-flash`，仅接受置信度不低于 `0.92` 的建议；它只会补充缺失字段或替换“音轨01”这类占位标题，绝不覆盖已有的正常标签。若模型依据完整曲序推断乐章标题，提示词要求其置信度至少为 `0.97`，并要求在一次请求中返回整组曲目；罗马数字乐章号与文件序号冲突时，脚本会拒绝整组标题建议。每次模型建议都会记录到 `.Clair/deepseek-metadata-review.jsonl`，其中包含模型、置信度、依据、建议字段和实际接受字段。可通过 `--deepseek-model` 或 `--deepseek-confidence` 调整模型与阈值。请求带 30 秒超时与自动重试（429/5xx/网络错误，最多 2 次指数退避），不会让一次卡住的请求拖死整个扫描。
