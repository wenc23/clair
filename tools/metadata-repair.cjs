"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  parseVorbisPayload,
  readFlac,
  readMp3,
  walk,
} = require("./metadata-audit.cjs");

const APPLY = process.argv.includes("--apply");
const INCLUDE_TRASH = process.argv.includes("--include-trash");
const rootArg = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
if (!rootArg) throw new Error("Usage: node metadata-repair.cjs <music-root> [--apply]");

const ROOT = path.resolve(rootArg);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_ROOT = path.join(ROOT, ".Clair", `metadata-repair-${RUN_ID}`);
const MANUAL_FIXES = new Map([
  ["artchive/宇多田光-one last kiss.flac", {
    TITLE: "One Last Kiss",
    ARTIST: "宇多田光",
    ALBUM: "One Last Kiss",
  }],
  ["artchive/Hotel California 加州旅馆（老鹰乐队）.flac", {
    TITLE: "Hotel California 加州旅馆",
    ARTIST: "老鹰乐队",
  }],
  ["artchive/トゲナシトゲアリ-雑踏、仆らの街.flac", {
    TITLE: "雑踏、仆らの街",
    ARTIST: "トゲナシトゲアリ",
  }],
  ["artchive/Beautiful World-宇多田ヒカル#9FnK.mp3", {
    TIT2: "Beautiful World",
    TPE1: "宇多田光",
    TALB: "Beautiful World / Kiss & Cry",
  }],
]);

function addManualFix(relativePath, tags) {
  MANUAL_FIXES.set(relativePath, tags);
}

const beethovenCommon = {
  ARTIST: "Berliner Philharmoniker",
  ALBUM: "Beethoven: Symphony No. 9",
  DATE: "2000",
  COMPOSER: "Ludwig van Beethoven",
  CONDUCTOR: "Claudio Abbado",
  ORCHESTRA: "Berliner Philharmoniker",
  WORK: "Symphony No. 9 in D Minor, Op. 125 “Choral”",
};
[
  "I. Allegro ma non troppo, un poco maestoso",
  "II. Molto vivace",
  "III. Adagio molto e cantabile",
  "IV. Presto – Allegro assai",
  "IV. Presto – “O Freunde, nicht diese Töne!”",
].forEach((title, index) => addManualFix(
  `EAC/BEETHOVEN SYMPHONIE NO.9_ABBADO/0${index + 1} 音轨0${index + 1}.flac`,
  { ...beethovenCommon, TITLE: title, TRACKNUMBER: String(index + 1).padStart(2, "0") }
));

const mendelssohnCommon = {
  ARTIST: "Sarah Chang",
  ALBUM: "Mendelssohn & Sibelius: Violin Concertos",
  DATE: "1998",
  COMPOSER: "Felix Mendelssohn",
  CONDUCTOR: "Mariss Jansons",
  ORCHESTRA: "Berliner Philharmoniker",
  WORK: "Violin Concerto in E Minor, Op. 64",
};
[
  "I. Allegro molto appassionato",
  "II. Andante – Allegretto non troppo",
  "III. Allegro molto vivace",
].forEach((title, index) => addManualFix(
  `EAC/MENDELSSOHN E小调小提琴协奏曲/0${index + 1} 音轨0${index + 1}.flac`,
  { ...mendelssohnCommon, TITLE: title, TRACKNUMBER: String(index + 1).padStart(2, "0") }
));

const sibeliusCommon = {
  ARTIST: "Sarah Chang",
  ALBUM: "Mendelssohn & Sibelius: Violin Concertos",
  DATE: "1998",
  COMPOSER: "Jean Sibelius",
  CONDUCTOR: "Mariss Jansons",
  ORCHESTRA: "Berliner Philharmoniker",
  WORK: "Violin Concerto in D Minor, Op. 47",
};
[
  "I. Allegro moderato",
  "II. Adagio di molto",
  "III. Allegro ma non tanto",
].forEach((title, index) => {
  const trackNumber = index + 4;
  addManualFix(
    `EAC/SIBELIUS D小调小提琴协奏曲/0${trackNumber} 音轨0${trackNumber}.flac`,
    { ...sibeliusCommon, TITLE: title, TRACKNUMBER: String(trackNumber).padStart(2, "0") }
  );
});

const rachmaninoffCommon = {
  ARTIST: "London Symphony Orchestra",
  ALBUM: "Rachmaninoff: Symphony No. 2",
  DATE: "1973",
  COMPOSER: "Sergei Rachmaninoff",
  CONDUCTOR: "André Previn",
  ORCHESTRA: "London Symphony Orchestra",
  WORK: "Symphony No. 2 in E Minor, Op. 27",
};
[
  "I. Largo – Allegro moderato",
  "II. Scherzo (Allegro molto)",
  "III. Adagio",
  "IV. Allegro vivace",
].forEach((title, index) => addManualFix(
  `EAC/RACHMANINOV Symphony No.2_PREVIN/0${index + 1} 音轨0${index + 1}.flac`,
  { ...rachmaninoffCommon, TITLE: title, TRACKNUMBER: String(index + 1).padStart(2, "0") }
));

addManualFix("EAC/IRIS OUT/IRIS OUT.flac", {
  TITLE: "IRIS OUT",
  ARTIST: "米津玄師",
  ALBUM: "IRIS OUT / JANE DOE",
  DATE: "2025",
  TRACKNUMBER: "01",
});
addManualFix("EAC/IRIS OUT/JANE DOE.flac", {
  TITLE: "JANE DOE",
  ARTIST: "米津玄師, 宇多田ヒカル",
  ALBUM: "IRIS OUT / JANE DOE",
  DATE: "2025",
  TRACKNUMBER: "02",
});

[
  ["One Last Kiss.flac", "One Last Kiss", "01"],
  ["Beautiful World (Da Capo Version).flac", "Beautiful World (Da Capo Version)", "02"],
  ["Beautiful World -2021 Remastered-.flac", "Beautiful World -2021 Remastered-", "03"],
  ["Beautiful World (PLANiTb Acoustica Mix) -2021 Remastered-.flac", "Beautiful World (PLANiTb Acoustica Mix) -2021 Remastered-", "04"],
  ["桜流し -2021 Remastered-.flac", "桜流し -2021 Remastered-", "05"],
  ["Fly Me To The Moon (In Other Words) (2007 MIX) -2021 Remastered-.flac", "Fly Me to the Moon (In Other Words) (2007 MIX) -2021 Remastered-", "06"],
  ["One Last Kiss (Instrumental).flac", "One Last Kiss (Instrumental)", "07"],
  ["Beautiful World (Da Capo Version) (Instrumental).flac", "Beautiful World (Da Capo Version) (Instrumental)", "08"],
].forEach(([fileName, title, trackNumber]) => addManualFix(
  `EAC/one last kiss/${fileName}`,
  {
    TITLE: title,
    ARTIST: "宇多田ヒカル",
    ALBUM: "One Last Kiss",
    DATE: "2021",
    TRACKNUMBER: trackNumber,
  }
));
const CANONICAL_KEYS = new Set([
  "TITLE", "ARTIST", "ALBUM", "DATE", "YEAR", "TYER", "COMPOSER",
  "CONDUCTOR", "ORCHESTRA", "WORK", "TRACKNUMBER", "DISCNUMBER",
]);

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const count = fs.readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error(`Unexpected EOF at ${position}`);
  return buffer;
}

function parseFlacLayout(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const signature = readExact(fd, 4, 0);
    if (signature.toString("ascii") !== "fLaC") throw new Error("Invalid FLAC signature");
    const blocks = [];
    const prefixParts = [signature];
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
      prefixParts.push(header, payload);
    }
    return {
      blocks,
      audioOffset: position,
      originalPrefix: Buffer.concat(prefixParts),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function metadataHeader(type, length, isLast) {
  if (length > 0xffffff) throw new Error("FLAC metadata block exceeds 16 MB");
  return Buffer.from([
    (isLast ? 0x80 : 0) | type,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

function uint32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function buildVorbisPayload(vendor, comments) {
  const vendorBytes = Buffer.from(vendor || "Clair metadata repair", "utf8");
  const commentBytes = comments.map((comment) =>
    Buffer.from(`${comment.key}=${comment.value}`, "utf8")
  );
  const parts = [uint32LE(vendorBytes.length), vendorBytes, uint32LE(commentBytes.length)];
  for (const bytes of commentBytes) parts.push(uint32LE(bytes.length), bytes);
  return Buffer.concat(parts);
}

function normalizedComments(parsed, reasons) {
  const comments = [];
  for (const comment of parsed.comments) {
    let key = comment.originalKey || comment.key;
    let value = comment.value;
    if (!comment.validUtf8) {
      const recovered = comment.candidates?.gb18030 || "";
      const separator = recovered.indexOf("=");
      if (separator < 1) throw new Error(`Unable to recover invalid comment ${comment.key}`);
      key = recovered.slice(0, separator).toUpperCase();
      value = recovered.slice(separator + 1).trim();
      reasons.add("repair-invalid-utf8");
    }
    const upperKey = key.toUpperCase();
    if (!String(value).trim()) {
      reasons.add("remove-empty-tags");
      continue;
    }
    const isSpam = /^(COMMENT|DESCRIPTION)$/i.test(upperKey)
      && /(?:https?:\/\/|www\.)/i.test(value)
      && /(?:无损|音樂|音乐|下載|下载|xmwav|aiyiny)/i.test(value);
    if (isSpam) {
      reasons.add("remove-download-site-advertising");
      continue;
    }
    if (CANONICAL_KEYS.has(upperKey)) value = String(value).trim();
    comments.push({ key, value: String(value) });
  }
  const hasDate = comments.some((comment) => comment.key.toUpperCase() === "DATE");
  const yearAlias = comments.find((comment) =>
    ["YEAR", "TYER"].includes(comment.key.toUpperCase()) && /^\d{4}(?:-\d{2}-\d{2})?$/.test(comment.value)
  );
  if (!hasDate && yearAlias) {
    comments.push({ key: "DATE", value: yearAlias.value.slice(0, 10) });
    reasons.add("add-canonical-date");
  }
  return comments;
}

function setTag(comments, key, value, reasons, { force = false } = {}) {
  const upperKey = key.toUpperCase();
  const existing = comments.find((comment) => comment.key.toUpperCase() === upperKey);
  if (existing) {
    if (force && existing.value !== value) {
      existing.key = key;
      existing.value = value;
      reasons.add(`set-${key.toLowerCase()}`);
    } else if (!existing.value.trim()) {
      existing.key = key;
      existing.value = value;
      reasons.add(`fill-${key.toLowerCase()}`);
    }
    return;
  }
  comments.push({ key, value });
  reasons.add(`fill-${key.toLowerCase()}`);
}

function flacRepairPlan(filePath, relativePath) {
  const layout = parseFlacLayout(filePath);
  const commentBlock = layout.blocks.find((block) => block.type === 4);
  const parsed = commentBlock
    ? parseVorbisPayload(commentBlock.payload)
    : { vendor: { value: "Clair metadata repair" }, comments: [] };
  const reasons = new Set();
  const comments = normalizedComments(parsed, reasons);
  const manual = MANUAL_FIXES.get(relativePath);
  if (manual) {
    for (const [key, value] of Object.entries(manual)) {
      setTag(comments, key, value, reasons, { force: true });
    }
  }
  if (!reasons.size) return null;
  const replacement = {
    type: 4,
    payload: buildVorbisPayload(parsed.vendor?.value, comments),
  };
  const rebuiltBlocks = [];
  let inserted = false;
  for (const block of layout.blocks) {
    if (block.type === 4) {
      if (!inserted) rebuiltBlocks.push(replacement);
      inserted = true;
    } else {
      rebuiltBlocks.push(block);
      if (!inserted && block.type === 0 && !commentBlock) {
        rebuiltBlocks.push(replacement);
        inserted = true;
      }
    }
  }
  if (!inserted) rebuiltBlocks.push(replacement);
  const prefixParts = [Buffer.from("fLaC", "ascii")];
  rebuiltBlocks.forEach((block, index) => {
    prefixParts.push(metadataHeader(block.type, block.payload.length, index === rebuiltBlocks.length - 1));
    prefixParts.push(block.payload);
  });
  return {
    format: "FLAC",
    reasons: [...reasons],
    oldAudioOffset: layout.audioOffset,
    originalPrefix: layout.originalPrefix,
    newPrefix: Buffer.concat(prefixParts),
    beforeTags: parsed.comments.map((comment) => `${comment.key}=${comment.value}`),
    afterTags: comments.map((comment) => `${comment.key}=${comment.value}`),
  };
}

function synchsafe(value) {
  return Buffer.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function mp3AudioOffset(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = readExact(fd, 10, 0);
    if (header.subarray(0, 3).toString("ascii") !== "ID3") return 0;
    const tagSize = ((header[6] & 0x7f) << 21)
      | ((header[7] & 0x7f) << 14)
      | ((header[8] & 0x7f) << 7)
      | (header[9] & 0x7f);
    return 10 + tagSize;
  } finally {
    fs.closeSync(fd);
  }
}

function id3TextFrame(id, value) {
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")]);
  return Buffer.concat([
    Buffer.from(id, "ascii"),
    synchsafe(payload.length),
    Buffer.from([0, 0]),
    payload,
  ]);
}

function mp3RepairPlan(filePath, relativePath) {
  const manual = MANUAL_FIXES.get(relativePath);
  if (!manual) return null;
  const existing = readMp3(filePath);
  if (existing.comments.length) return null;
  const frames = Object.entries(manual).map(([key, value]) => id3TextFrame(key, value));
  const body = Buffer.concat(frames);
  const prefix = Buffer.concat([
    Buffer.from("ID3", "ascii"),
    Buffer.from([4, 0, 0]),
    synchsafe(body.length),
    body,
  ]);
  return {
    format: "MP3",
    reasons: ["add-id3v2-tags"],
    oldAudioOffset: mp3AudioOffset(filePath),
    originalPrefix: Buffer.alloc(0),
    newPrefix: prefix,
    beforeTags: [],
    afterTags: Object.entries(manual).map(([key, value]) => `${key}=${value}`),
  };
}

function sha256Region(filePath, start) {
  const fd = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let position = start;
  try {
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function writeRebuiltFile(sourcePath, destinationPath, prefix, audioOffset) {
  const sourceFd = fs.openSync(sourcePath, "r");
  const destinationFd = fs.openSync(destinationPath, "wx");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let readPosition = audioOffset;
  try {
    fs.writeSync(destinationFd, prefix);
    while (true) {
      const count = fs.readSync(sourceFd, buffer, 0, buffer.length, readPosition);
      if (!count) break;
      fs.writeSync(destinationFd, buffer, 0, count);
      readPosition += count;
    }
    fs.fsyncSync(destinationFd);
  } finally {
    fs.closeSync(sourceFd);
    fs.closeSync(destinationFd);
  }
}

function backupName(relativePath) {
  return `${crypto.createHash("sha256").update(relativePath).digest("hex")}.prefix.bin`;
}

function validateRepaired(filePath, plan, expectedAudioHash) {
  const parsed = plan.format === "FLAC" ? readFlac(filePath) : readMp3(filePath);
  if (!parsed.comments.length) throw new Error("Repaired file has no readable tags");
  if (plan.format === "FLAC" && parsed.comments.some((comment) => !comment.validUtf8)) {
    throw new Error("Repaired FLAC still contains invalid UTF-8");
  }
  const newOffset = plan.format === "FLAC"
    ? parseFlacLayout(filePath).audioOffset
    : mp3AudioOffset(filePath);
  const actualAudioHash = sha256Region(filePath, newOffset);
  if (actualAudioHash !== expectedAudioHash) throw new Error("Audio payload hash changed");
  return { newOffset, audioSha256: actualAudioHash };
}

function applyPlan(filePath, relativePath, plan, manifest) {
  const prefixFile = backupName(relativePath);
  fs.writeFileSync(path.join(BACKUP_ROOT, prefixFile), plan.originalPrefix, { flag: "wx" });
  const beforeStat = fs.statSync(filePath);
  const audioHash = sha256Region(filePath, plan.oldAudioOffset);
  const newPath = `${filePath}.clair-new-${process.pid}.tmp`;
  const originalPath = `${filePath}.clair-original-${process.pid}.tmp`;
  writeRebuiltFile(filePath, newPath, plan.newPrefix, plan.oldAudioOffset);
  fs.renameSync(filePath, originalPath);
  try {
    fs.renameSync(newPath, filePath);
  } catch (error) {
    fs.renameSync(originalPath, filePath);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    throw error;
  }
  try {
    const verification = validateRepaired(filePath, plan, audioHash);
    const afterStat = fs.statSync(filePath);
    manifest.files.push({
      path: relativePath,
      format: plan.format,
      reasons: plan.reasons,
      prefixBackup: prefixFile,
      oldAudioOffset: plan.oldAudioOffset,
      newAudioOffset: verification.newOffset,
      beforeSize: beforeStat.size,
      afterSize: afterStat.size,
      audioSha256: verification.audioSha256,
      beforeTags: plan.beforeTags,
      afterTags: plan.afterTags,
    });
    fs.writeFileSync(
      path.join(BACKUP_ROOT, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    fs.unlinkSync(originalPath);
  } catch (error) {
    const failedPath = `${filePath}.clair-failed-${process.pid}.tmp`;
    fs.renameSync(filePath, failedPath);
    fs.renameSync(originalPath, filePath);
    fs.unlinkSync(failedPath);
    throw error;
  }
}

function main() {
  if (!fs.statSync(ROOT).isDirectory()) throw new Error(`Not a directory: ${ROOT}`);
  const files = walk(ROOT)
    .filter((filePath) => {
      const relative = path.relative(ROOT, filePath).replaceAll("\\", "/");
      return !relative.startsWith(".Clair/")
        && (INCLUDE_TRASH || !relative.startsWith(".Clair 回收站/"));
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const plans = [];
  for (const filePath of files) {
    const relativePath = path.relative(ROOT, filePath).replaceAll("\\", "/");
    const extension = path.extname(filePath).toLowerCase();
    const plan = extension === ".flac"
      ? flacRepairPlan(filePath, relativePath)
      : extension === ".mp3"
        ? mp3RepairPlan(filePath, relativePath)
        : null;
    if (plan) plans.push({ filePath, relativePath, plan });
  }
  const preview = {
    root: ROOT,
    mode: APPLY ? "apply" : "dry-run",
    scanned: files.length,
    changes: plans.length,
    byReason: {},
    files: plans.map(({ relativePath, plan }) => ({
      path: relativePath,
      format: plan.format,
      reasons: plan.reasons,
    })),
  };
  for (const { plan } of plans) {
    for (const reason of plan.reasons) {
      preview.byReason[reason] = (preview.byReason[reason] || 0) + 1;
    }
  }
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  if (!APPLY || !plans.length) return;
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const manifest = {
    version: 1,
    root: ROOT,
    createdAt: new Date().toISOString(),
    status: "in-progress",
    files: [],
  };
  fs.writeFileSync(path.join(BACKUP_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  for (let index = 0; index < plans.length; index++) {
    const { filePath, relativePath, plan } = plans[index];
    process.stdout.write(`[${index + 1}/${plans.length}] ${relativePath}\n`);
    applyPlan(filePath, relativePath, plan, manifest);
  }
  manifest.status = "complete";
  manifest.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(BACKUP_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  process.stdout.write(`Backup: ${BACKUP_ROOT}\n`);
}

main();
