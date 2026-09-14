"use strict";

// 静态契约检查：index.html 引用的本地脚本/样式必须真的存在，
// 并且必须同时出现在 server.cjs 与 lan-server.cjs 的 publicFiles 白名单中。
// 用途：防止新增 <script src="..."> 后忘记同步三处（页面/两个服务器）造成 404。
// 用法：node tools/check-static-contract.cjs

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const serverJs = read("server.cjs");
const lanServerJs = read("lan-server.cjs");

let failures = 0;
const report = (message) => {
  console.log(`✗ ${message}`);
  failures++;
};

// 解析 index.html 里引用的本地静态资源
const referenced = [];
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (/^(?:https?:|data:|blob:)/.test(url)) continue;
  const clean = url.split(/[?#]/)[0];
  if (!clean || clean.startsWith("/")) continue;
  referenced.push(clean);
}

for (const name of referenced) {
  if (!fs.existsSync(path.join(root, name))) {
    report(`index.html 引用的 ${name} 不存在`);
    continue;
  }
  const inServer = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(serverJs);
  const inLan = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(lanServerJs);
  if (!inServer) report(`${name} 未列入 server.cjs 的 publicFiles`);
  if (!inLan) report(`${name} 未列入 lan-server.cjs 的 publicFiles`);
}

if (referenced.length === 0) {
  report("未能从 index.html 解析到任何静态资源引用");
}

if (failures) {
  process.stderr.write(`\n静态契约检查未通过：${failures} 处问题\n`);
  process.exitCode = 1;
} else {
  console.log(`静态契约检查通过：${referenced.join(", ")}`);
}
