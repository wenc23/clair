"use strict";

// 主题对比度校验：解析 styles.css 中每套主题的令牌，
// 按 WCAG 2.x 相对亮度公式校验关键对比度：
//   text  vs bg          ≥ 7.0（正文）
//   muted vs bg          ≥ 4.5（次级文本）
//   accent vs bg         ≥ 4.5（图标/导轨/按钮描边）
//   accent-bright/surface ≥ 4.5（高亮文本）
//   faint vs surface     ≥ 4.5（实际用于 8–10px 小标签）
// 同时校验 HTML / JS / CSS 的主题清单一致，以及艺术主题拥有专属构图与频谱模式。
// 用法：node tools/theme-contrast.cjs

const fs = require("fs");
const path = require("path");

const cssPath = path.resolve(__dirname, "..", "styles.css");
const css = fs.readFileSync(cssPath, "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

const REQUIRED = [
  "--bg", "--sidebar", "--surface", "--surface-2", "--surface-3",
  "--text", "--muted", "--faint", "--line", "--line-strong",
  "--accent", "--accent-bright", "--accent-soft", "--accent-deep",
  "--good", "--warn", "--danger", "--shadow", "--glow",
  "--viz-fill", "--viz-secondary", "--panel-highlight",
];

function parseHex(hex) {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  if (!rgb) return null;
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

function contrast(foreground, background) {
  const l1 = luminance(parseHex(foreground));
  const l2 = luminance(parseHex(background));
  if (l1 == null || l2 == null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseTheme(name, block) {
  const tokens = {};
  for (const line of block.split("\n")) {
    const hex = line.trim().match(/^--([\w-]+):\s*(#[0-9a-fA-F]{6});/);
    const rgba = line.trim().match(/^--([\w-]+):\s*(rgba?\([^;]+\));/);
    if (hex) tokens[`--${hex[1]}`] = hex[2].toLowerCase();
    else if (rgba) tokens[`--${rgba[1]}`] = rgba[2];
  }
  return tokens;
}

const themes = [{ name: "nocturne", block: css.slice(css.indexOf(":root {"), css.indexOf("body[data-theme=\"ivory\"]")) }];
for (const match of css.matchAll(/body\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\n\}/g)) {
  themes.push({ name: match[1], block: match[2] });
}

const CHECKS = [
  { name: "正文 text/bg", a: "--text", b: "--bg", min: 7.0 },
  { name: "次级 muted/bg", a: "--muted", b: "--bg", min: 4.5 },
  { name: "强调 accent/bg", a: "--accent", b: "--bg", min: 4.5 },
  { name: "次级 muted/surface", a: "--muted", b: "--surface", min: 4.5 },
  { name: "小标签 faint/surface", a: "--faint", b: "--surface", min: 4.5 },
  { name: "强调 accent/surface", a: "--accent", b: "--surface", min: 4.5 },
  { name: "高亮 accent-bright/surface", a: "--accent-bright", b: "--surface", min: 4.5 },
  { name: "危险 danger/surface", a: "--danger", b: "--surface", min: 4.5 },
];

let failures = 0;
for (const theme of themes) {
  const tokens = parseTheme(theme.name, theme.block);
  const missing = REQUIRED.filter((token) => !tokens[token]);
  if (missing.length) {
    console.log(`✗ ${theme.name}: 缺少令牌 ${missing.join(", ")}`);
    failures++;
    continue;
  }
  for (const check of CHECKS) {
    const ratio = contrast(tokens[check.a], tokens[check.b]);
    if (ratio == null) {
      console.log(`✗ ${theme.name} · ${check.name}: 无法解析颜色`);
      failures++;
    } else if (ratio < check.min) {
      console.log(
        `✗ ${theme.name} · ${check.name}: ${ratio.toFixed(2)}:1 < ${check.min}:1 ` +
        `(${tokens[check.a]} on ${tokens[check.b]})`
      );
      failures++;
    }
  }
}

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const cssThemeNames = themes.map((theme) => theme.name);
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
  if (!sameList(cssThemeNames, names)) {
    console.log(`✗ ${surface} 主题清单与 CSS 不一致: ${names.join(", ") || "未解析"}`);
    failures++;
  }
}

const defaultMeta = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/);
const defaultBg = parseTheme("nocturne", themes[0].block)["--bg"];
if (!defaultMeta || defaultMeta[1].toLowerCase() !== defaultBg) {
  console.log(`✗ 默认 theme-color 与 nocturne --bg 不一致: ${defaultMeta?.[1] || "未解析"} / ${defaultBg}`);
  failures++;
}

const ART_DIRECTIONS = {
  ocean: "hydrophone",
  sakura: "sakura",
  forest: "contour",
  violet: "stellar",
};
for (const [theme, visualizer] of Object.entries(ART_DIRECTIONS)) {
  for (const selector of [".nav-button.is-active", ".art-panel", ".transport"]) {
    if (!css.includes(`body[data-theme=${theme}] ${selector}`)) {
      console.log(`✗ ${theme}: 缺少专属构图 ${selector}`);
      failures++;
    }
  }
  const visualizerPattern = new RegExp(`${theme}:\\s*\\{[^}]*visualizer:\\s*"${visualizer}"`);
  if (!visualizerPattern.test(app)) {
    console.log(`✗ ${theme}: 缺少专属频谱模式 ${visualizer}`);
    failures++;
  }
}

const summary = themes.map((theme) => {
  const tokens = parseTheme(theme.name, theme.block);
  return `${theme.name}(${tokens["--accent"]})`;
});
console.log(`\n主题: ${summary.join("  ")}`);
console.log(failures ? `共 ${failures} 处未达标` : "全部主题通过 WCAG 对比度校验 ✓");
process.exitCode = failures ? 1 : 0;
