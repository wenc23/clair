"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SERVER_PATH = path.resolve(__dirname, "..", "lan-server.cjs");

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitUntilListening(port) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await request(port, "/api/status");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

async function run() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "clair-lan-test-"));
  const album = path.join(temporaryRoot, "Album");
  const dataDirectory = path.join(temporaryRoot, ".Clair");
  await fs.promises.mkdir(album);
  await fs.promises.mkdir(dataDirectory);
  await fs.promises.writeFile(path.join(album, "track.mp3"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  await fs.promises.writeFile(path.join(dataDirectory, "library.json"), JSON.stringify({
    tracks: [{ path: `${path.basename(temporaryRoot)}/Album/track.mp3`, title: "Indexed title", artist: "Artist" }],
  }));

  const port = 20000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [SERVER_PATH, temporaryRoot], {
    env: { ...process.env, CLAIR_HOST: "127.0.0.1", CLAIR_PORT: String(port) },
    stdio: "ignore",
  });
  try {
    assert.equal(await waitUntilListening(port), true, "LAN server did not start");
    const status = JSON.parse((await request(port, "/api/status")).body.toString("utf8"));
    assert.equal(status.configured, true);
    assert.equal(status.readOnly, true);

    const libraryResponse = await request(port, "/api/library");
    assert.equal(libraryResponse.status, 200);
    const library = JSON.parse(libraryResponse.body.toString("utf8"));
    assert.equal(library.trackCount, 1);
    assert.equal(library.tracks[0].title, "Indexed title");
    assert.equal(library.tracks[0].path, "Album/track.mp3");

    const media = await request(port, library.tracks[0].streamUrl, { Range: "bytes=2-5" });
    assert.equal(media.status, 206);
    assert.equal(media.headers["content-range"], "bytes 2-5/10");
    assert.deepEqual([...media.body], [2, 3, 4, 5]);

    const traversal = `/media/${encodeURIComponent("../package.json")}`;
    assert.equal((await request(port, traversal)).status, 404);
    assert.equal((await request(port, "/index.html")).status, 200);
    console.log("LAN server tests passed");
  } finally {
    child.kill();
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
