"use strict";

// 回归测试：自定义配色的派生与对比度兜底。
//
// 这是「用户自选强调色 / 底色」的安全网：CSS 里的 8 个默认组合由
// tools/theme-contrast.cjs 静态校验，而任意用户输入只能靠这里的
// theme-model 保证可读。任何一条 CONTRAST_RULES 不达标都算失败。

const assert = require("node:assert/strict");
const model = require("../theme-model.js");

/* ---------- 1. hex 归一与解析 ---------- */
assert.equal(model.normalizeHex("#AABBCC"), "#aabbcc", "大小写应归一");
assert.equal(model.normalizeHex("aabbcc"), "#aabbcc", "应接受裸 6 位");
assert.equal(model.normalizeHex("#abc"), "#aabbcc", "应展开 3 位简写");
assert.equal(model.normalizeHex("  #abc  "), "#aabbcc", "应容忍首尾空白");
for (const bad of ["", "#", "#12345", "#gggggg", "#1234567", "red", null, undefined, 42, {}]) {
  assert.equal(model.normalizeHex(bad), null, `非法输入应返回 null：${JSON.stringify(bad)}`);
}

/* ---------- 2. WCAG 数学与参考值一致 ---------- */
const blackWhite = model.contrast("#000000", "#ffffff");
assert.ok(Math.abs(blackWhite - 21) < 0.01, `黑白对应当接近 21:1，实际 ${blackWhite}`);
assert.equal(model.contrast("#ffffff", "#ffffff"), 1, "同色对比度应为 1");
assert.equal(model.contrast("nope", "#ffffff"), null, "无法解析时应返回 null");

/* ---------- 3. ensureContrast 真的收敛到阈值之上 ---------- */
const hardCases = [
  ["#eeeeee", "#f5f5f5", 7.0, "darker"],
  ["#111111", "#0d0d0d", 7.0, "lighter"],
  ["#808080", "#808080", 4.5, "darker"],
  ["#ffff00", "#ffffff", 4.5, "darker"],
  ["#0000ff", "#000000", 4.5, "lighter"],
];
for (const [color, background, min, prefer] of hardCases) {
  const fixed = model.ensureContrast(color, background, min, prefer);
  const ratio = model.contrast(fixed, background);
  assert.ok(ratio != null && ratio >= min, `${color} on ${background} 修正后仍不达标：${ratio}`);
}
assert.equal(model.ensureContrast("bogus", "#ffffff", 4.5, "darker"), null, "非法输入不应抛错");

/* ---------- 4. 任意底色 × 明暗两态都满足全部规则 ---------- */
const BASES = ["#150f1a", "#ffffff", "#000000", "#0b1220", "#00ff00", "#f2ece0", "#ff0000", "#3f66d4"];
const ACCENTS = ["#d6708c", "#000000", "#ffffff", "#0f9a90", "#b4761a", "#7b53c9"];
let paletteChecks = 0;
for (const base of BASES) {
  for (const mode of model.MODES) {
    const palette = model.deriveBase(base, { mode });
    assert.ok(palette, `deriveBase 应能解析 ${base}`);
    for (const accent of ACCENTS) {
      const derived = model.deriveAccent(accent, { bg: palette.bg, surface: palette.surface, mode });
      assert.ok(derived, `deriveAccent 应能解析 ${accent}`);
      const merged = Object.assign({}, palette, {
        accent: derived.accent,
        accentBright: derived.accentBright,
      });
      const failures = model.auditPalette(merged);
      paletteChecks += 1;
      assert.deepEqual(
        failures,
        [],
        `底色 ${base} · ${mode} · 强调色 ${accent} 未达标：${JSON.stringify(failures)}`
      );
    }
  }
}
assert.ok(paletteChecks >= BASES.length * model.MODES.length * ACCENTS.length, "矩阵测试应覆盖全部组合");

/* ---------- 5. 派生结果结构完整 ---------- */
const sample = model.deriveBase("#0b1220", { mode: "dark" });
for (const key of Object.keys(model.PALETTE_TOKENS)) {
  assert.ok(sample[key], `deriveBase 缺少令牌 ${key}`);
}
const accentSample = model.deriveAccent("#3f66d4", { bg: sample.bg, surface: sample.surface, mode: "dark" });
for (const key of ["accent", "accentBright", "accentDeep"]) {
  assert.ok(model.normalizeHex(accentSample[key]), `deriveAccent 缺少 ${key}`);
}

/* ---------- 6. buildOverrides：只覆盖用户真正改过的令牌 ---------- */
const basePalette = model.deriveBase("#0b1220", { mode: "dark" });
const accentOnly = model.buildOverrides({
  accent: "#0f9a90",
  base: null,
  mode: "dark",
  current: { bg: basePalette.bg, surface: basePalette.surface },
});
assert.deepEqual(accentOnly.warnings, [], "合法输入不应产生 warning");
assert.ok(accentOnly.tokens["--accent"], "应写强调色");
assert.ok(accentOnly.tokens["--accent-bright"], "应写高亮色");
assert.ok(accentOnly.tokens["--grad-1"] && accentOnly.tokens["--grad-3"], "渐变停靠色应跟随强调色");
assert.equal(accentOnly.tokens["--bg"], undefined, "只改强调色时不得覆盖底色");
assert.equal(accentOnly.tokens["--surface"], undefined, "只改强调色时不得覆盖面板色");

const baseOnly = model.buildOverrides({ accent: null, base: "#0c1a16", mode: "light", current: {} });
assert.deepEqual(baseOnly.warnings, [], "只改底色不应产生 warning");
assert.ok(baseOnly.tokens["--bg"] && baseOnly.tokens["--surface-2"], "应写底色阶梯");
assert.equal(baseOnly.tokens["--accent"], undefined, "只改底色时不得覆盖强调色");

const both = model.buildOverrides({
  accent: "#c8452f",
  base: "#0c1a16",
  mode: "dark",
  current: {},
});
assert.ok(both.tokens["--accent"] && both.tokens["--bg"], "两者同时自定义时应同时生效");
const bothFailures = model.auditPalette(Object.assign({}, both.palette, {
  text: both.palette.text,
  muted: both.palette.muted,
  faint: both.palette.faint,
  danger: both.palette.danger,
}));
assert.deepEqual(bothFailures, [], `同时自定义后应仍可读：${JSON.stringify(bothFailures)}`);

const invalid = model.buildOverrides({ accent: "not-a-color", base: "also-bad", mode: "dark", current: {} });
assert.equal(Object.keys(invalid.tokens).length, 0, "非法输入不得写入任何令牌");
assert.equal(invalid.warnings.length, 2, "非法输入应回报两个 warning（强调色 + 底色）");
for (const warning of invalid.warnings) {
  assert.ok(warning.code && warning.message, "warning 应带 code 与 message");
}

// current 缺失时不能崩，也不能瞎写强调色
const noBasis = model.buildOverrides({ accent: "#0f9a90", base: null, mode: "dark", current: {} });
assert.equal(Object.keys(noBasis.tokens).length, 0, "缺少对比度基准时不应覆盖强调色");
assert.equal(noBasis.warnings.length, 1, "缺少基准应回报 warning");

/* ---------- 7. resolveMode ---------- */
assert.equal(model.resolveMode("auto", true), "dark");
assert.equal(model.resolveMode("auto", false), "light");
assert.equal(model.resolveMode("light", true), "light", "手动选择优先于系统");
assert.equal(model.resolveMode("dark", false), "dark", "手动选择优先于系统");
assert.equal(model.resolveMode(undefined, true), "dark", "未设置时按系统");

/* ---------- 8. auditPalette 真能发现坏配色 ---------- */
const broken = model.auditPalette({
  text: "#f5f5f5",
  bg: "#f8f8f8",
  muted: "#eeeeee",
  faint: "#ededed",
  accent: "#e0e0e0",
  accentBright: "#eaeaea",
  danger: "#f0c0c0",
  surface: "#fafafa",
});
assert.ok(broken.length >= 6, `应报出多组不达标，实际 ${broken.length}`);

/* ---------- 9. 预设本身合法 ---------- */
for (const preset of model.ACCENT_PRESETS) {
  assert.ok(model.normalizeHex(preset.value), `强调色预设 ${preset.name} 不是合法 hex`);
}
for (const preset of model.BASE_PRESETS) {
  assert.ok(model.normalizeHex(preset.value), `底色预设 ${preset.name} 不是合法 hex`);
}

/* ---------- 10. 封面浮层（暗玻璃题签）上的强调色必须对深色可读 ----------
   亮色模式下页面强调色偏深，直接压到深色题签上会读不出来
   （实测 1.47:1）。题签强调色因此单独派生。 */
assert.ok(model.normalizeHex(model.OVERLAY_PLATE), "题签底色必须是合法 hex");
for (const accent of ACCENTS.concat(["#b23b60", "#0d6f88", "#0b6b80", "#0a6f68"])) {
  const overlay = model.deriveOverlayAccent(accent);
  assert.ok(overlay, `deriveOverlayAccent 应能解析 ${accent}`);
  for (const key of ["overlayAccent", "overlayAccentBright"]) {
    const ratio = model.contrast(overlay[key], model.OVERLAY_PLATE);
    assert.ok(
      ratio != null && ratio >= 4.5,
      `题签强调色 ${accent} → ${key} 只有 ${ratio}:1（应 >= 4.5）`
    );
  }
  assert.ok(model.normalizeHex(overlay.overlayAccentDeep), "题签深色变体应是合法 hex");
}
assert.equal(model.deriveOverlayAccent("nope"), null, "非法输入不应抛错");

/* ---------- 11. buildOverrides 必须连题签配色一起给 ---------- */
for (const mode of model.MODES) {
  const palette = model.deriveBase("#150f1a", { mode });
  const result = model.buildOverrides({
    accent: mode === "light" ? "#b23b60" : "#f2a3b8",
    base: null,
    mode,
    current: { bg: palette.bg, surface: palette.surface },
  });
  assert.deepEqual(result.warnings, [], `${mode}: 合法输入不应产生 warning`);
  assert.ok(result.tokens["--overlay-accent"], `${mode}: 应给出题签强调色`);
  const ratio = model.contrast(result.tokens["--overlay-accent"], model.OVERLAY_PLATE);
  assert.ok(ratio >= 4.5, `${mode}: 题签强调色只有 ${ratio}:1`);
}

console.log(
  `Theme model passed: ${model.MODES.length} 模式 · ${paletteChecks} 组任意配色全部满足对比度规则`
);
