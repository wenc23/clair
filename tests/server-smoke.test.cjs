"use strict";

// 服务器冒烟测试 / 回归测试（node:test 套件，Node >= 20）：
// - 白名单文件可访问，非白名单文件 404
// - 静态文件携带正确 Content-Type 与 Cache-Control: no-store
// - HEAD 请求只返回头部、响应体为空
// - 带查询字符串的路径仍可访问
// - 畸形百分号编码（/%zz、/%00）返回 400 且不崩溃进程（回归测试历史 bug）
// - 响应包含 X-Content-Type-Options: nosniff
// 跨平台，无第三方依赖。服务器只启动一次（before/after）。

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const SERVER_PATH = path.resolve(__dirname, "..", "server.cjs");
const REQUEST_TIMEOUT_MS = 4000;

let child = null; // 服务器子进程
let port = 0;     // 随机选择的端口

// 带显式超时的请求助手：超时即失败，绝不悬挂
function request(requestPath, options = {}) {
  const method = options.method || "GET";
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: requestPath, method, headers: options.headers || {} },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () =>
      req.destroy(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${method} ${requestPath}`))
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitUntilListening() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await request("/");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

test.before(async () => {
  port = 18000 + Math.floor(Math.random() * 2000);
  child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, CLAIR_PORT: String(port) },
    stdio: "ignore", // 测试只关心 HTTP 响应，不读取子进程输出
  });
  assert.equal(await waitUntilListening(), true, "服务器未在预期时间内启动");
});

test.after(() => {
  if (child) child.kill();
});

test("GET / 返回 200、HTML 内容类型与 nosniff 头", async () => {
  const root = await request("/");
  assert.equal(root.status, 200, "首页应返回 200");
  assert.match(root.headers["content-type"] || "", /text\/html/);
  assert.equal(root.headers["x-content-type-options"], "nosniff", "应携带 nosniff 安全头");
});

test("白名单静态文件带正确 Content-Type 与 no-store", async () => {
  const app = await request("/app.js");
  assert.equal(app.status, 200, "app.js 应可访问");
  assert.match(app.headers["content-type"] || "", /text\/javascript/);
  assert.equal(app.headers["cache-control"], "no-store", "app.js 应禁止缓存");

  const css = await request("/styles.css");
  assert.equal(css.status, 200, "styles.css 应可访问");
  assert.match(css.headers["content-type"] || "", /text\/css/);
  assert.equal(css.headers["cache-control"], "no-store", "styles.css 应禁止缓存");

  assert.equal((await request("/index.html")).status, 200);
});

test("HEAD / 只返回头部、响应体为空", async () => {
  const head = await request("/", { method: "HEAD" });
  assert.equal(head.status, 200, "HEAD 首页应返回 200");
  assert.match(head.headers["content-type"] || "", /text\/html/);
  assert.equal(head.body.length, 0, "HEAD 响应体应为空");
});

test("带查询字符串的路径仍返回 200", async () => {
  assert.equal((await request("/index.html?v=1")).status, 200, "带查询字符串的路径应可访问");
});

test("非白名单文件与路径穿越返回 404", async () => {
  assert.equal((await request("/server.cjs")).status, 404, "非白名单文件应返回 404");
  assert.equal((await request("/../server.cjs")).status, 404, "路径穿越应返回 404");
});

test("畸形百分号编码返回 400 且进程不崩溃（回归）", async () => {
  assert.equal((await request("/%zz")).status, 400, "非法百分号编码应返回 400 而不是崩溃");
  assert.equal((await request("/%00")).status, 400, "NUL 字节路径应返回 400");

  // 畸形请求之后服务器必须仍然存活并能正常响应
  assert.equal((await request("/")).status, 200, "畸形请求后服务器应仍可正常服务");
});
