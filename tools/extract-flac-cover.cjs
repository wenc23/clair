"use strict";

const fs = require("fs");
const path = require("path");

function usage() {
  return [
    "用法：node tools/extract-flac-cover.cjs <source.flac> <destination>",
    "",
    "读取 <source.flac> 的 PICTURE（封面）元数据块，把图片数据写入 <destination>",
    "（必要时自动创建目标目录）。若文件未内嵌图片，输出 “No embedded picture” 后正常退出。",
  ].join("\n");
}

function parseCliArguments(argv) {
  const positionals = [];
  for (const argument of argv.slice(2)) {
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument.startsWith("-")) throw new Error(`未知选项：${argument}\n\n${usage()}`);
    positionals.push(argument);
  }
  if (positionals.length < 2) {
    throw new Error(`缺少参数：需要 <source.flac> 与 <destination>\n\n${usage()}`);
  }
  if (positionals.length > 2) {
    throw new Error(`多余参数：${positionals.slice(2).join(" ")}\n\n${usage()}`);
  }
  return {
    help: false,
    sourcePath: path.resolve(positionals[0]),
    destinationPath: path.resolve(positionals[1]),
  };
}

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const count = fs.readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error("音频文件意外截断（Unexpected EOF）");
  return buffer;
}

function parsePicture(payload) {
  let offset = 0;
  const readU32 = () => {
    const value = payload.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const pictureType = readU32();
  const mimeLength = readU32();
  const mime = payload.subarray(offset, offset + mimeLength).toString("ascii");
  offset += mimeLength;
  const descriptionLength = readU32();
  const description = payload.subarray(offset, offset + descriptionLength).toString("utf8");
  offset += descriptionLength;
  const width = readU32();
  const height = readU32();
  const depth = readU32();
  const colors = readU32();
  const dataLength = readU32();
  const data = payload.subarray(offset, offset + dataLength);
  if (data.length !== dataLength) throw new Error("PICTURE 数据被截断");
  return { pictureType, mime, description, width, height, depth, colors, data };
}

function main(argv = process.argv) {
  const parsed = parseCliArguments(argv);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { sourcePath, destinationPath } = parsed;
  const fd = fs.openSync(sourcePath, "r");
  try {
    if (readExact(fd, 4, 0).toString("ascii") !== "fLaC") throw new Error("不是有效的 FLAC 文件（签名不符）");
    let position = 4;
    let isLast = false;
    let picture = null;
    while (!isLast) {
      const header = readExact(fd, 4, position);
      position += 4;
      isLast = Boolean(header[0] & 0x80);
      const type = header[0] & 0x7f;
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      if (type === 6 && !picture) picture = parsePicture(readExact(fd, length, position));
      position += length;
    }
    if (!picture) {
      process.stdout.write("No embedded picture\n");
    } else {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, picture.data);
      process.stdout.write(`${JSON.stringify({
        destinationPath,
        pictureType: picture.pictureType,
        mime: picture.mime,
        description: picture.description,
        width: picture.width,
        height: picture.height,
        depth: picture.depth,
        bytes: picture.data.length,
      })}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`错误：${error.message}\n`);
    process.exitCode = 1;
  }
}
