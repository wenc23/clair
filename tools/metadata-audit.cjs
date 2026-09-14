"use strict";

const fs = require("fs");
const path = require("path");

const AUDIO_EXTENSIONS = new Set([".flac", ".mp3"]);
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const utf8 = new TextDecoder("utf-8");
const gb18030 = new TextDecoder("gb18030");
const shiftJis = new TextDecoder("shift_jis");

function decodeBytes(bytes) {
  try {
    return { value: utf8Fatal.decode(bytes), encoding: "utf-8", validUtf8: true };
  } catch {
    return {
      value: utf8.decode(bytes),
      encoding: "invalid-utf8",
      validUtf8: false,
      candidates: {
        gb18030: gb18030.decode(bytes),
        shiftJis: shiftJis.decode(bytes),
      },
    };
  }
}

function uint32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function synchsafe(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f);
}

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const count = fs.readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error(`Unexpected EOF at ${position}`);
  return buffer;
}

function parseVorbisPayload(payload) {
  let offset = 0;
  if (payload.length < 8) throw new Error("Vorbis comment block is truncated");
  const vendorLength = uint32LE(payload, offset);
  offset += 4;
  if (offset + vendorLength + 4 > payload.length) throw new Error("Invalid Vorbis vendor length");
  const vendor = decodeBytes(payload.subarray(offset, offset + vendorLength));
  offset += vendorLength;
  const count = uint32LE(payload, offset);
  offset += 4;
  const comments = [];
  for (let index = 0; index < count; index++) {
    if (offset + 4 > payload.length) throw new Error("Invalid Vorbis comment count");
    const length = uint32LE(payload, offset);
    offset += 4;
    if (offset + length > payload.length) throw new Error("Invalid Vorbis comment length");
    const raw = payload.subarray(offset, offset + length);
    offset += length;
    const decoded = decodeBytes(raw);
    const separator = decoded.value.indexOf("=");
    const originalKey = separator >= 0 ? decoded.value.slice(0, separator) : "";
    comments.push({
      key: originalKey.toUpperCase(),
      originalKey,
      value: separator >= 0 ? decoded.value.slice(separator + 1) : decoded.value,
      encoding: decoded.encoding,
      validUtf8: decoded.validUtf8,
      candidates: decoded.candidates,
      rawBase64: decoded.validUtf8 ? undefined : raw.toString("base64"),
    });
  }
  return { vendor, comments };
}

function parseStreamInfo(payload) {
  if (payload.length !== 34) return {};
  let packed = 0n;
  for (const byte of payload.subarray(10, 18)) packed = (packed << 8n) | BigInt(byte);
  const sampleRate = Number(packed >> 44n);
  const channels = Number((packed >> 41n) & 0x7n) + 1;
  const bitsPerSample = Number((packed >> 36n) & 0x1fn) + 1;
  const totalSamples = Number(packed & 0xfffffffffn);
  return {
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    duration: sampleRate ? totalSamples / sampleRate : 0,
  };
}

function readFlac(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const signature = readExact(fd, 4, 0).toString("ascii");
    if (signature !== "fLaC") throw new Error("Invalid FLAC signature");
    let position = 4;
    let isLast = false;
    let comments = [];
    let vendor = null;
    let streamInfo = {};
    let blockCount = 0;
    while (!isLast) {
      const header = readExact(fd, 4, position);
      position += 4;
      isLast = Boolean(header[0] & 0x80);
      const type = header[0] & 0x7f;
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      blockCount++;
      if (type === 0 || type === 4) {
        const payload = readExact(fd, length, position);
        if (type === 0) streamInfo = parseStreamInfo(payload);
        const parsed = type === 4 ? parseVorbisPayload(payload) : null;
        if (!parsed) {
          position += length;
          continue;
        }
        comments = parsed.comments;
        vendor = parsed.vendor;
      }
      position += length;
    }
    return { format: "FLAC", blockCount, metadataBytes: position, ...streamInfo, vendor, comments };
  } finally {
    fs.closeSync(fd);
  }
}

function decodeUtf16Be(bytes) {
  const swapped = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return new TextDecoder("utf-16le").decode(swapped);
}

function decodeId3Text(payload) {
  if (!payload.length) return "";
  const encoding = payload[0];
  let bytes = payload.subarray(1);
  let value;
  if (encoding === 0) value = new TextDecoder("windows-1252").decode(bytes);
  else if (encoding === 3) value = utf8.decode(bytes);
  else if (encoding === 2) value = decodeUtf16Be(bytes);
  else {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) value = decodeUtf16Be(bytes.subarray(2));
    else {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) bytes = bytes.subarray(2);
      value = new TextDecoder("utf-16le").decode(bytes);
    }
  }
  return value.replace(/\0+$/g, "").trim();
}

function readMp3(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = readExact(fd, 10, 0);
    if (header.subarray(0, 3).toString("ascii") !== "ID3") {
      return { format: "MP3", version: null, comments: [] };
    }
    const version = header[3];
    const tagSize = synchsafe(header, 6);
    const tag = readExact(fd, tagSize, 10);
    const comments = [];
    let offset = 0;
    while (offset + 10 <= tag.length) {
      const frameId = tag.subarray(offset, offset + 4).toString("ascii");
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
      const size = version === 4 ? synchsafe(tag, offset + 4) : tag.readUInt32BE(offset + 4);
      if (size <= 0 || offset + 10 + size > tag.length) break;
      if (/^T[A-Z0-9]{3}$/.test(frameId) && frameId !== "TXXX") {
        comments.push({
          key: frameId,
          value: decodeId3Text(tag.subarray(offset + 10, offset + 10 + size)),
          encoding: `id3-${tag[offset + 10]}`,
          validUtf8: true,
        });
      }
      offset += 10 + size;
    }
    return { format: "MP3", version: `2.${version}`, comments };
  } finally {
    fs.closeSync(fd);
  }
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function suspiciousText(value) {
  return /[\uFFFD]|(?:Ã.|Â.|锟斤拷|闁|濞|缁|浣犲ソ)/u.test(value);
}

function usage() {
  return [
    "用法：node tools/metadata-audit.cjs [选项] <音乐目录> [输出JSON]",
    "",
    "递归扫描 <音乐目录> 下的 .flac/.mp3，检查元数据完整性、编码与可疑文本，",
    "将摘要打印到标准输出；传入 [输出JSON] 时同时写入完整 JSON 报告。",
    "",
    "选项：",
    "  --help, -h            显示本帮助并退出",
    "  --fail-on-issues      发现任何错误（errors / invalidUtf8 / suspiciousText 大于 0）",
    "                        时以退出码 1 结束，便于接入 CI",
  ].join("\n");
}

function parseCliArguments(argv) {
  const options = { root: ".", outputPath: null, help: false, failOnIssues: false };
  const positionals = [];
  for (const argument of argv.slice(2)) {
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--fail-on-issues") options.failOnIssues = true;
    else if (argument.startsWith("-")) {
      throw new Error(`未知选项：${argument}\n\n${usage()}`);
    } else {
      positionals.push(argument);
    }
  }
  if (positionals.length > 2) {
    throw new Error(`多余参数：${positionals.slice(2).join(" ")}\n\n${usage()}`);
  }
  if (positionals[0]) options.root = path.resolve(positionals[0]);
  if (positionals[1]) options.outputPath = path.resolve(positionals[1]);
  return options;
}

function main(argv = process.argv) {
  let options;
  try {
    options = parseCliArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = options.root;
  const outputPath = options.outputPath;
  const files = walk(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const records = [];
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    try {
      const parsed = path.extname(filePath).toLowerCase() === ".flac"
        ? readFlac(filePath)
        : readMp3(filePath);
      const tags = {};
      for (const comment of parsed.comments) {
        if (!tags[comment.key]) tags[comment.key] = [];
        tags[comment.key].push(comment.value);
      }
      const invalidUtf8 = parsed.comments.filter((comment) => !comment.validUtf8);
      const suspicious = parsed.comments.filter((comment) => suspiciousText(comment.value));
      records.push({
        path: path.relative(root, filePath).replaceAll("\\", "/"),
        size: stat.size,
        ...parsed,
        tags,
        invalidUtf8,
        suspicious,
      });
    } catch (error) {
      records.push({
        path: path.relative(root, filePath).replaceAll("\\", "/"),
        size: stat.size,
        error: error.message,
      });
    }
  }
  const canonical = ["TITLE", "ARTIST", "ALBUM", "DATE", "COMPOSER", "CONDUCTOR", "ORCHESTRA"];
  const summary = {
    root,
    scannedAt: new Date().toISOString(),
    total: records.length,
    formats: Object.fromEntries(
      [...new Set(records.map((record) => record.format || "ERROR"))]
        .map((format) => [format, records.filter((record) => (record.format || "ERROR") === format).length])
    ),
    errors: records.filter((record) => record.error).length,
    invalidUtf8: records.filter((record) => record.invalidUtf8?.length).length,
    suspiciousText: records.filter((record) => record.suspicious?.length).length,
    missing: Object.fromEntries(canonical.map((key) => [
      key,
      records.filter((record) => !record.error && !record.tags?.[key]?.some(Boolean)).length,
    ])),
  };
  const result = { summary, records };
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  for (const record of records.filter((item) => item.error || item.invalidUtf8?.length || item.suspicious?.length)) {
    process.stdout.write(`${JSON.stringify({
      path: record.path,
      error: record.error,
      invalidUtf8: record.invalidUtf8,
      suspicious: record.suspicious,
    }, null, 2)}\n`);
  }
  if (options.failOnIssues
    && (summary.errors > 0 || summary.invalidUtf8 > 0 || summary.suspiciousText > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  decodeBytes,
  parseVorbisPayload,
  parseStreamInfo,
  readFlac,
  readMp3,
  suspiciousText,
  walk,
};
