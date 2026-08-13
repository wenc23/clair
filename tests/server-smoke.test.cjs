"use strict";

// 服务器冒烟测试 / 回归测试：
// - 白名单文件可访问，非白名单文件 404
// - 畸形百分号编码（/%zz、/%00）返回 400 且不崩溃进程（回归测试历史 bug）
// - 响应包含 X-Content-Type-Options: nosniff
// 跨平台，无第三方依赖，Node >= 18。

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const SERVER_PATH = path.resolve(__dirname, "..", "server.cjs");

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: requestPath, method: "GET" },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitUntilListening(port) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await request(port, "/");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

async function run() {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, CLAIR_PORT: String(port) },
    stdio: "ignore", // 测试只关心 HTTP 响应，不读取子进程输出
  });
  try {
    assert.equal(await waitUntilListening(port), true, "服务器未在预期时间内启动");

    const root = await request(port, "/");
    assert.equal(root.status, 200, "首页应返回 200");
    assert.match(root.headers["content-type"] || "", /text\/html/);
    assert.equal(root.headers["x-content-type-options"], "nosniff", "应携带 nosniff 安全头");

    assert.equal((await request(port, "/app.js")).status, 200, "白名单文件应可访问");
    assert.equal((await request(port, "/index.html")).status, 200);

    assert.equal((await request(port, "/server.cjs")).status, 404, "非白名单文件应返回 404");
    assert.equal((await request(port, "/../server.cjs")).status, 404, "路径穿越应返回 404");
    assert.equal((await request(port, "/%zz")).status, 400, "非法百分号编码应返回 400 而不是崩溃");
    assert.equal((await request(port, "/%00")).status, 400, "NUL 字节路径应返回 400");

    // 畸形请求之后服务器必须仍然存活并能正常响应
    assert.equal((await request(port, "/")).status, 200, "畸形请求后服务器应仍可正常服务");

    console.log("Server smoke tests passed");
  } finally {
    child.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
