"use strict";

// 回归测试：主题契约。
//
// 背景：曾经出现过一次严重回归 —— app.js 的主题兜底值写死成 "nocturne"，
// 而该主题在换阵容时已被删除。于是 THEME_DETAILS["nocturne"] 为 undefined，
// 启动流程读 .visualizer 抛错、整个初始化中断，表现为"主题切不了、UI 点不动"。
// 当时 tools/theme-contrast.cjs 只校验了 CSS 与主题清单是否一致，
// 没有校验"应用能不能正常初始化"，所以全部检查都是绿的。
//
// 本测试补上这一环：静态校验主题清单、兜底值、详情表、HTML 下拉、
// 明暗模式块、optgroup 分类、配色控件、theme-color 与 CSS 是否互相自洽。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const THEME_MODEL = require("../theme-model.js");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

/* ---------- 1. 主题清单 ---------- */
const themesMatch = appJs.match(/const THEMES = (\[[^\]]*\]);/);
assert.ok(themesMatch, "app.js 中应存在 THEMES 数组");
const THEMES = JSON.parse(themesMatch[1]);
assert.ok(THEMES.length > 0, "THEMES 不能为空");

/* ---------- 2. THEME_DETAILS 必须覆盖每一个主题 ---------- */
// 这是上次崩掉的直接原因：清单里有主题，详情表里没有。
for (const theme of THEMES) {
  const detail = new RegExp(`\\b${theme}:\\s*\\{`).test(appJs);
  assert.ok(detail, `THEME_DETAILS 缺少主题 "${theme}" 的条目（启动时会抛错）`);
}

/* ---------- 3. 兜底值必须是清单内的真实成员 ---------- */
// 抓 "写死某个主题名，后来该主题被删掉" 这类回归。
// 取三元的最后一段（最后一个 ':' 到 ';' 之间）来判断，避免误伤解释性注释。
const declMatch = appJs.match(/const initialTheme = ([\s\S]*?);\r?\n/);
assert.ok(declMatch, "app.js 中应存在 initialTheme 声明");
const expr = declMatch[1];
const lastBranch = expr.slice(expr.lastIndexOf(":") + 1).trim();
assert.ok(
  /^THEMES\[\d+\]$/.test(lastBranch),
  `initialTheme 的兜底分支应写成 THEMES[n]，实际是：${lastBranch}`
);
const fallbackIndex = Number(lastBranch.match(/\d+/)[0]);
assert.ok(
  fallbackIndex >= 0 && fallbackIndex < THEMES.length,
  `兜底下标 ${fallbackIndex} 超出 THEMES 范围（0..${THEMES.length - 1}）`
);
// 表达式里出现的任何主题名字面量都必须是真实成员或旧名别名，
// 否则就是"写死了一个可能被删掉的名字"。（先剥掉行注释，避免误伤说明文字。）
const exprCode = expr.replace(/\/\/[^\n]*/g, "");
const aliasSrc = appJs.slice(
  appJs.indexOf("const LEGACY_THEME_ALIASES"),
  appJs.indexOf("const MODE_CHOICES")
);
const LEGACY_ALIASES = [...aliasSrc.matchAll(/(\w+):\s*"([^"]+)"/g)].map((match) => match[1]);
for (const quoted of exprCode.matchAll(/"([^"]+)"/g)) {
  assert.ok(
    THEMES.includes(quoted[1]) || LEGACY_ALIASES.includes(quoted[1]),
    `initialTheme 里出现了未知主题名 "${quoted[1]}"`
  );
}
// 别名表的取值必须是真实主题，否则旧存档会落到不存在的主题上
for (const match of aliasSrc.matchAll(/\w+:\s*"([^"]+)"/g)) {
  assert.ok(THEMES.includes(match[1]), `LEGACY_THEME_ALIASES 指向了不存在的主题 "${match[1]}"`);
}

/* ---------- 4. 每个主题都有频谱画法，且画法在渲染分支里真的存在 ---------- */
const KNOWN_VISUALIZERS = new Set([
  "bars",
  "aura",
  "hydrophone",
  "sakura",
  "contour",
  "stellar",
  "metal",
  "heat",
]);
for (const theme of THEMES) {
  const m = appJs.match(new RegExp(`\\b${theme}:\\s*\\{[^}]*visualizer:\\s*"([^"]+)"`));
  assert.ok(m, `主题 "${theme}" 应声明 visualizer`);
  assert.ok(
    KNOWN_VISUALIZERS.has(m[1]),
    `主题 "${theme}" 的 visualizer "${m[1]}" 未在绘制分支中实现`
  );
}
// 详情表里声明的画法都必须在渲染分支里出现
for (const mode of KNOWN_VISUALIZERS) {
  if (mode === "bars") continue; // bars 是兜底分支
  assert.ok(
    appJs.includes(`mode === "${mode}"`),
    `频谱画法 "${mode}" 在 drawVisualizer 的渲染分支中不存在`
  );
}

/* ---------- 4b. 不同质化：每套主题必须声明唯一的 --mechanism ---------- */
const MECHANISM_ALLOWED = new Set(["washi", "bands", "metal", "caustics"]);
const themeBlock = (theme) => {
  const marker = `body[data-theme="${theme}"] {`;
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `styles.css 缺少主题 "${theme}" 的令牌块`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
};
const mechanisms = [];
for (const theme of THEMES) {
  const block = themeBlock(theme);
  const mech = block.match(/--mechanism:\s*([a-z]+);/);
  assert.ok(mech, `主题 "${theme}" 必须声明 --mechanism`);
  assert.ok(
    MECHANISM_ALLOWED.has(mech[1]),
    `主题 "${theme}" 的机制 "${mech[1]}" 不在允许清单内`
  );
  mechanisms.push(mech[1]);
}
assert.equal(
  new Set(mechanisms).size,
  mechanisms.length,
  `主题机制必须互不相同，实际为：${mechanisms.join(", ")}`
);

/* ---------- 4c. 每套主题必须有自己独有的面板配方 ---------- */
const recipes = [];
for (const theme of THEMES) {
  const recipe = themeBlock(theme).match(/--panel-recipe:([\s\S]*?);\n/);
  assert.ok(recipe, `主题 "${theme}" 必须声明 --panel-recipe`);
  recipes.push(recipe[1].replace(/\s+/g, " ").trim());
}
assert.equal(
  new Set(recipes).size,
  recipes.length,
  "每套主题的 --panel-recipe 必须互不相同（否则就是同质化）"
);

/* ---------- 4d. 渐变文字不得扩散 ---------- */
const clipTextCount = (css.match(/background-clip: text;/g) || []).length;
assert.ok(
  clipTextCount <= 16,
  `background-clip: text 数量增至 ${clipTextCount}，超出上限 16（渐变字不应继续扩散）`
);

/* ---------- 4e. 每个主题都必须有明 / 暗两个调色板块 ---------- */
// 调色板按模式拆分后，"主题块只有一份颜色"就是漏掉一半模式。
const PALETTE_PALETTE = [
  "--bg", "--sidebar", "--surface", "--surface-2", "--surface-3",
  "--text", "--muted", "--faint", "--line", "--line-strong",
  "--accent", "--accent-bright", "--accent-soft", "--accent-deep",
  "--good", "--warn", "--danger", "--shadow", "--glow",
  "--viz-fill", "--viz-secondary", "--panel-highlight",
];
const paletteTokens = [];
for (const theme of THEMES) {
  for (const mode of THEME_MODEL.MODES) {
    const marker = `body[data-theme="${theme}"][data-mode="${mode}"] {`;
    const start = css.indexOf(marker);
    assert.ok(start >= 0, `styles.css 缺少调色板块 ${marker}`);
    const end = css.indexOf("\n}", start);
    const block = css.slice(start, end);
    for (const token of PALETTE_PALETTE) {
      assert.ok(
        new RegExp(`^\\s*${token}:`, "m").test(block),
        `${theme} · ${mode} 缺少令牌 ${token}`
      );
      paletteTokens.push(token);
    }
    assert.ok(/color-scheme:\s*(light|dark);/.test(block), `${theme} · ${mode} 必须声明 color-scheme`);
  }
}
// 两种模式的 color-scheme 必须真的不同，否则表单控件不会跟着换色
for (const theme of THEMES) {
  const read = (mode) => {
    const start = css.indexOf(`body[data-theme="${theme}"][data-mode="${mode}"] {`);
    return css.slice(start, css.indexOf("\n}", start)).match(/color-scheme:\s*(\w+);/)[1];
  };
  assert.notEqual(read("light"), read("dark"), `${theme}: 明暗两态的 color-scheme 不应相同`);
}

/* ---------- 4f. 运行时兜底的阈值必须与 CSS 令牌对得上 ---------- */
// theme-model 的 CONTRAST_RULES 使用短名；这里确认每个短名都有对应的 CSS 令牌，
// 否则"工具校验的主题"和"用户自选配色校验的令牌"会悄悄分叉。
const CONTRAST_TOKENS = {
  text: "--text",
  bg: "--bg",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  accentBright: "--accent-bright",
  danger: "--danger",
  surface: "--surface",
};
for (const rule of THEME_MODEL.CONTRAST_RULES) {
  for (const key of [rule.a, rule.b]) {
    assert.ok(CONTRAST_TOKENS[key], `CONTRAST_RULES 用了未映射的短名 "${key}"`);
    assert.ok(
      PALETTE_PALETTE.includes(CONTRAST_TOKENS[key]),
      `CONTRAST_RULES 引用了不在 L1 清单里的令牌 ${CONTRAST_TOKENS[key]}`
    );
  }
}

/* ---------- 5. HTML 下拉与主题清单逐项一致 ---------- */
const selectMatch = html.match(/<select id="theme-select">([\s\S]*?)<\/select>/);
assert.ok(selectMatch, "index.html 应存在 #theme-select");
const htmlThemes = [...selectMatch[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(htmlThemes, THEMES, "index.html 的主题下拉必须与 app.js 的 THEMES 完全一致");

/* ---------- 5b. optgroup 分类必须与 app.js 的 THEME_GROUPS 一致 ---------- */
const groupsStart = appJs.indexOf("const THEME_GROUPS");
const groupsEnd = appJs.indexOf("]);", groupsStart);
const groupsSrc = appJs.slice(groupsStart, groupsEnd);
const appGroups = [...groupsSrc.matchAll(/label:\s*"([^"]+)",\s*themes:\s*Object\.freeze\(\[([^\]]*)\]\)/g)]
  .map((match) => ({
    label: match[1],
    themes: [...match[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]),
  }));
assert.ok(appGroups.length > 0, "app.js 中应存在 THEME_GROUPS 分类");
const htmlGroups = [...selectMatch[1].matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)]
  .map((match) => ({
    label: match[1],
    themes: [...match[2].matchAll(/<option value="([^"]+)"/g)].map((item) => item[1]),
  }));
assert.deepEqual(htmlGroups, appGroups, "index.html 的 optgroup 分类必须与 THEME_GROUPS 完全一致");
assert.deepEqual(
  htmlGroups.flatMap((group) => group.themes),
  THEMES,
  "optgroup 必须不重不漏地覆盖全部主题，且顺序一致"
);

/* ---------- 6. CSS 必须为**每一套**主题定义令牌块 ---------- */
for (const theme of THEMES) {
  assert.ok(
    css.includes(`body[data-theme="${theme}"] {`),
    `styles.css 缺少主题 "${theme}" 的令牌块`
  );
}
// :root 必须提供一份完整的默认调色板，否则 JS 生效前页面无样式
const rootStart = css.indexOf(":root {");
const rootEnd = css.indexOf("\n}", rootStart);
const rootBody = css.slice(rootStart, rootEnd);
for (const token of ["--bg", "--text", "--surface", "--accent", "--line"]) {
  assert.ok(
    new RegExp(`^\\s*${token}:`, "m").test(rootBody),
    `:root 缺少 ${token}，JS 生效前会出现无样式闪烁`
  );
}

/* ---------- 6b. 共享全局令牌必须留在 :root ----------
   它们曾经被误放进 body[data-theme="aurora"]，导致其余主题里
   var(--font-sans) / var(--transport-height) / var(--hairline) 解析为空：
   字体回落到浏览器默认、播放条行轨退化成 none、面板边框直接消失。
   这条断言就是防它复发。 */
const SHARED_GLOBALS = [
  "--font-sans", "--font-serif", "--font-mono",
  "--sidebar-width", "--transport-height",
  "--dur-fast", "--dur-base", "--dur-slow",
  "--ease", "--ease-out", "--ease-spring",
];
for (const token of SHARED_GLOBALS) {
  assert.ok(
    new RegExp(`^\\s*${token}:`, "m").test(rootBody),
    `:root 缺少共享全局令牌 ${token}（主题块里声明会让其余主题解析为空）`
  );
}

/* ---------- 7. theme-color 必须等于 :root 的 --bg ---------- */
const metaMatch = html.match(/<meta name="theme-color" content="([^"]+)"/);
assert.ok(metaMatch, "index.html 应存在 theme-color meta");
const bgMatch = rootBody.match(/^\s*--bg:\s*(#[0-9a-fA-F]{6});/m);
assert.ok(bgMatch, ":root 中应存在 --bg");
assert.equal(
  metaMatch[1].toLowerCase(),
  bgMatch[1].toLowerCase(),
  `theme-color (${metaMatch[1]}) 必须与默认主题 ${THEMES[0]} 的 --bg (${bgMatch[1]}) 一致`
);

/* ---------- 8. 启动路径上最容易崩的一步 ---------- */
const primaryTheme = THEMES[0];
assert.ok(
  new RegExp(`\\b${primaryTheme}:\\s*\\{`).test(appJs),
  `默认主题 "${primaryTheme}" 必须在 THEME_DETAILS 中可解析，否则启动即抛错`
);

/* ---------- 9. 明暗与配色的控件必须齐全 ---------- */
for (const id of [
  "theme-select",
  "theme-description",
  "accent-color",
  "accent-hex",
  "accent-reset",
  "base-color",
  "base-hex",
  "base-reset",
  "color-hint",
]) {
  assert.ok(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
}
for (const choice of THEME_MODEL.MODE_CHOICES) {
  assert.ok(
    html.includes(`data-mode-choice="${choice}"`),
    `index.html 缺少 "${choice}" 明暗模式按钮`
  );
}
for (const preset of THEME_MODEL.ACCENT_PRESETS) {
  assert.ok(
    html.includes(`data-accent-preset="${preset.value}"`),
    `index.html 缺少强调色预设 ${preset.name}(${preset.value})`
  );
}
for (const preset of THEME_MODEL.BASE_PRESETS) {
  assert.ok(
    html.includes(`data-base-preset="${preset.value}"`),
    `index.html 缺少底色预设 ${preset.name}(${preset.value})`
  );
}
// 主题/模式/配色都必须被持久化，否则刷新即丢
for (const key of ["clair-theme", "clair-theme-mode", "clair-accent", "clair-base"]) {
  assert.ok(appJs.includes(`"${key}"`), `app.js 未引用存储键 ${key}`);
}
// 跟随系统需要监听系统主题变化
assert.ok(
  appJs.includes("prefers-color-scheme"),
  "app.js 应读取 prefers-color-scheme（明暗默认跟随系统）"
);
// theme-model.js 必须被页面与两个服务器同时认识
for (const [name, source] of [
  ["index.html", html],
  ["server.cjs", fs.readFileSync(path.join(root, "server.cjs"), "utf8")],
  ["lan-server.cjs", fs.readFileSync(path.join(root, "lan-server.cjs"), "utf8")],
]) {
  assert.ok(source.includes("theme-model.js"), `${name} 未引用 theme-model.js`);
}

console.log(`Theme contract passed: ${THEMES.join(", ")} × ${THEME_MODEL.MODES.join("/")}`);
