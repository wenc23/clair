const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname);
const port = Number(process.env.CLAIR_PORT) || 8000;
const publicFiles = new Set(["index.html", "styles.css", "app.js", "flac-metadata.js", "library-model.js"]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);
  const relativePath = path.relative(root, filePath).replaceAll("\\", "/");

  if (
    (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) ||
    !publicFiles.has(relativePath)
  ) {
    response.writeHead(404).end("Not found");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    );
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(filePath).pipe(response);
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。Clair 可能已经在运行：`);
    console.error(`http://127.0.0.1:${port}`);
    console.error("如需启动另一个实例，可执行：");
    console.error("$env:CLAIR_PORT=8001; node server.cjs");
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Clair 已启动：http://127.0.0.1:${port}`);
});
