"use strict";
/*
 * 用 CDP 强制设备尺寸后截图（--window-size 在 headless 下不保证生效，
 * 实测截出来的图与目标视口不符，会误判移动端效果）。
 * 用法：node tools/_shot.cjs <宽> <高> <主题> <输出文件名> [模式]
 *   模式：dark / light / auto（默认 dark，与旧调用兼容）
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9541;
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const THEME = process.argv[4] || "sakura";
const MODE = process.argv[6] || "dark";
const OUT = path.resolve(__dirname, "..", ".preview", process.argv[5] || `shot-${W}x${H}-${THEME}-${MODE}.png`);

const get = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${PORT}`,
    "--user-data-dir=" + path.resolve(__dirname, "..", ".preview", "shot"), "about:blank"], { stdio: "ignore" });
  let t = null;
  for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = (await get("/json/list")).find((x) => x.type === "page" && x.webSocketDebuggerUrl); } catch {} }
  if (!t) { chrome.kill(); throw new Error("无法连接"); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i2 = ++id; pend.set(i2, { res, rej }); ws.send(JSON.stringify({ id: i2, method: m, params: p })); });
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
  await send("Page.navigate", { url: `http://127.0.0.1:8000/index.html?theme=${THEME}&mode=${MODE}` });
  for (let i = 0; i < 40; i++) { await sleep(250); const s = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }); if (s.result.value === "complete") break; }
  await sleep(900);
  const real = await send("Runtime.evaluate", { expression: "window.innerWidth + 'x' + window.innerHeight", returnByValue: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`实际视口 ${real.result.value} → ${path.basename(OUT)} (${fs.statSync(OUT).size} bytes)`);
  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
