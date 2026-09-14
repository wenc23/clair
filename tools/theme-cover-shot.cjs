"use strict";
/*
 * 封面英雄式（B 方向）视觉验证。
 *
 * 默认打开时没有选中曲目，--cover-bg 是 none，满幅层不可见，
 * 只看默认态无法判断这套布局成立与否。因此这里：
 *   1. 直接用 CDP 注入一张真实封面 URL 到 --cover-bg（等价于选中一首有封面的曲目）；
 *   2. 截图；
 *   3. 顺便量一下关键元素的位置，确认"封面满幅、印章在左下、信息浮层在右"。
 *
 * 用法：node tools/theme-cover-shot.cjs [主题] [模式] [封面 data URL]
 *   模式：dark / light（默认 dark）
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9441;
const THEME = process.argv[2] || "sakura";
const MODE = process.argv[3] || "dark";
const DATA_URL_FILE = path.resolve(__dirname, "..", ".preview", "cover-sample.dataurl.txt");
const COVER = fs.existsSync(DATA_URL_FILE)
  ? fs.readFileSync(DATA_URL_FILE, "utf8").trim()
  : process.argv[4];
const OUT = path.resolve(__dirname, "..", ".preview", `hero-${THEME}-${MODE}.png`);
const PAGE_URL = `http://127.0.0.1:8000/index.html?theme=${THEME}&mode=${MODE}`;

const get = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${PORT}`,
    "--window-size=1440,900", "--user-data-dir=" + path.resolve(__dirname, "..", ".preview", "hero"),
    PAGE_URL], { stdio: "ignore" });
  let t = null;
  for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = (await get("/json/list")).find((x) => x.type === "page" && x.webSocketDebuggerUrl); } catch {} }
  if (!t) { chrome.kill(); throw new Error("无法连接"); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i2 = ++id; pend.set(i2, { res, rej }); ws.send(JSON.stringify({ id: i2, method: m, params: p })); });
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: PAGE_URL });
  for (let i = 0; i < 40; i++) { await sleep(250); const s = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }); if (s.result.value === "complete") break; }
  await sleep(1200);

  // 注入封面：等价于选中一首带封面的曲目。
  // 用内联 data URL 而不是外链，避免 headless 环境连不上外网导致图不加载。
  // 必须同时设置 --cover-bg、给 body 加 has-cover-art、给满幅层塞图片 ——
  // 真实应用里这三件事由 app.js 完成，缺任何一件都测不到"有封面"的状态。
  const COVER_DATA = process.env.CLAIR_COVER_DATA || COVER;
  await send("Runtime.evaluate", {
    expression: `(() => {
      const url = ${JSON.stringify(COVER_DATA)};
      document.getElementById('player-view').style.setProperty('--cover-bg', 'url("' + url + '")');
      document.body.classList.add('has-cover-art');
      const img = document.getElementById('cover-bg-image');
      if (!img) return 'cover-bg-image MISSING';
      img.onerror = () => { document.body.classList.remove('has-cover-art'); };
      img.src = url;   // 必须设成 url 变量本身，不能是它的字符串字面量
      return 'ok';
    })()`,
    returnByValue: true,
  });

  // 等图片真正加载完
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const done = await send("Runtime.evaluate", {
      expression: `(() => { const i = document.getElementById('cover-bg'); return i.complete && i.naturalWidth > 0; })()`,
      returnByValue: true,
    });
    if (done.result.value === true) break;
  }
  await sleep(500);

  const info = await send("Runtime.evaluate", {
    expression: `(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return 'MISSING';
        const b = e.getBoundingClientRect(); return Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); };
      const img = document.getElementById('cover-bg');
      const tp = document.querySelector('.track-panel');
      const tcs = getComputedStyle(tp);
      const ap = document.querySelector('.art-panel');
      const acs = getComputedStyle(ap);
      const nl = document.querySelector('.now-layout');
      const ncs = getComputedStyle(nl);
      return JSON.stringify({
        视口: window.innerWidth + 'x' + window.innerHeight,
        封面层加载: img.complete && img.naturalWidth > 0,
        封面层: r('#cover-bg'),
        印章: r('.vinyl-stamp'),
        曲目板: r('.track-panel'),
        曲目板_计算: 'position=' + tcs.position + ' z=' + tcs.zIndex + ' w=' + tcs.width + ' alignSelf=' + tcs.alignSelf + ' justifySelf=' + tcs.justifySelf,
        唱片区_计算: 'display=' + acs.display + ' position=' + acs.position + ' inset=' + acs.inset,
        now布局: r('.now-layout') + ' cols=' + ncs.gridTemplateColumns,
        频谱卡: r('.spectrum-card'),
        播放条: r('.transport'),
        命中击中: (() => { const e = document.elementFromPoint(600, 300); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : 'none'; })(),
        命中规则: (() => {
          const out = [];
          const el = document.querySelector('.now-layout');
          const parent = document.getElementById('player-view');
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            for (const rule of rules) {
              if (rule.type === CSSRule.MEDIA_RULE) {
                if (!window.matchMedia(rule.conditionText).matches) continue;
                for (const sub of rule.cssRules || []) {
                  if (sub.selectorText && (el.matches(sub.selectorText) || parent.matches(sub.selectorText))) {
                    out.push('@media ' + rule.conditionText + ' ' + sub.selectorText + ' { ' + sub.style.cssText.slice(0, 120) + ' }');
                  }
                }
                continue;
              }
              if (rule.selectorText && (el.matches(rule.selectorText) || parent.matches(rule.selectorText))) {
                out.push(rule.selectorText + ' { ' + rule.style.cssText.slice(0, 120) + ' }');
              }
            }
          }
          return out;
        })(),
        父链: (() => {
          const chain = [];
          let el = document.querySelector('.now-layout');
          while (el && el !== document.documentElement) {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            chain.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
              '.' + String(el.className).split(' ')[0] +
              ' h=' + Math.round(r.height) +
              ' pos=' + cs.position +
              ' rows=' + (cs.gridTemplateRows || '-').slice(0, 40) +
              ' align=' + cs.alignItems);
            el = el.parentElement;
          }
          return chain;
        })(),
      }, null, 1);
    })()`,
    returnByValue: true,
  });
  console.log(info.result.value);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`截图已保存：${path.relative(path.resolve(__dirname, ".."), OUT)}  ${fs.statSync(OUT).size} bytes`);

  // 量像素：直接比较"标题文字像素"与"其周围底色像素"的平均亮度。
  // 之前的做法用整块面板的 5%..95% 分位，会被大片空底稀释，低估对比度。
  const { decodePng } = require("./_png.cjs");
  const png = decodePng(Buffer.from(shot.data, "base64"));
  const rects = await send("Runtime.evaluate", {
    expression: `(() => {
      const g = (s) => { const e = document.querySelector(s); if (!e) return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return JSON.stringify({
        title: g('.track-heading h2'),
        credit: g('#now-credit'),
        meta: g('.metadata-grid dt'),
        panel: g('.track-panel'),
        spectrum: g('.spectrum-card'),
        stamp: g('.vinyl-stamp'),
        cover: g('#cover-bg'),
        artPanel: g('.art-panel'),
        nowLayout: g('.now-layout'),
        artPanelInset: (() => { const s = getComputedStyle(document.querySelector('.art-panel')); return s.inset + ' pos=' + s.position + ' h=' + s.height; })(),
        stampOffsetParent: (() => { const e = document.querySelector('.vinyl-stamp').offsetParent; return e ? e.tagName + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] : 'null'; })(),
        glass: (() => {
          const f = (s) => { const e = document.querySelector(s); const c = getComputedStyle(e);
            return s + ' bgColor=' + c.backgroundColor + ' bgImg=' + c.backgroundImage.slice(0, 28) + ' backdrop=' + (c.backdropFilter || '-'); };
          return [f('.track-panel'), f('.spectrum-card'), f('.audio-facts')].join(' || ');
        })(),
      });
    })()`,
    returnByValue: true,
  });
  const R = JSON.parse(rects.result.value);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lumAt = (x, y) => {
    const i = (y * png.width + x) * png.channels;
    return 0.2126 * lin(png.data[i]) + 0.7152 * lin(png.data[i + 1]) + 0.0722 * lin(png.data[i + 2]);
  };
  // 在给定框内取最亮与最暗像素的平均（分别代表文字与底色）
  const contrastIn = (label, box) => {
    if (!box) { console.log(`  ${label}: 未找到`); return; }
    const [x0, y0, w, h] = box;
    const vals = [];
    for (let y = Math.max(0, y0); y < Math.min(png.height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(png.width, x0 + w); x++) vals.push(lumAt(x, y));
    }
    if (vals.length < 10) { console.log(`  ${label}: 采样过少`); return; }
    vals.sort((a, b) => a - b);
    const base = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.3))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(vals.length * 0.3));
    const top = vals.slice(-Math.max(1, Math.floor(vals.length * 0.08)));
    const text = top.reduce((a, b) => a + b, 0) / top.length;
    const cr = (Math.max(text, base) + 0.05) / (Math.min(text, base) + 0.05);
    console.log(`  ${label.padEnd(14)} 底色 ${base.toFixed(3)} / 文字 ${text.toFixed(3)}  对比度约 ${cr.toFixed(2)}:1  ${cr >= 4.5 ? "✓" : "✗ 偏低"}`);
  };
  console.log("\n文字与其底色的对比度（框内最暗 30% 视为底色、最亮 8% 视为文字）：");
  contrastIn("标题 h2", R.title);
  contrastIn("副标题", R.credit);
  contrastIn("资料标签", R.meta);

  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
