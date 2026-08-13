"use strict";

const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(process.argv[2] || "");
const destinationPath = path.resolve(process.argv[3] || "");
if (!sourcePath || !destinationPath) {
  throw new Error("Usage: node extract-flac-cover.cjs <source.flac> <destination>");
}

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const count = fs.readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error("Unexpected EOF");
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
  if (data.length !== dataLength) throw new Error("Truncated picture");
  return { pictureType, mime, description, width, height, depth, colors, data };
}

const fd = fs.openSync(sourcePath, "r");
try {
  if (readExact(fd, 4, 0).toString("ascii") !== "fLaC") throw new Error("Invalid FLAC");
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
