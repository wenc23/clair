"use strict";
/*
 * 像素采样 / 两图差异工具。
 *
 * 用途有两个：
 *  1. 验证"重构不改变视觉"——改动前后同一主题截图应几乎逐像素一致；
 *  2. 量化"是否同质化"——两套主题截图若高度相似，说明机制没换成功。
 *
 * 实现：CDP 截图 → Node 内解 PNG（zlib + 完整反滤波）→ 下采样直方图 + 平均绝对差。
 * 不引入任何依赖，图片只在内存里处理。
 *
 * 用法：
 *   node tools/_pixdiff.cjs compare <a.png> <b.png>
 *   node tools/_similarity.cjs            （见另一个脚本，做主题两两比较）
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (bitDepth !== 8) throw new Error("只支持 8bit PNG，实际 " + bitDepth);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// 下采样到 grid×grid，每格取平均 RGB —— 对同一页面的布局差异敏感，
// 对渲染噪声（抗锯齿）不敏感。
function signature(png, grid = 24) {
  const { width, height, channels, data } = png;
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * width) / grid), x1 = Math.floor(((gx + 1) * width) / grid);
      const y0 = Math.floor((gy * height) / grid), y1 = Math.floor(((gy + 1) * height) / grid);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * channels;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      cells.push(n ? [r / n, g / n, b / n] : [0, 0, 0]);
    }
  }
  return cells;
}

function meanAbsDiff(aCells, bCells) {
  let sum = 0;
  for (let i = 0; i < aCells.length; i++) {
    for (let c = 0; c < 3; c++) sum += Math.abs(aCells[i][c] - bCells[i][c]);
  }
  return sum / (aCells.length * 3);
}

module.exports = { decodePng, signature, meanAbsDiff };

if (require.main === module) {
  const [, , cmd, pa, pb] = process.argv;
  if (cmd === "compare") {
    const a = decodePng(fs.readFileSync(pa));
    const b = decodePng(fs.readFileSync(pb));
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`尺寸不同：${a.width}x${a.height} vs ${b.width}x${b.height}`);
      process.exit(1);
    }
    const sa = signature(a), sb = signature(b);
    const d = meanAbsDiff(sa, sb);
    // 逐格最大差，用来定位差异出现在哪个区域
    let maxD = 0, maxIdx = -1;
    for (let i = 0; i < sa.length; i++) {
      for (let c = 0; c < 3; c++) {
        const dd = Math.abs(sa[i][c] - sb[i][c]);
        if (dd > maxD) { maxD = dd; maxIdx = i; }
      }
    }
    const grid = 24;
    console.log(`${path.basename(pa)} vs ${path.basename(pb)}`);
    console.log(`  平均绝对差 = ${d.toFixed(2)} / 255`);
    console.log(`  最大单格差 = ${maxD.toFixed(1)} (格 ${maxIdx % grid},${Math.floor(maxIdx / grid)})`);
    console.log(d < 1.0 ? "  → 视觉一致 ✓" : d < 4 ? "  → 轻微差异" : "  → 明显差异");
  } else {
    console.log("用法: node tools/_pixdiff.cjs compare <a.png> <b.png>");
  }
}
