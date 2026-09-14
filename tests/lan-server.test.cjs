"use strict";

// LAN 服务器测试（node:test 套件，Node >= 20）：
// - /api/status 与 /api/library 正常返回
// - /media/ 完整 Range 矩阵：200 / 206 / 416 与各种边界
// - /media/ 拒绝非音频扩展名与编码路径穿越
// - 零字节文件可正常提供
// - 全部请求结束后服务器仍存活
// 使用临时音乐目录生成真实小文件（服务器只解析扩展名与大小，不解析内容），
// 服务器只启动一次（before/after），跨平台，无第三方依赖。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SERVER_PATH = path.resolve(__dirname, "..", "lan-server.cjs");
const REQUEST_TIMEOUT_MS = 4000;

const MEDIA_URL = "/media/Album/track.mp3"; // 10 字节、内容为 0..9 的伪音频文件
const EMPTY_URL = "/media/Album/empty.mp3"; // 零字节音频文件
const TRACK_SIZE = 10;

let child = null;        // LAN 服务器子进程
let childExited = null;  // 子进程退出 Promise，便于退出后再清理临时目录
let port = 0;            // 随机选择的端口
let temporaryRoot = "";  // 临时音乐目录

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
      await request("/api/status");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

test.before(async () => {
  // 构造临时音乐目录与测试文件
  temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "clair-lan-test-"));
  const album = path.join(temporaryRoot, "Album");
  await fs.promises.mkdir(album);
  const dataDirectory = path.join(temporaryRoot, ".Clair");
  await fs.promises.mkdir(dataDirectory);
  // “伪音频”字节（0..9）；服务器不解析内容，只看扩展名与大小
  await fs.promises.writeFile(path.join(album, "track.mp3"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  await fs.promises.writeFile(path.join(album, "empty.mp3"), Buffer.alloc(0));
  await fs.promises.writeFile(path.join(album, "notes.txt"), "not an audio file");
  await fs.promises.writeFile(path.join(dataDirectory, "library.json"), JSON.stringify({
    tracks: [{ path: `${path.basename(temporaryRoot)}/Album/track.mp3`, title: "Indexed title", artist: "Artist" }],
  }));

  port = 20000 + Math.floor(Math.random() * 2000);
  child = spawn(process.execPath, [SERVER_PATH, temporaryRoot], {
    env: { ...process.env, CLAIR_HOST: "127.0.0.1", CLAIR_PORT: String(port) },
    stdio: "ignore",
  });
  childExited = new Promise((resolve) => child.once("exit", resolve));
  assert.equal(await waitUntilListening(), true, "LAN server did not start");
});

test.after(async () => {
  if (child) {
    child.kill();
    await childExited;
  }
  if (temporaryRoot) {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("GET 无 Range → 200、Content-Length 等于文件大小、Accept-Ranges: bytes", async () => {
  const response = await request(MEDIA_URL);
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-length"], String(TRACK_SIZE));
  assert.equal(response.headers["accept-ranges"], "bytes");
  assert.deepEqual([...response.body], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "响应体应为完整文件内容");
});

test("HEAD 无 Range → 200、空响应体", async () => {
  const response = await request(MEDIA_URL, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-length"], String(TRACK_SIZE), "HEAD 应与 GET 一致地宣告大小");
  assert.equal(response.body.length, 0, "HEAD 响应体应为空");
});

test("bytes=0-0 → 206、Content-Length 1、Content-Range bytes 0-0/<size>", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=0-0" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-length"], "1");
  assert.equal(response.headers["content-range"], `bytes 0-0/${TRACK_SIZE}`);
  assert.deepEqual([...response.body], [0]);
});

test("bytes=2-5 → 206、响应体等于第 2..5 字节", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=2-5" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], `bytes 2-5/${TRACK_SIZE}`);
  assert.equal(response.headers["content-length"], "4");
  assert.deepEqual([...response.body], [2, 3, 4, 5]);
});

test("开区间 bytes=5- → 206、Content-Length 等于 size-5", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=5-" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], `bytes 5-${TRACK_SIZE - 1}/${TRACK_SIZE}`);
  assert.equal(response.headers["content-length"], String(TRACK_SIZE - 5));
  assert.deepEqual([...response.body], [5, 6, 7, 8, 9]);
});

test("后缀 bytes=-3 → 206、返回最后 3 字节", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=-3" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], `bytes ${TRACK_SIZE - 3}-${TRACK_SIZE - 1}/${TRACK_SIZE}`);
  assert.equal(response.headers["content-length"], "3");
  assert.deepEqual([...response.body], [7, 8, 9]);
});

test("不可满足的 bytes=999999- → 416 与 Content-Range: bytes */<size>", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=999999-" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers["content-range"], `bytes */${TRACK_SIZE}`);
  assert.equal(response.body.length, 0, "416 响应体应为空");
});

test("畸形 Range bytes=abc → 416", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=abc" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers["content-range"], `bytes */${TRACK_SIZE}`);
});

test("多段 Range bytes=0-1,3-4 → 416（正则拒绝多段，当前文档化行为）", async () => {
  const response = await request(MEDIA_URL, { headers: { Range: "bytes=0-1,3-4" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers["content-range"], `bytes */${TRACK_SIZE}`);
});

test("/media/ 拒绝非音频扩展名（.txt）→ 404", async () => {
  const response = await request("/media/Album/notes.txt");
  assert.equal(response.status, 404);
});

test("编码路径穿越在 /media/ 下返回 404", async () => {
  // 常规 %2e%2e 点段穿越
  assert.equal((await request("/media/%2e%2e/package.json")).status, 404);
  // 全编码点段（encodeURIComponent("../package.json") 的结果）
  assert.equal((await request("/media/%2e%2e%2fpackage.json")).status, 404);
  // 反斜杠（%5c）穿越变体
  assert.equal((await request("/media/..%5c..%5cpackage.json")).status, 404);
  // 编码斜杠（%2f）穿越变体
  assert.equal((await request("/media/..%2f..%2fpackage.json")).status, 404);
});

test("零字节音频文件 → 200、Content-Length 0", async () => {
  const response = await request(EMPTY_URL);
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-length"], "0");
  assert.equal(response.body.length, 0);
});

test("/api/status 与 /api/library 正常返回", async () => {
  const status = JSON.parse((await request("/api/status")).body.toString("utf8"));
  assert.equal(status.configured, true);
  assert.equal(status.readOnly, true);

  const libraryResponse = await request("/api/library");
  assert.equal(libraryResponse.status, 200);
  const library = JSON.parse(libraryResponse.body.toString("utf8"));
  assert.equal(library.trackCount, 2, "应只收录音频文件（track.mp3、empty.mp3），排除 .txt");
  const indexed = library.tracks.find((track) => track.fileName === "track.mp3");
  assert.ok(indexed, "库中应包含 track.mp3");
  assert.equal(indexed.title, "Indexed title");
  assert.equal(indexed.path, "Album/track.mp3");
});

test("全部请求结束后服务器仍存活并响应新请求", async () => {
  const response = await request("/api/status");
  assert.equal(response.status, 200, "服务器应仍可正常服务");
});
