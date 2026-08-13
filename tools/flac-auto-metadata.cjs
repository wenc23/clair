"use strict";

// A conservative FLAC metadata helper for files newly added to a music library.
// It never guesses classical credits. It only fills blank fields from explicit
// file/folder clues or values passed with --set, and it preserves audio, artwork
// and every unrelated Vorbis comment.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseVorbisPayload, readFlac, walk } = require("./metadata-audit.cjs");

const MANAGED_KEYS = new Set([
  "TITLE", "ARTIST", "ALBUM", "DATE", "TRACKNUMBER", "DISCNUMBER",
  "COMPOSER", "CONDUCTOR", "ORCHESTRA", "WORK",
]);
const DEFAULT_SETTLE_MS = 3_000;
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_DEEPSEEK_CONFIDENCE = 0.92;
const COMPOSER_NAMES = new Map([
  ["bach", "Johann Sebastian Bach"], ["beethoven", "Ludwig van Beethoven"],
  ["brahms", "Johannes Brahms"], ["chopin", "Frédéric Chopin"],
  ["debussy", "Claude Debussy"], ["dvorak", "Antonín Dvořák"],
  ["handel", "George Frideric Handel"], ["haydn", "Joseph Haydn"],
  ["mahler", "Gustav Mahler"], ["mendelssohn", "Felix Mendelssohn"],
  ["mozart", "Wolfgang Amadeus Mozart"], ["prokofiev", "Sergei Prokofiev"],
  ["rachmaninoff", "Sergei Rachmaninoff"], ["rachmaninov", "Sergei Rachmaninoff"],
  ["ravel", "Maurice Ravel"], ["schubert", "Franz Schubert"],
  ["schumann", "Robert Schumann"], ["sibelius", "Jean Sibelius"],
  ["stravinsky", "Igor Stravinsky"], ["tchaikovsky", "Pyotr Ilyich Tchaikovsky"],
  ["vivaldi", "Antonio Vivaldi"],
]);
const ENSEMBLE_NAMES = [
  "academy of st martin in the fields", "berliner philharmoniker",
  "chamber orchestra of europe", "english chamber orchestra",
  "london symphony orchestra", "new york philharmonic",
  "orpheus chamber orchestra", "vienna philharmonic",
];

function usage() {
  return [
    "用法：node tools/flac-auto-metadata.cjs <音乐目录> [选项]",
    "",
    "默认只预览，不会修改文件。",
    "  --apply                 写入可安全补齐的标签，并备份原元数据",
    "  --watch                 持续监听新增或替换的 FLAC（需与 --apply 一起使用）",
    "  --all                   忽略处理记录，重新检查全部 FLAC",
    "  --settle-ms <毫秒>      新文件写入完成后的等待时间，默认 3000",
    "  --set KEY=VALUE         为缺失字段提供明确的默认值；可重复使用",
    "                          例如：--set ARTIST=某演奏家 --set DATE=2025",
    "  --deepseek              使用 DeepSeek 为难以解析的曲目提供精确匹配建议",
    "  --deepseek-model <模型>  默认 deepseek-v4-flash；API 密钥来自 DEEPSEEK_API_KEY",
    "  --deepseek-confidence <0-1>  自动接受建议的最低置信度，默认 0.92",
    "  --help                  显示本说明",
  ].join("\n");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseSetValue(raw) {
  const separator = raw.indexOf("=");
  if (separator < 1) throw new Error(`--set 格式应为 KEY=VALUE：${raw}`);
  const key = raw.slice(0, separator).trim().toUpperCase();
  const value = normalizeText(raw.slice(separator + 1));
  if (!MANAGED_KEYS.has(key)) throw new Error(`--set 不支持字段：${key}`);
  if (!value) throw new Error(`--set 的值不能为空：${key}`);
  return [key, value];
}

function parseArguments(argv) {
  const options = {
    apply: false,
    watch: false,
    all: false,
    settleMs: DEFAULT_SETTLE_MS,
    deepseek: false,
    deepseekModel: DEFAULT_DEEPSEEK_MODEL,
    deepseekConfidence: DEFAULT_DEEPSEEK_CONFIDENCE,
    defaults: {},
    root: "",
  };
  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "-apply") options.apply = true;
    else if (argument === "--watch") options.watch = true;
    else if (argument === "--all") options.all = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--settle-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 500 || value > 120_000) {
        throw new Error("--settle-ms 应为 500 到 120000 之间的整数");
      }
      options.settleMs = value;
    } else if (argument === "--set") {
      const value = argv[++index];
      if (!value) throw new Error("--set 缺少 KEY=VALUE");
      const [key, tagValue] = parseSetValue(value);
      options.defaults[key] = tagValue;
    } else if (argument === "--deepseek") {
      options.deepseek = true;
    } else if (argument === "--deepseek-model") {
      const value = normalizeText(argv[++index]);
      if (!/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(value)) throw new Error("--deepseek-model 格式无效");
      options.deepseekModel = value;
    } else if (argument === "--deepseek-confidence") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 0.5 || value > 1) {
        throw new Error("--deepseek-confidence 应在 0.5 到 1 之间");
      }
      options.deepseekConfidence = value;
    } else if (argument.startsWith("--")) {
      throw new Error(`未知选项：${argument}`);
    } else if (!options.root) {
      options.root = path.resolve(argument);
    } else {
      throw new Error(`多余参数：${argument}`);
    }
  }
  if (!options.help && !options.root) throw new Error("缺少音乐目录\n\n" + usage());
  if (options.watch && !options.apply) throw new Error("--watch 必须与 --apply 一起使用，避免后台意外写入文件");
  if (options.deepseek && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("已启用 --deepseek，但未设置环境变量 DEEPSEEK_API_KEY");
  }
  return options;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileStem(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function titleFromFileName(fileName) {
  const stem = fileStem(fileName)
    .replace(/^\s*(?:\d{1,2}\s*\/\s*\d{1,3}\s*|\d{1,3}\s*(?:[-._ ]\s*)?)/, "")
    .replace(/^\s*(?:track|音轨)\s*\d{1,3}\s*[-._ ]*/i, "");
  return normalizeText(stem);
}

function trackNumberFromFileName(fileName) {
  const match = fileStem(fileName).match(/^\s*(\d{1,3})(?=\s*(?:[-._ ]|\/))/);
  return match ? String(Number(match[1])) : "";
}

function discNumberFromPath(relativePath) {
  const parts = relativePath.replaceAll("\\", "/").split("/").slice(0, -1).reverse();
  for (const part of parts) {
    const match = part.match(/^(?:cd|disc|disk|碟)\s*0*(\d{1,2})$/i);
    if (match) return String(Number(match[1]));
  }
  return "";
}

function albumFromPath(relativePath) {
  const parent = path.posix.dirname(relativePath.replaceAll("\\", "/"));
  if (!parent || parent === ".") return "";
  const folder = parent.split("/").at(-1);
  if (/^(?:cd|disc|disk|碟)\s*\d{1,2}$/i.test(folder)) {
    return parent.split("/").at(-2) || "";
  }
  return normalizeText(folder);
}

function yearFromPath(relativePath) {
  const parent = path.posix.dirname(relativePath.replaceAll("\\", "/"));
  const match = parent.match(/(?:\(|\[|\s)(1[89]\d{2}|20\d{2})(?:\)|\]|\s|$)/);
  return match ? match[1] : "";
}

function existingTagMap(comments) {
  const map = new Map();
  for (const comment of comments) {
    const key = String(comment.key || "").toUpperCase();
    if (!map.has(key)) map.set(key, normalizeText(comment.value));
  }
  return map;
}

function titleCase(value) {
  return normalizeText(value).replace(/\b[\p{L}][\p{L}'’-]*/gu, (word) => {
    if (word === word.toUpperCase() && word.length > 1) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function contextFromDirectoryName(directoryName) {
  const raw = normalizeText(directoryName);
  const parts = raw.split(/\s*_\s*/).map(normalizeText).filter(Boolean);
  if (parts.length < 3) return {};
  const composer = COMPOSER_NAMES.get(parts[0].toLowerCase());
  if (!composer) return {};
  const album = titleCase(parts[1]);
  const credits = parts.slice(2, -1).join(" ");
  const movementOrSubtitle = parts.length >= 4 ? titleCase(parts.at(-1)) : "";
  const normalizedCredits = credits.toLowerCase();
  const knownEnsemble = ENSEMBLE_NAMES.find((name) => normalizedCredits.endsWith(name));
  const orchestra = knownEnsemble ? titleCase(knownEnsemble) : "";
  const artist = titleCase(knownEnsemble
    ? credits.slice(0, credits.length - knownEnsemble.length)
    : credits);
  return {
    COMPOSER: composer,
    ALBUM: album,
    ARTIST: artist,
    ...(orchestra ? { ORCHESTRA: orchestra } : {}),
    ...(movementOrSubtitle ? { WORK: `${album} — ${movementOrSubtitle}` } : { WORK: album }),
  };
}

function inferUpdates({ relativePath, fileName, comments, defaults = {}, directoryHints = [] }) {
  const tags = existingTagMap(comments);
  const changes = {};
  const contextual = directoryHints.map(contextFromDirectoryName).find((value) => Object.keys(value).length) || {};
  const candidates = {
    TITLE: titleFromFileName(fileName),
    TRACKNUMBER: trackNumberFromFileName(fileName),
    DISCNUMBER: discNumberFromPath(relativePath),
    ALBUM: contextual.ALBUM || albumFromPath(relativePath),
    DATE: yearFromPath(relativePath),
    ...contextual,
    ...defaults,
  };
  for (const [key, value] of Object.entries(candidates)) {
    if (!MANAGED_KEYS.has(key) || tags.get(key) || !normalizeText(value)) continue;
    changes[key] = normalizeText(value);
  }
  return changes;
}

function isMissingOrPlaceholder(value, key) {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  if (["-", "unknown", "untitled", "n/a", "na", "无标题", "未知"].includes(lower)) return true;
  return key === "TITLE" && /^(?:track|音轨)\s*0*\d+$/i.test(normalized);
}

function validateAiTags(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const tags = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey).toUpperCase();
    const tagValue = normalizeText(rawValue);
    if (!MANAGED_KEYS.has(key) || !tagValue || tagValue.length > 500 || /[\u0000-\u001f]/.test(tagValue)) continue;
    if (key === "DATE" && !/^\d{4}(?:-\d{2}-\d{2})?$/.test(tagValue)) continue;
    if (["TRACKNUMBER", "DISCNUMBER"].includes(key) && !/^\d{1,3}$/.test(tagValue)) continue;
    tags[key] = tagValue;
  }
  return tags;
}

function managedTagSnapshot(comments) {
  const tags = existingTagMap(comments);
  return Object.fromEntries([...tags].filter(([key]) => MANAGED_KEYS.has(key)));
}

function compareFileNames(left, right) {
  const leftNumber = trackNumberFromFileName(left);
  const rightNumber = trackNumberFromFileName(right);
  if (leftNumber && rightNumber && Number(leftNumber) !== Number(rightNumber)) return Number(leftNumber) - Number(rightNumber);
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function readSiblingSequence(filePath) {
  const directory = path.dirname(filePath);
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isFlac(entry.name))
    .map((entry) => entry.name)
    .sort(compareFileNames)
    .slice(0, 80);
  return files.map((fileName, index) => {
    try {
      const sibling = readFlac(path.join(directory, fileName));
      return {
        position: index + 1,
        fileName,
        tags: managedTagSnapshot(sibling.comments),
        durationSeconds: Math.round(sibling.duration || 0),
      };
    } catch {
      return { position: index + 1, fileName, tags: {} };
    }
  });
}

function validateAiSequence(result, sequenceLength) {
  const confidence = Number(result?.confidence);
  const tracks = new Map();
  if (!Array.isArray(result?.tracks)) return { confidence: 0, tracks, evidence: "", warning: "missing-tracks" };
  for (const candidate of result.tracks) {
    const position = Number(candidate?.position);
    if (!Number.isInteger(position) || position < 1 || position > sequenceLength || tracks.has(position)) {
      return { confidence: 0, tracks: new Map(), evidence: "", warning: "invalid-or-duplicate-position" };
    }
    tracks.set(position, validateAiTags(candidate?.tags));
  }
  const romanValues = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const numberedTitles = [...tracks].flatMap(([position, tags]) => {
    const match = tags.TITLE?.match(/(?:^|:\s*)(X|IX|VIII|VII|VI|V|IV|III|II|I)\.\s/i);
    return match ? [{ position, numeral: romanValues[match[1].toUpperCase()] }] : [];
  });
  let warning = "";
  if (numberedTitles.length >= 2 && numberedTitles.some((item) => item.position !== item.numeral)) {
    for (const tags of tracks.values()) delete tags.TITLE;
    warning = "inconsistent-roman-movement-order";
  }
  return {
    confidence: Number.isFinite(confidence) ? confidence : 0,
    tracks,
    evidence: normalizeText(result?.evidence).slice(0, 500),
    warning,
  };
}

async function requestDeepSeekSequenceMatch({ relativeDirectory, rootName, model, siblingSequence }) {
  const input = {
    rootFolder: rootName,
    relativeDirectory,
    siblingSequence,
  };
  const system = [
    "You are a meticulous classical-music cataloguer.",
    "Return JSON only. Catalog the complete ordered siblingSequence as one recording/program, not as independent tracks.",
    "Do not invent conductor, orchestra, soloist, work, opus number, catalogue number, or date.",
    "You may infer a movement TITLE only when the ordered siblingSequence, its track numbers, and its album/work clues unambiguously match a known standard work or movement sequence.",
    "For a guessed movement title, require confidence at least 0.97; otherwise leave TITLE empty.",
    "Track positions are fixed. Return each position at most once, keep non-placeholder tags untouched, and make every returned TITLE globally coherent with the full sequence. If a TITLE uses a Roman movement number, it must equal that track position.",
    "For uncertain cases return confidence below 0.92 and empty tags for the affected positions.",
    "JSON schema: {\"confidence\":0.0,\"tracks\":[{\"position\":1,\"tags\":{\"TITLE\":\"\",\"ARTIST\":\"\",\"ALBUM\":\"\",\"DATE\":\"\",\"COMPOSER\":\"\",\"CONDUCTOR\":\"\",\"ORCHESTRA\":\"\",\"WORK\":\"\",\"TRACKNUMBER\":\"\",\"DISCNUMBER\":\"\"}}],\"evidence\":\"short reason\"}",
  ].join(" ");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Catalog this complete local FLAC sequence as JSON:\n${JSON.stringify(input)}` },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.1,
      max_tokens: 3_500,
      stream: false,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500).replace(/\s+/g, " ");
    throw new Error(`DeepSeek API 请求失败（HTTP ${response.status}）：${detail}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("DeepSeek API 未返回可解析内容");
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error("DeepSeek API 返回的内容不是有效 JSON");
  }
  const validated = validateAiSequence(result, siblingSequence.length);
  return {
    confidence: validated.confidence,
    tracks: validated.tracks,
    evidence: validated.evidence,
    warning: validated.warning,
    model: payload?.model || model,
  };
}

function mergeAiUpdates(comments, deterministicUpdates, aiMatch, confidenceThreshold) {
  if (aiMatch.confidence < confidenceThreshold) return deterministicUpdates;
  const existing = existingTagMap(comments);
  const updates = { ...deterministicUpdates };
  for (const [key, value] of Object.entries(aiMatch.tags)) {
    if (updates[key] || !isMissingOrPlaceholder(existing.get(key), key)) continue;
    updates[key] = value;
  }
  return updates;
}

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const count = fs.readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error(`文件在 ${position} 字节处意外结束`);
  return buffer;
}

function readFlacLayout(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    if (readExact(fd, 4, 0).toString("ascii") !== "fLaC") throw new Error("不是有效的 FLAC 文件");
    const blocks = [];
    const prefix = [Buffer.from("fLaC", "ascii")];
    let position = 4;
    let isLast = false;
    while (!isLast) {
      const header = readExact(fd, 4, position);
      position += 4;
      isLast = Boolean(header[0] & 0x80);
      const type = header[0] & 0x7f;
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      const payload = readExact(fd, length, position);
      position += length;
      blocks.push({ type, payload });
      prefix.push(header, payload);
    }
    return { blocks, audioOffset: position, prefix: Buffer.concat(prefix) };
  } finally {
    fs.closeSync(fd);
  }
}

function metadataHeader(type, length, isLast) {
  if (length > 0xffffff) throw new Error("更新后的元数据超过 FLAC 块长度限制");
  return Buffer.from([(isLast ? 0x80 : 0) | type, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
}

function uint32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function buildVorbisPayload(vendor, comments) {
  const vendorBytes = Buffer.from(vendor || "Clair auto metadata", "utf8");
  const encoded = comments.map(({ key, value }) => Buffer.from(`${key}=${value}`, "utf8"));
  return Buffer.concat([
    uint32LE(vendorBytes.length), vendorBytes, uint32LE(encoded.length),
    ...encoded.flatMap((item) => [uint32LE(item.length), item]),
  ]);
}

function updateComments(parsed, updates) {
  const comments = parsed.comments.map((comment) => ({
    key: comment.originalKey || comment.key,
    value: String(comment.value || ""),
  }));
  for (const [key, value] of Object.entries(updates)) {
    const index = comments.findIndex((comment) => comment.key.toUpperCase() === key);
    if (index >= 0) comments[index] = { key, value };
    else comments.push({ key, value });
  }
  return comments;
}

function buildRewritePlan(filePath, updates) {
  const layout = readFlacLayout(filePath);
  const commentBlock = layout.blocks.find((block) => block.type === 4);
  const parsed = commentBlock
    ? parseVorbisPayload(commentBlock.payload)
    : { vendor: { value: "Clair auto metadata" }, comments: [] };
  if (parsed.comments.some((comment) => !comment.validUtf8)) {
    throw new Error("包含非 UTF-8 Vorbis 标签，已跳过；请先使用 metadata-repair.cjs 修复编码");
  }
  const replacement = { type: 4, payload: buildVorbisPayload(parsed.vendor?.value, updateComments(parsed, updates)) };
  const blocks = [];
  let inserted = false;
  for (const block of layout.blocks) {
    if (block.type === 4) {
      if (!inserted) blocks.push(replacement);
      inserted = true;
    } else {
      blocks.push(block);
      if (!inserted && block.type === 0 && !commentBlock) {
        blocks.push(replacement);
        inserted = true;
      }
    }
  }
  if (!inserted) blocks.push(replacement);
  const prefixParts = [Buffer.from("fLaC", "ascii")];
  blocks.forEach((block, index) => prefixParts.push(metadataHeader(block.type, block.payload.length, index === blocks.length - 1), block.payload));
  return { oldAudioOffset: layout.audioOffset, originalPrefix: layout.prefix, newPrefix: Buffer.concat(prefixParts) };
}

function hashAudio(filePath, offset) {
  const fd = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    for (let position = offset; ; position += buffer.length) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function writeFileWithOriginalAudio(sourcePath, targetPath, newPrefix, oldAudioOffset) {
  const source = fs.openSync(sourcePath, "r");
  const target = fs.openSync(targetPath, "wx");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    fs.writeSync(target, newPrefix);
    for (let position = oldAudioOffset; ; position += buffer.length) {
      const count = fs.readSync(source, buffer, 0, buffer.length, position);
      if (!count) break;
      fs.writeSync(target, buffer, 0, count);
    }
    fs.fsyncSync(target);
  } finally {
    fs.closeSync(source);
    fs.closeSync(target);
  }
}

function backupFileName(relativePath) {
  return `${crypto.createHash("sha256").update(relativePath).digest("hex")}.metadata-prefix.bin`;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function loadState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" && parsed.files ? parsed : { version: 1, files: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, files: {} };
    throw new Error(`无法读取状态文件：${error.message}`);
  }
}

function saveState(statePath, state) {
  ensureDirectory(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function currentFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
}

function sameFingerprint(left, right) {
  return left && right && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function appendLog(logPath, line) {
  ensureDirectory(path.dirname(logPath));
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

function appendJsonLine(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function applyRewrite({ filePath, relativePath, plan, updates, backupRoot }) {
  ensureDirectory(backupRoot);
  const backupPath = path.join(backupRoot, backupFileName(relativePath));
  fs.writeFileSync(backupPath, plan.originalPrefix, { flag: "wx" });
  const originalAudioHash = hashAudio(filePath, plan.oldAudioOffset);
  const temporaryPath = `${filePath}.clair-auto-${process.pid}.tmp`;
  const originalPath = `${filePath}.clair-original-${process.pid}.tmp`;
  writeFileWithOriginalAudio(filePath, temporaryPath, plan.newPrefix, plan.oldAudioOffset);
  fs.renameSync(filePath, originalPath);
  try {
    fs.renameSync(temporaryPath, filePath);
    const verified = readFlac(filePath);
    const newLayout = readFlacLayout(filePath);
    if (hashAudio(filePath, newLayout.audioOffset) !== originalAudioHash) throw new Error("校验失败：音频数据发生变化");
    const tags = existingTagMap(verified.comments);
    for (const [key, value] of Object.entries(updates)) {
      if (tags.get(key) !== value) throw new Error(`校验失败：${key} 未正确写入`);
    }
    fs.unlinkSync(originalPath);
    return { backupPath, audioSha256: originalAudioHash };
  } catch (error) {
    if (fs.existsSync(filePath)) fs.renameSync(filePath, temporaryPath);
    fs.renameSync(originalPath, filePath);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function isFlac(filePath) {
  return path.extname(filePath).toLowerCase() === ".flac";
}

function isInsideClair(root, filePath) {
  const relativePath = path.relative(root, filePath).replaceAll("\\", "/");
  return relativePath === ".Clair" || relativePath.startsWith(".Clair/") || relativePath.startsWith(".Clair 回收站/");
}

function createProcessor(options) {
  const clairRoot = path.join(options.root, ".Clair");
  const statePath = path.join(clairRoot, "auto-metadata-state.json");
  const logPath = path.join(clairRoot, "auto-metadata.log");
  const reviewPath = path.join(clairRoot, "deepseek-metadata-review.jsonl");
  const backupRoot = path.join(clairRoot, "metadata-backups", `auto-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const state = loadState(statePath);
  const aiSequenceCache = new Map();

  async function getAiSequence(filePath) {
    const directory = path.resolve(path.dirname(filePath));
    if (!aiSequenceCache.has(directory)) {
      const siblingSequence = readSiblingSequence(filePath);
      const relativeDirectory = path.relative(options.root, directory).replaceAll("\\", "/") || ".";
      aiSequenceCache.set(directory, (async () => ({
        siblingSequence,
        match: await requestDeepSeekSequenceMatch({
          relativeDirectory,
          rootName: path.basename(options.root),
          model: options.deepseekModel,
          siblingSequence,
        }),
      }))());
    }
    return aiSequenceCache.get(directory);
  }

  async function processFile(filePath) {
    if (!isFlac(filePath) || isInsideClair(options.root, filePath)) return { status: "ignored" };
    const relativePath = path.relative(options.root, filePath).replaceAll("\\", "/");
    const fingerprint = currentFingerprint(filePath);
    const previous = state.files[relativePath];
    const needsDeepSeekPass = options.deepseek && !previous?.deepseek;
    if (!options.all && !needsDeepSeekPass && sameFingerprint(previous?.fingerprint, fingerprint)) {
      return { status: "already-processed", relativePath };
    }
    const parsed = readFlac(filePath);
    const directoryHints = [path.basename(options.root)];
    const relativeParent = path.posix.dirname(relativePath);
    if (relativeParent && relativeParent !== ".") directoryHints.push(...relativeParent.split("/").reverse());
    const deterministicUpdates = inferUpdates({
      relativePath,
      fileName: path.basename(filePath),
      comments: parsed.comments,
      defaults: options.defaults,
      directoryHints,
    });
    let aiMatch = null;
    let updates = deterministicUpdates;
    if (options.deepseek) {
      const sequenceResult = await getAiSequence(filePath);
      const position = sequenceResult.siblingSequence.find((item) => item.fileName === path.basename(filePath))?.position;
      aiMatch = {
        confidence: sequenceResult.match.confidence,
        tags: sequenceResult.match.tracks.get(position) || {},
        evidence: sequenceResult.match.evidence,
        warning: sequenceResult.match.warning,
        model: sequenceResult.match.model,
      };
      updates = mergeAiUpdates(parsed.comments, deterministicUpdates, aiMatch, options.deepseekConfidence);
      appendJsonLine(reviewPath, {
        at: new Date().toISOString(),
        path: relativePath,
        model: aiMatch.model,
        confidence: aiMatch.confidence,
        evidence: aiMatch.evidence,
        validationWarning: aiMatch.warning,
        suggestedTags: aiMatch.tags,
        acceptedTags: updates,
        threshold: options.deepseekConfidence,
        matchingScope: "directory-sequence",
        applied: options.apply,
      });
    }
    if (!Object.keys(updates).length) {
      if (options.apply) {
        state.files[relativePath] = {
          fingerprint,
          processedAt: new Date().toISOString(),
          updates: {},
          deepseek: Boolean(options.deepseek),
          ai: aiMatch && { model: aiMatch.model, confidence: aiMatch.confidence, evidence: aiMatch.evidence, warning: aiMatch.warning },
        };
        saveState(statePath, state);
      }
      return { status: "unchanged", relativePath, aiMatch };
    }
    if (!options.apply) return { status: "preview", relativePath, updates, aiMatch };
    const plan = buildRewritePlan(filePath, updates);
    const result = applyRewrite({ filePath, relativePath, plan, updates, backupRoot });
    state.files[relativePath] = {
      fingerprint: currentFingerprint(filePath),
      processedAt: new Date().toISOString(),
      updates,
      backup: path.relative(options.root, result.backupPath).replaceAll("\\", "/"),
      audioSha256: result.audioSha256,
      deepseek: Boolean(options.deepseek),
      ai: aiMatch && { model: aiMatch.model, confidence: aiMatch.confidence, evidence: aiMatch.evidence, warning: aiMatch.warning },
    };
    saveState(statePath, state);
    appendLog(logPath, `已写入 ${relativePath} · ${Object.entries(updates).map(([key, value]) => `${key}=${value}`).join("; ")}`);
    return { status: "updated", relativePath, updates, aiMatch };
  }

  return { processFile, statePath, logPath, reviewPath, backupRoot };
}

function printResult(result) {
  if (result.status === "preview" || result.status === "updated") {
    process.stdout.write(`${result.status === "preview" ? "预览" : "已更新"} ${result.relativePath}\n`);
    for (const [key, value] of Object.entries(result.updates)) process.stdout.write(`  ${key} = ${value}\n`);
  } else if (result.status === "unchanged") {
    process.stdout.write(`无需补充 ${result.relativePath}\n`);
  }
}

async function scan(options, processor) {
  const files = walk(options.root).filter((filePath) => isFlac(filePath) && !isInsideClair(options.root, filePath));
  const totals = { scanned: files.length, preview: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  for (const filePath of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    try {
      const result = await processor.processFile(filePath);
      printResult(result);
      if (result.status === "preview") totals.preview++;
      else if (result.status === "updated") totals.updated++;
      else if (result.status === "unchanged") totals.unchanged++;
      else totals.skipped++;
    } catch (error) {
      totals.errors++;
      process.stderr.write(`跳过 ${path.relative(options.root, filePath)}：${error.message}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify(totals)}\n`);
  return totals;
}

function watch(options, processor) {
  const pending = new Map();
  const queue = (filePath) => {
    if (!isFlac(filePath) || isInsideClair(options.root, filePath)) return;
    clearTimeout(pending.get(filePath));
    pending.set(filePath, setTimeout(async () => {
      pending.delete(filePath);
      if (!fs.existsSync(filePath)) return;
      try {
        printResult(await processor.processFile(filePath));
      } catch (error) {
        process.stderr.write(`跳过 ${path.relative(options.root, filePath)}：${error.message}\n`);
      }
    }, options.settleMs));
  };
  fs.watch(options.root, { recursive: true }, (_event, fileName) => {
    if (fileName) queue(path.resolve(options.root, fileName.toString()));
  });
  process.stdout.write(`正在监听新增 FLAC：${options.root}\n按 Ctrl+C 停止。\n`);
}

async function main() {
  const options = parseArguments(process.argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!fs.statSync(options.root).isDirectory()) throw new Error(`不是目录：${options.root}`);
  const processor = createProcessor(options);
  const totals = await scan(options, processor);
  if (options.apply) {
    process.stdout.write(`状态记录：${processor.statePath}\n`);
    process.stdout.write(`备份目录：${processor.backupRoot}\n`);
  }
  if (options.deepseek) process.stdout.write(`DeepSeek 审核记录：${processor.reviewPath}\n`);
  if (options.watch) watch(options, processor);
  else if (totals.errors) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  albumFromPath,
  discNumberFromPath,
  inferUpdates,
  isMissingOrPlaceholder,
  mergeAiUpdates,
  parseArguments,
  readSiblingSequence,
  validateAiSequence,
  validateAiTags,
  titleFromFileName,
  trackNumberFromFileName,
  yearFromPath,
};
