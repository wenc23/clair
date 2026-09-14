(function attachClairThemeModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClairThemeModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClairThemeModel() {
  "use strict";

  /*
   * 主题配色模型：把「用户自选强调色 / 底色」换算成一组可读的令牌。
   *
   * 设计约束：
   *   1. 与 tools/theme-contrast.cjs 共用同一套 WCAG 阈值（CONTRAST_RULES），
   *      否则「静态校验通过」和「用户手选的颜色」会互相打架。
   *   2. 派生函数一律返回**短名**（bg / surface / text …），由 PALETTE_TOKENS
   *      映射到 CSS 自定义属性名；这样单元测试不必关心 CSS 命名。
   *   3. 任何一条对比度不达标都要被自动修正；修正不了就丢弃该项并回报 warning，
   *      绝不把不可读的配色写进 DOM。
   */

  // auto 只是"用户选择"，真正落到 DOM 的永远是 light / dark。
  const MODE_CHOICES = ["auto", "light", "dark"];
  const MODES = ["light", "dark"];

  // 与 themes 的 L1 调色板一一对应；check:themes 的 CHECKS 是同一组。
  const CONTRAST_RULES = Object.freeze([
    { a: "text", b: "bg", min: 7.0, label: "正文 text/bg" },
    { a: "muted", b: "bg", min: 4.5, label: "次级 muted/bg" },
    { a: "accent", b: "bg", min: 4.5, label: "强调 accent/bg" },
    { a: "muted", b: "surface", min: 4.5, label: "次级 muted/surface" },
    { a: "faint", b: "surface", min: 4.5, label: "小标签 faint/surface" },
    { a: "accent", b: "surface", min: 4.5, label: "强调 accent/surface" },
    { a: "accentBright", b: "surface", min: 4.5, label: "高亮 accentBright/surface" },
    { a: "danger", b: "surface", min: 4.5, label: "危险 danger/surface" },
  ]);

  // 短名 → CSS 自定义属性。只列"自选配色会覆盖"的令牌：
  // --line / --line-strong / --panel-highlight / --hi-edge 由 --text 派生，
  // --glow / --accent-soft / --viz-fill 由 --accent 派生，都会自动跟随。
  const PALETTE_TOKENS = Object.freeze({
    bg: "--bg",
    sidebar: "--sidebar",
    surface: "--surface",
    surface2: "--surface-2",
    surface3: "--surface-3",
    glass: "--glass",
    text: "--text",
    muted: "--muted",
    faint: "--faint",
    good: "--good",
    warn: "--warn",
    danger: "--danger",
    shadow: "--shadow",
    grad2: "--grad-2",
    grad4: "--grad-4",
  });

  const ACCENT_PRESETS = Object.freeze([
    { name: "绯樱", value: "#d6708c" },
    { name: "朱砂", value: "#c8452f" },
    { name: "琥珀", value: "#b4761a" },
    { name: "苔绿", value: "#4f8a3d" },
    { name: "青碧", value: "#0f9a90" },
    { name: "靛蓝", value: "#3f66d4" },
    { name: "紫晶", value: "#7b53c9" },
    { name: "石墨", value: "#5b6472" },
  ]);

  const BASE_PRESETS = Object.freeze([
    { name: "夜墨", value: "#150f1a" },
    { name: "靛夜", value: "#0b1220" },
    { name: "深松", value: "#0c1a16" },
    { name: "暖褐", value: "#1a1210" },
    { name: "雾蓝", value: "#dfe7f2" },
    { name: "米纸", value: "#f2ece0" },
  ]);

  /* ---------- 颜色基础运算 ---------- */

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function normalizeHex(input) {
    if (typeof input !== "string") return null;
    const clean = input.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{3}$/.test(clean)) {
      return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
    }
    return /^[0-9a-f]{6}$/.test(clean) ? `#${clean}` : null;
  }

  function hexToRgb(hex) {
    const clean = normalizeHex(hex);
    if (!clean) return null;
    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16),
    ];
  }

  function rgbToHex(rgb) {
    if (!rgb) return null;
    return `#${rgb.map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`;
  }

  function rgbToHsl(rgb) {
    const [r, g, b] = rgb.map((channel) => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) return [0, 0, light];
    const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    return [((hue % 360) + 360) % 360, sat, light];
  }

  function hslToRgb([hue, sat, light]) {
    const h = (((hue % 360) + 360) % 360) / 360;
    const s = clamp01(sat);
    const l = clamp01(light);
    if (s === 0) {
      const grey = clampByte(l * 255);
      return [grey, grey, grey];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toChannel = (t) => {
      let value = t;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return p + (q - p) * 6 * value;
      if (value < 1 / 2) return q;
      if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
      return p;
    };
    return [
      clampByte(toChannel(h + 1 / 3) * 255),
      clampByte(toChannel(h) * 255),
      clampByte(toChannel(h - 1 / 3) * 255),
    ];
  }

  function hslToHex(hue, sat, light) {
    return rgbToHex(hslToRgb([hue, sat, light]));
  }

  function mixRgb(left, right, ratio) {
    if (!left || !right) return null;
    const t = clamp01(ratio);
    return left.map((channel, index) => clampByte(channel + (right[index] - channel) * t));
  }

  function mixHex(left, right, ratio) {
    return rgbToHex(mixRgb(hexToRgb(left), hexToRgb(right), ratio));
  }

  function linearize(channel) {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function luminanceRgb(rgb) {
    if (!rgb) return null;
    return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
  }

  function luminance(hex) {
    return luminanceRgb(hexToRgb(hex));
  }

  function contrastRgb(left, right) {
    const l1 = luminanceRgb(left);
    const l2 = luminanceRgb(right);
    if (l1 == null || l2 == null) return null;
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function contrast(left, right) {
    return contrastRgb(hexToRgb(left), hexToRgb(right));
  }

  // 背景偏亮就往暗处调、偏暗就往亮处调：这是"最少改动"的方向。
  function preferFor(background) {
    const value = luminance(background);
    if (value == null) return "darker";
    return value > 0.4 ? "darker" : "lighter";
  }

  /* ---------- 对比度兜底 ---------- */

  function ensureContrastRgb(colorRgb, backgroundRgb, minRatio, prefer) {
    if (!colorRgb || !backgroundRgb) return null;
    const startRatio = contrastRgb(colorRgb, backgroundRgb);
    if (startRatio != null && startRatio >= minRatio) {
      return { rgb: colorRgb, ratio: startRatio, adjusted: false };
    }
    const [hue, sat, light] = rgbToHsl(colorRgb);
    const step = prefer === "lighter" ? 0.02 : -0.02;
    let current = light;
    for (let index = 0; index < 60; index += 1) {
      current += step;
      if (current <= 0 || current >= 1) break;
      const candidate = hslToRgb([hue, sat, current]);
      const ratio = contrastRgb(candidate, backgroundRgb);
      if (ratio != null && ratio >= minRatio) {
        return { rgb: candidate, ratio, adjusted: true };
      }
    }
    // 兜底：纯黑或纯白一定是对该背景可读的极值之一。
    const fallback = prefer === "lighter" ? [255, 255, 255] : [0, 0, 0];
    return { rgb: fallback, ratio: contrastRgb(fallback, backgroundRgb), adjusted: true };
  }

  function ensureContrast(hex, backgroundHex, minRatio, prefer) {
    const result = ensureContrastRgb(
      hexToRgb(hex),
      hexToRgb(backgroundHex),
      minRatio,
      prefer || preferFor(backgroundHex)
    );
    return result ? rgbToHex(result.rgb) : null;
  }

  /* ---------- 底色派生 ---------- */

  // 亮度阶梯（暗色 / 亮色两套），顺序：bg, sidebar, surface, surface-2, surface-3, glass
  const RAMP = {
    dark: [0.1, 0.13, 0.17, 0.23, 0.3, 0.185],
    light: [0.965, 0.985, 1.0, 0.935, 0.875, 0.975],
  };
  const RAMP_SATURATION = {
    dark: [0.55, 0.5, 0.45, 0.42, 0.38, 0.45],
    light: [0.5, 0.45, 0.3, 0.5, 0.55, 0.42],
  };

  function deriveBase(input, options) {
    const rgb = hexToRgb(input);
    if (!rgb) return null;
    const mode = options && options.mode === "light" ? "light" : "dark";
    const dark = mode === "dark";
    const [hue, rawSat] = rgbToHsl(rgb);
    // 底色的饱和度要收敛：整页底色一旦高饱和，任何文字都难读。
    const sat = Math.min(0.55, rawSat);
    const prefer = dark ? "lighter" : "darker";
    const ramp = RAMP[mode];
    const rampSat = RAMP_SATURATION[mode];

    const palette = {
      bg: hslToHex(hue, sat * rampSat[0], ramp[0]),
      sidebar: hslToHex(hue, sat * rampSat[1], ramp[1]),
      surface: hslToHex(hue, sat * rampSat[2], ramp[2]),
      surface2: hslToHex(hue, sat * rampSat[3], ramp[3]),
      surface3: hslToHex(hue, sat * rampSat[4], ramp[4]),
      glass: hslToHex(hue, sat * rampSat[5], ramp[5]),
      shadow: dark ? "rgba(0, 0, 0, 0.62)" : "rgba(24, 20, 44, 0.16)",
    };

    const textRgb = hslToRgb([hue, sat * (dark ? 0.18 : 0.25), dark ? 0.95 : 0.11]);
    const text = ensureContrastRgb(textRgb, hexToRgb(palette.bg), 7.0, prefer).rgb;
    palette.text = rgbToHex(text);

    const mutedStart = hslToRgb([hue, sat * 0.22, dark ? 0.72 : 0.42]);
    const mutedOnBg = ensureContrastRgb(mutedStart, hexToRgb(palette.bg), 4.5, prefer).rgb;
    const muted = ensureContrastRgb(mutedOnBg, hexToRgb(palette.surface), 4.5, prefer).rgb;
    palette.muted = rgbToHex(muted);

    const faintStart = hslToRgb([hue, sat * 0.2, dark ? 0.66 : 0.38]);
    const faint = ensureContrastRgb(faintStart, hexToRgb(palette.surface), 4.5, prefer).rgb;
    palette.faint = rgbToHex(faint);

    const semantic = { good: 148, warn: 78, danger: 8 };
    for (const [key, semanticHue] of Object.entries(semantic)) {
      const base = dark
        ? hslToRgb([semanticHue, 0.55, key === "warn" ? 0.78 : 0.72])
        : hslToRgb([semanticHue, 0.6, key === "warn" ? 0.38 : key === "danger" ? 0.4 : 0.32]);
      palette[key] = rgbToHex(ensureContrastRgb(base, hexToRgb(palette.surface), 4.5, prefer).rgb);
    }

    // mesh 渐变的另外两枚停靠色跟着底色走（-1 / -3 由强调色负责）。
    const meshLight = dark ? 0.42 : 0.62;
    const meshDeep = dark ? 0.36 : 0.58;
    palette.grad2 = hslToHex(hue + 28, Math.min(0.8, sat + 0.28), meshLight);
    palette.grad4 = hslToHex(hue - 38, Math.min(0.8, sat + 0.22), meshDeep);

    return palette;
  }

  /* ---------- 强调色派生 ---------- */

  function deriveAccent(input, options) {
    const rgb = hexToRgb(input);
    if (!rgb) return null;
    const settings = options || {};
    const bg = settings.bg;
    const surface = settings.surface;
    if (!hexToRgb(bg) || !hexToRgb(surface)) return null;
    const prefer = settings.mode === "light" ? "darker" : preferFor(bg);

    const onBg = ensureContrastRgb(rgb, hexToRgb(bg), 4.5, prefer);
    const onSurface = ensureContrastRgb(onBg.rgb, hexToRgb(surface), 4.5, prefer);
    const accentRgb = onSurface.rgb;
    const [hue, sat, light] = rgbToHsl(accentRgb);
    // 高亮态继续朝"更远离背景"的方向推，保证 accent-bright/surface ≥ 4.5。
    const brightLight = prefer === "darker" ? Math.max(0, light - 0.14) : Math.min(1, light + 0.14);
    const bright = ensureContrastRgb(
      hslToRgb([hue, sat, brightLight]),
      hexToRgb(surface),
      4.5,
      prefer
    ).rgb;

    return {
      accent: rgbToHex(accentRgb),
      accentBright: rgbToHex(bright),
      accentDeep: mixHex(rgbToHex(accentRgb), bg, 0.3),
    };
  }

  /* ---------- 封面浮层（暗玻璃题签） ---------- */

  // 题签底色与页面明暗无关：它压在封面照片上，恒为深色。
  // 因此题签上的强调色必须"对深色可读"，不能直接沿用页面强调色
  // （亮色模式下页面强调色偏深，压上去就看不见了）。
  const OVERLAY_PLATE = "#1a1220";

  function deriveOverlayAccent(input, options) {
    const rgb = hexToRgb(input);
    if (!rgb) return null;
    const plate = (options && options.plate) || OVERLAY_PLATE;
    const plateRgb = hexToRgb(plate);
    if (!plateRgb) return null;
    const accent = ensureContrastRgb(rgb, plateRgb, 4.5, "lighter").rgb;
    const [hue, sat, light] = rgbToHsl(accent);
    const bright = ensureContrastRgb(
      hslToRgb([hue, sat, Math.min(1, light + 0.16)]),
      plateRgb,
      4.5,
      "lighter"
    ).rgb;
    return {
      overlayAccent: rgbToHex(accent),
      overlayAccentBright: rgbToHex(bright),
      overlayAccentDeep: mixHex(rgbToHex(accent), plate, 0.35),
    };
  }

  /* ---------- 汇总 ---------- */

  function resolveMode(choice, systemDark) {
    if (choice === "light" || choice === "dark") return choice;
    return systemDark ? "dark" : "light";
  }

  // 把「主题作者值 + 用户覆盖」合并后逐条复核对比度；供单元测试与诊断使用。
  function auditPalette(palette) {
    if (!palette) return [];
    const failures = [];
    for (const rule of CONTRAST_RULES) {
      const ratio = contrast(palette[rule.a], palette[rule.b]);
      if (ratio == null) {
        failures.push({ rule: rule.label, ratio: null, min: rule.min, reason: "unparsable" });
      } else if (ratio < rule.min) {
        failures.push({ rule: rule.label, ratio, min: rule.min, reason: "low-contrast" });
      }
    }
    return failures;
  }

  /*
   * 计算要写进 DOM 的覆盖令牌。
   *   accent / base 为 null 表示"跟随主题"，此时不产生任何覆盖。
   *   current 是当前主题模式下计算样式里的 { bg, surface }，供强调色做对比度基准。
   * 返回 { tokens, palette, warnings }：调用方只写 tokens，其余令牌保持主题作者值。
   */
  function buildOverrides(options) {
    const settings = options || {};
    const accent = settings.accent || null;
    const base = settings.base || null;
    const mode = settings.mode === "light" ? "light" : "dark";
    const current = settings.current || {};
    const tokens = {};
    const warnings = [];

    let palette = null;
    if (base) {
      palette = deriveBase(base, { mode });
      if (!palette) {
        warnings.push({ code: "invalid-base", message: `无法解析底色 ${base}` });
      } else {
        for (const [key, token] of Object.entries(PALETTE_TOKENS)) {
          if (palette[key]) tokens[token] = palette[key];
        }
      }
    }

    if (accent) {
      const basis = {
        bg: (palette && palette.bg) || normalizeHex(current.bg),
        surface: (palette && palette.surface) || normalizeHex(current.surface),
      };
      const derived = basis.bg && basis.surface
        ? deriveAccent(accent, { bg: basis.bg, surface: basis.surface, mode })
        : null;
      if (!derived) {
        warnings.push({ code: "invalid-accent", message: `无法解析强调色 ${accent}` });
      } else {
        tokens["--accent"] = derived.accent;
        tokens["--accent-bright"] = derived.accentBright;
        tokens["--accent-deep"] = derived.accentDeep;
        tokens["--grad-1"] = derived.accent;
        tokens["--grad-3"] = derived.accentBright;
        // 封面浮层的强调色另算一份：它压在同为深色的题签玻璃上
        const overlay = deriveOverlayAccent(derived.accent);
        if (overlay) {
          tokens["--overlay-accent"] = overlay.overlayAccent;
          tokens["--overlay-accent-bright"] = overlay.overlayAccentBright;
          tokens["--overlay-accent-deep"] = overlay.overlayAccentDeep;
        }
        palette = Object.assign({}, palette, {
          accent: derived.accent,
          accentBright: derived.accentBright,
        });
      }
    }

    return { tokens, palette, warnings };
  }

  return {
    MODES,
    MODE_CHOICES,
    CONTRAST_RULES,
    PALETTE_TOKENS,
    ACCENT_PRESETS,
    BASE_PRESETS,
    OVERLAY_PLATE,
    auditPalette,
    buildOverrides,
    contrast,
    deriveAccent,
    deriveBase,
    deriveOverlayAccent,
    ensureContrast,
    hexToRgb,
    hslToHex,
    hslToRgb,
    luminance,
    mixHex,
    mixRgb,
    normalizeHex,
    preferFor,
    resolveMode,
    rgbToHex,
    rgbToHsl,
  };
});
