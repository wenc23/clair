"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname);
const musicRoot = path.resolve(process.argv[2] || process.env.CLAIR_MUSIC_DIR || "");
const port = Number(process.env.CLAIR_PORT) || 8000;
const host = process.env.CLAIR_HOST || "0.0.0.0";
const publicFiles = new Set(["index.html", "styles.css", "app.js", "flac-metadata.js", "library-model.js", "theme-model.js"]);
const audioExtensions = new Set([".flac", ".wav", ".wave", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".aif", ".aiff"]);
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".flac": "audio/flac", ".wav": "audio/wav", ".wave": "audio/wav",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".opus": "audio/ogg; codecs=opus", ".aif": "audio/aiff", ".aiff": "audio/aiff",
};

if (!process.argv[2] && !process.env.CLAIR_MUSIC_DIR) {
  console.error("Provide a mapped Samba directory: node lan-server.cjs Z:\\Music");
  console.error("UNC paths are also supported: node lan-server.cjs \\\\NAS\\Music");
  process.exit(1);
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(text);
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(data));
}

function relativeFromRoot(filePath) {
  return path.relative(musicRoot, filePath).split(path.sep).join("/");
}

function resolveMusicFile(relativePath) {
  if (!relativePath || relativePath.includes("\u0000")) return "";
  const filePath = path.resolve(musicRoot, relativePath.split("/").join(path.sep));
  const relative = path.relative(musicRoot, filePath);
  return !relative || relative.startsWith("..") || path.isAbsolute(relative) ? "" : filePath;
}

async function readLibraryIndex() {
  try {
    const text = await fs.promises.readFile(path.join(musicRoot, ".Clair", "library.json"), "utf8");
    const index = JSON.parse(text);
    const result = new Map();
    for (const track of Array.isArray(index.tracks) ? index.tracks : []) {
      if (!track?.path) continue;
      const normalized = String(track.path).replaceAll("\\", "/");
      result.set(normalized, track);
      result.set(normalized.split("/").slice(1).join("/"), track);
    }
    return result;
  } catch {
    return new Map();
  }
}

async function scanMusicDirectory() {
  const rootStats = await fs.promises.stat(musicRoot);
  if (!rootStats.isDirectory()) throw new Error("The music path is not a readable directory");
  const cached = await readLibraryIndex();
  const tracks = [];
  const pending = [musicRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".Clair" || entry.name === ".Clair \u56de\u6536\u7ad9") continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !audioExtensions.has(extension)) continue;
      const stats = await fs.promises.stat(filePath);
      const relative = relativeFromRoot(filePath);
      const metadata = cached.get(relative) || {};
      tracks.push({
        path: relative, fileName: entry.name, fileSize: stats.size,
        mimeType: contentTypes[extension] || "application/octet-stream",
        format: metadata.format || extension.slice(1).toUpperCase(),
        title: metadata.title || path.basename(entry.name, extension),
        artist: metadata.artist || "", albumArtist: metadata.albumArtist || "",
        conductor: metadata.conductor || "", orchestra: metadata.orchestra || "",
        composer: metadata.composer || "", album: metadata.album || "", work: metadata.work || "",
        year: metadata.year || "", sampleRate: Number(metadata.sampleRate) || 0,
        bits: Number(metadata.bits) || 0, bitrate: Number(metadata.bitrate) || 0,
        duration: Number(metadata.duration) || 0, favorite: Boolean(metadata.favorite),
        streamUrl: `/media/${encodeURIComponent(relative)}`,
      });
    }
  }
  tracks.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
  return tracks;
}

async function serveMedia(request, response, relativePath) {
  const filePath = resolveMusicFile(relativePath);
  let stats;
  try { stats = filePath ? await fs.promises.stat(filePath) : null; } catch { stats = null; }
  if (!stats?.isFile() || !audioExtensions.has(path.extname(filePath).toLowerCase())) {
    sendText(response, 404, "Not found");
    return;
  }
  const total = stats.size;
  const headers = {
    "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600",
    "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, { ...headers, "Content-Length": total });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    // 文件可能在 stat 与 open 之间消失（Samba 挂载目录），捕获流的 error 以免进程崩溃
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) response.writeHead(404).end("Not found");
      else response.destroy();
    });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${total}` }).end();
    return;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, total - Number(match[2]));
    end = total - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= total) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${total}` }).end();
    return;
  }
  end = Math.min(end, total - 1);
  response.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${total}` });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  // 分段读取同样要防 stat 与 open 之间文件消失导致的崩溃
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on("error", () => {
    if (!response.headersSent) response.writeHead(404).end("Not found");
    else response.destroy();
  });
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  let requestedPath;
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }
  if (requestedPath.includes("\u0000")) {
    sendText(response, 400, "Bad request");
    return;
  }
  try {
    if (requestedPath === "/api/status") {
      sendJson(response, 200, { configured: true, libraryName: path.basename(musicRoot) || musicRoot, readOnly: true });
      return;
    }
    if (requestedPath === "/api/library") {
      const tracks = await scanMusicDirectory();
      sendJson(response, 200, { libraryName: path.basename(musicRoot) || musicRoot, readOnly: true, trackCount: tracks.length, tracks });
      return;
    }
    if (requestedPath.startsWith("/media/")) {
      await serveMedia(request, response, requestedPath.slice(7));
      return;
    }
  } catch (error) {
    sendJson(response, 500, { error: error.message });
    return;
  }
  const filePath = path.resolve(appRoot, `.${requestedPath}`);
  const relativePath = path.relative(appRoot, filePath).replaceAll("\\", "/");
  if ((filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) || !publicFiles.has(relativePath)) {
    sendText(response, 404, "Not found");
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    response.setHeader("Content-Type", contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    // 静态文件同样可能在 stat 与 open 之间消失，捕获流的 error 以免进程崩溃
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) response.writeHead(404).end("Not found");
      else response.destroy();
    });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
});

server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use` : error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Clair LAN server: http://<LAN-IP>:${port}`);
  console.log(`Read-only Samba library: ${musicRoot}`);
});
