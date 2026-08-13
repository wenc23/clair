"use strict";

// 对仓库内所有 .js/.cjs/.mjs 文件做 node --check 语法检查。
// 跨平台（Windows / Linux / macOS），供本地与 CI 使用。

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".agents",
  ".Clair",
  ".Clair 回收站",
  "node_modules",
]);

const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) walk(fullPath);
    } else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
}

walk(root);
files.sort((a, b) => a.localeCompare(b));

let failed = 0;
for (const file of files) {
  try {
    // stdio: "inherit"：node --check 的报错直接输出到终端，成功时静默；
    // 子进程退出码非 0 时 execFileSync 抛错。
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  } catch {
    failed++;
    process.stderr.write(`✗ ${path.relative(root, file)}\n`);
  }
}

if (failed) {
  process.stderr.write(`\n${failed} 个文件语法检查未通过\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`语法检查通过：${files.length} 个文件\n`);
}
