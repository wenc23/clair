"use strict";

// 回归测试：app.js 的 APP_VERSION 与 package.json version 必须一致，
// 防止两处手工维护的版本号漂移。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");

const match = appJs.match(/const APP_VERSION\s*=\s*"([^"]+)"/);
assert.ok(match, "app.js 中应存在 APP_VERSION 常量");
assert.equal(match[1], packageJson.version, "app.js 的 APP_VERSION 必须与 package.json version 一致");

console.log(`Version consistency passed: ${packageJson.version}`);
