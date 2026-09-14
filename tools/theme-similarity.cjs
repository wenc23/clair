"use strict";
/*
 * 主题差异报告（辅助工具，非判据）。
 *
 * 【能力边界 —— 请先读这段】
 * 这个工具能客观测的只有**颜色**层面的差异（下采样色彩签名）。
 * 它**测不出"机制是否雷同"**，我在这上面试过两种更聪明的做法，都失败了：
 *   1. 只比颜色 → 浅色主题底色相近，必然显示"像"，误报；
 *   2. 比 Sobel 边缘签名 → 主要捕捉共用的页面骨架（面板边框、文字、唱片的
 *      边缘），所有主题都在 1-2.5 之间，同样测不出差异；
 *   3. 比局部纹理能量 → 被同样的骨架主导，7 套全落在 19-28 的窄区间内。
 * 结论：机制是否真的不同，本项目没有可靠的自动判据。可信的判据是：
 *   - tests/theme-contract.test.cjs 的 --mechanism 唯一性断言（结构性，可执行）；
 *   - --panel-recipe 必须互不相同（结构性，可执行）；
 *   - 人眼看 tools 生成的截图（`--screenshot` 逐主题渲染）。
 * 因此本工具只做颜色差异的汇报，并如实标注它不构成"不同质化"的证明。
 *
 * 用法：node tools/theme-similarity.cjs [截图目录]
 */
const fs = require("fs");
const path = require("path");
const { decodePng, signature, meanAbsDiff } = require("./_png.cjs");

const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", ".preview", "shots"));
if (!fs.existsSync(dir)) {
  console.error(`目录不存在：${dir}`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
if (files.length < 2) {
  console.error(`需要至少 2 张截图，实际 ${files.length} 张`);
  process.exit(1);
}

const items = files.map((f) => {
  const png = decodePng(fs.readFileSync(path.join(dir, f)));
  return { name: f.replace(/\.png$/, ""), sig: signature(png), w: png.width, h: png.height };
});

console.log(`主题颜色差异报告（${items.length} 套，截图 ${items[0].w}x${items[0].h}）`);
console.log("注意：这只反映颜色差异，不能证明机制不同。\n");

const pairs = [];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    if (items[i].w !== items[j].w || items[i].h !== items[j].h) continue;
    pairs.push({ a: items[i].name, b: items[j].name, d: meanAbsDiff(items[i].sig, items[j].sig) });
  }
}
pairs.sort((x, y) => x.d - y.d);

console.log("颜色最接近的 6 对：");
for (const p of pairs.slice(0, 6)) {
  console.log(`  ${p.a.padEnd(8)} vs ${p.b.padEnd(8)}  ${p.d.toFixed(2).padStart(7)}`);
}
console.log("\n颜色差异最大的 4 对（确认色域跨度）：");
for (const p of pairs.slice(-4).reverse()) {
  console.log(`  ${p.a.padEnd(8)} vs ${p.b.padEnd(8)}  ${p.d.toFixed(2).padStart(7)}`);
}

const min = pairs[0].d;
const max = pairs[pairs.length - 1].d;
console.log(`\n色域跨度：最难区分 ${min.toFixed(2)}，最大差异 ${max.toFixed(2)}`);
console.log(
  min >= 8
    ? "→ 没有任何两套主题的颜色接近（>= 8），颜色维度不存在同质化。"
    : `→ 有颜色接近的组合（最小 ${min.toFixed(2)}）。浅色主题底色相近属正常，请结合截图判断。`
);
console.log("\n机制是否真的不同，请看 tools/theme-contract.test.cjs 的断言与截图，本报告不作结论。");
