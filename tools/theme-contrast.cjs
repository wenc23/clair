"use strict";

// 主题对比度校验。
//
// 结构：
//   L0 全局常量（:root）—— 与主题、明暗无关，必须只声明一次
//   L1 调色板 —— 按主题 × 模式声明：body[data-theme="X"][data-mode="light|dark"]
//   L2/L3 机制与形制 —— 按主题声明：body[data-theme="X"]
//
// 校验项：
//   1. 每个主题 × 模式都有完整 L1 令牌，且关键对比度达标（阈值与
//      theme-model.js 的 CONTRAST_RULES 同源，避免工具与运行时打架）；
//   2. CSS / index.html / app.js 三处主题清单一致，optgroup 分类一致；
//   3. 每个主题有唯一的 --mechanism 与唯一的 --panel-recipe；
//   4. theme-color 与 :root 的 --bg 一致（JS 生效前的首帧底色）。
//
// 用法：node tools/theme-contrast.cjs

const fs = require("fs");
const path = require("path");
const model = require("../theme-model.js");

const cssPath = path.resolve(__dirname, "..", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

// L1 调色板必须齐全的令牌。与 theme-model 的 CONTRAST_RULES 配合：
// 前者保证"都在"，后者保证"都可读"。
const REQUIRED = [
  "--bg", "--sidebar", "--surface", "--surface-2", "--surface-3",
  "--text", "--muted", "--faint", "--line", "--line-strong",
  "--accent", "--accent-bright", "--accent-soft", "--accent-deep",
  "--good", "--warn", "--danger", "--shadow", "--glow",
  "--viz-fill", "--viz-secondary", "--panel-highlight",
];

// 一段：把 WCAG 数学和阈值都交给 theme-model，工具只负责"取样与报错"。
function contrast(foreground, background) {
  return model.contrast(foreground, background);
}

function parseTheme(block) {
  const tokens = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    const hex = trimmed.match(/^--([\w-]+):\s*(#[0-9a-fA-F]{6});/);
    if (hex) {
      tokens[`--${hex[1]}`] = hex[2].toLowerCase();
      continue;
    }
    // 允许 rgba() / color-mix(...) 这类函数值：函数内部可能还有嵌套括号，
    // 所以匹配到行尾的分号，而不是第一个 ')'。对比度只用到纯色令牌，
    // 这些派生令牌只需要"存在"即可。
    const fn = trimmed.match(/^--([\w-]+):\s*((?:rgba?|color-mix|hsl|oklch|lab|color)\([^;]+\));/);
    if (fn) tokens[`--${fn[1]}`] = fn[2];
  }
  return tokens;
}

// 按大括号配对取块，避免非贪婪正则在"同选择器的短规则"上误命中。
function collectBlocks(source, pattern) {
  const found = new Map();
  const re = new RegExp(pattern.source, "g");
  let match;
  while ((match = re.exec(source)) !== null) {
    const key = match.slice(1).join("\u241f");
    let depth = 0;
    let index = source.indexOf("{", match.index);
    const start = index;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    const body = source.slice(start + 1, index);
    const previous = found.get(key);
    if (!previous || body.length > previous.length) found.set(key, body);
  }
  return found;
}

const themeBlocks = collectBlocks(css, /body\[data-theme="([^"]+)"\]\s*\{/g);
const paletteBlocks = collectBlocks(css, /body\[data-theme="([^"]+)"\]\[data-mode="([^"]+)"\]\s*\{/g);

const themes = [...themeBlocks.keys()];
const paletteKeys = [...paletteBlocks.keys()];

let failures = 0;
const report = (message) => {
  console.log(`✗ ${message}`);
  failures += 1;
};

/* ---------- 1. 每个主题 × 模式：令牌齐全 + 对比度达标 ---------- */

const CHECKS = model.CONTRAST_RULES.map((rule) => ({
  name: rule.label,
  a: `--${rule.a.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
  b: `--${rule.b}`,
  min: rule.min,
}));

for (const theme of themes) {
  for (const mode of model.MODES) {
    const key = `${theme}\u241f${mode}`;
    const block = paletteBlocks.get(key);
    if (!block) {
      report(`${theme} · ${mode}: 缺少 body[data-theme="${theme}"][data-mode="${mode}"] 令牌块`);
      continue;
    }
    const tokens = parseTheme(block);
    const missing = REQUIRED.filter((token) => !tokens[token]);
    if (missing.length) {
      report(`${theme} · ${mode}: 缺少令牌 ${missing.join(", ")}`);
      continue;
    }
    for (const check of CHECKS) {
      const ratio = contrast(tokens[check.a], tokens[check.b]);
      if (ratio == null) {
        report(`${theme} · ${mode} · ${check.name}: 无法解析颜色`);
      } else if (ratio < check.min) {
        report(
          `${theme} · ${mode} · ${check.name}: ${ratio.toFixed(2)}:1 < ${check.min}:1 ` +
          `(${tokens[check.a]} on ${tokens[check.b]})`
        );
      }
    }
  }
}

// 模式块必须是这两个，且不能出现"只剩一个模式"的主题
for (const key of paletteKeys) {
  const [theme, mode] = key.split("\u241f");
  if (!themeBlocks.has(theme)) report(`模式块 ${theme} · ${mode} 没有对应的主题块`);
  if (!model.MODES.includes(mode)) report(`${theme}: 未知模式 "${mode}"（只允许 light / dark）`);
}

/* ---------- 2. 机制与配方：每个主题唯一 ---------- */

const mechanismAllowlist = new Set(["washi", "bands", "metal", "caustics"]);
const mechanisms = [];
const recipes = [];
for (const [theme, block] of themeBlocks) {
  const mechanism = block.match(/--mechanism:\s*([a-z]+);/);
  if (!mechanism) {
    report(`${theme}: 主题块必须声明 --mechanism`);
  } else if (!mechanismAllowlist.has(mechanism[1])) {
    report(`${theme}: 机制 "${mechanism[1]}" 不在允许清单内`);
  } else {
    mechanisms.push(mechanism[1]);
  }
  const recipe = block.match(/--panel-recipe:([\s\S]*?);\n/);
  if (!recipe) report(`${theme}: 主题块必须声明 --panel-recipe`);
  else recipes.push(recipe[1].replace(/\s+/g, " ").trim());
}
if (new Set(mechanisms).size !== mechanisms.length) {
  report(`主题机制必须互不相同，实际为：${mechanisms.join(", ")}`);
}
if (new Set(recipes).size !== recipes.length) {
  report("每套主题的 --panel-recipe 必须互不相同（否则就是同质化）");
}

/* ---------- 3. 三处主题清单一致 ---------- */

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const themeSelect = html.match(/<select id="theme-select">([\s\S]*?)<\/select>/);
const htmlThemeNames = themeSelect
  ? [...themeSelect[1].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])
  : [];
const appThemesMatch = app.match(/const THEMES = (\[[^;]+\]);/);
let appThemeNames = [];
try {
  appThemeNames = appThemesMatch ? JSON.parse(appThemesMatch[1]) : [];
} catch {
  appThemeNames = [];
}

for (const [surface, names] of [["HTML", htmlThemeNames], ["app.js", appThemeNames]]) {
  if (!sameList(themes, names)) {
    report(`${surface} 主题清单与 CSS 不一致: ${names.join(", ") || "未解析"}`);
  }
}

/* ---------- 4. optgroup 分类必须与 app.js 的 THEME_GROUPS 一致 ---------- */

function parseHtmlGroups() {
  if (!themeSelect) return [];
  const groups = [];
  for (const group of themeSelect[1].matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)) {
    groups.push({
      label: group[1],
      themes: [...group[2].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]),
    });
  }
  return groups;
}

function parseAppGroups() {
  const match = app.match(/const THEME_GROUPS = [\s\S]*?\n  \]\);/);
  if (!match) return [];
  const groups = [];
  for (const group of match[0].matchAll(/label:\s*"([^"]+)",\s*themes:\s*Object\.freeze\(\[([^\]]*)\]\)/g)) {
    groups.push({
      label: group[1],
      themes: [...group[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]),
    });
  }
  return groups;
}

const htmlGroups = parseHtmlGroups();
const appGroups = parseAppGroups();
if (!appGroups.length) report("app.js 中未能解析 THEME_GROUPS");
else if (!htmlGroups.length) report("index.html 中未能解析 optgroup 分类");
else if (JSON.stringify(htmlGroups) !== JSON.stringify(appGroups)) {
  report(`主题分类不一致：HTML=${JSON.stringify(htmlGroups)} / app.js=${JSON.stringify(appGroups)}`);
}
const groupedThemes = htmlGroups.flatMap((group) => group.themes);
if (groupedThemes.length && !sameList(groupedThemes, themes)) {
  report(`optgroup 覆盖的主题与 CSS 不一致: ${groupedThemes.join(", ")}`);
}

/* ---------- 5. 共享全局令牌必须在 :root ---------- */

const rootStart = css.indexOf(":root {");
const rootEnd = rootStart < 0 ? -1 : css.indexOf("\n}", rootStart);
if (rootStart < 0 || rootEnd < 0) {
  report("未能在 styles.css 中定位 :root 令牌块");
}
const rootBlock = rootStart < 0 ? "" : css.slice(rootStart, rootEnd);
// 这些令牌一旦只声明在某套主题块里，其余主题的 var() 就会解析为空
// （字体回落、行轨退化、边框消失）。必须留在 :root。
const GLOBAL_TOKENS = [
  "--font-sans", "--font-serif", "--font-mono",
  "--sidebar-width", "--transport-height",
  "--dur-fast", "--dur-base", "--dur-slow",
  "--ease", "--ease-out", "--ease-spring",
];
for (const token of GLOBAL_TOKENS) {
  if (!new RegExp(`^\\s*${token}:`, "m").test(rootBlock)) {
    report(`:root 缺少共享全局令牌 ${token}`);
  }
}

// theme-color 是"JS 生效前浏览器着色"用的，因此必须等于 :root 的 --bg
//（:root 是页面在任何 data-theme 生效前的底色）。
const defaultMeta = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/);
const rootBg = parseTheme(rootBlock)["--bg"];
if (!defaultMeta || defaultMeta[1].toLowerCase() !== rootBg) {
  report(`theme-color 与 :root --bg 不一致: ${defaultMeta?.[1] || "未解析"} / ${rootBg}`);
}

/* ---------- 6. 艺术方向：专属构图 + 专属频谱 ---------- */

const ART_DIRECTIONS = {
  aurora: "aura",
  chrome: "metal",
  tide: "hydrophone",
};
for (const [theme, visualizer] of Object.entries(ART_DIRECTIONS)) {
  for (const selector of [".nav-button.is-active", ".art-panel", ".transport"]) {
    if (!css.includes(`body[data-theme="${theme}"] ${selector}`)) {
      report(`${theme}: 缺少专属构图 ${selector}`);
    }
  }
  const visualizerPattern = new RegExp(`${theme}:\\s*\\{[^}]*visualizer:\\s*"${visualizer}"`);
  if (!visualizerPattern.test(app)) report(`${theme}: 缺少专属频谱模式 ${visualizer}`);
}

const summary = themes.map((theme) => {
  const dark = parseTheme(paletteBlocks.get(`${theme}\u241fdark`) || "")["--accent"];
  const light = parseTheme(paletteBlocks.get(`${theme}\u241flight`) || "")["--accent"];
  return `${theme}(暗 ${dark} / 明 ${light})`;
});
console.log(`\n主题: ${summary.join("  ")}`);
console.log(`${themes.length} 套主题 × ${model.MODES.length} 种模式 = ${paletteBlocks.size} 个调色板块`);
console.log(failures ? `共 ${failures} 处未达标` : "全部主题通过 WCAG 对比度校验 ✓");
process.exitCode = failures ? 1 : 0;
