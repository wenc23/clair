(function attachClairFlacMetadata(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClairFlacMetadata = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClairFlacMetadata() {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");
  const FIELD_RULES = {
    title: { canonical: "TITLE", aliases: ["TITLE", "TIT2"] },
    artist: { canonical: "ARTIST", aliases: ["ARTIST", "SINGER", "VOCAL", "SOLOIST", "PERFORMER", "TPE1"] },
    conductor: { canonical: "CONDUCTOR", aliases: ["CONDUCTOR", "TPE3"] },
    orchestra: { canonical: "ORCHESTRA", aliases: ["ORCHESTRA", "ENSEMBLE", "BAND", "TPE2"] },
    composer: { canonical: "COMPOSER", aliases: ["COMPOSER", "TCOM"] },
    album: { canonical: "ALBUM", aliases: ["ALBUM", "TALB"] },
    work: { canonical: "WORK", aliases: ["WORK", "GROUPING", "TIT1"] },
    year: { canonical: "DATE", aliases: ["DATE", "YEAR", "TDRC", "TYER"] },
  };

  function uint32LE(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  }

  function metadataHeader(type, length, isLast) {
    if (!Number.isInteger(type) || type < 0 || type > 126) throw new Error("无效的 FLAC 元数据块类型");
    if (!Number.isInteger(length) || length < 0 || length > 0xffffff) throw new Error("FLAC 元数据块超过 16 MB 限制");
    return new Uint8Array([
      (isLast ? 0x80 : 0) | type,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ]);
  }

  async function readStructure(file) {
    const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (magic.length !== 4 || String.fromCharCode(...magic) !== "fLaC") throw new Error("所选文件不是有效的 FLAC");
    const blocks = [];
    let offset = 4;
    for (let index = 0; index < 128; index++) {
      const header = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
      if (header.length !== 4) throw new Error("FLAC 元数据头不完整");
      const length = (header[1] << 16) | (header[2] << 8) | header[3];
      const payloadStart = offset + 4;
      const payloadEnd = payloadStart + length;
      if (payloadEnd > file.size) throw new Error("FLAC 元数据块长度越界");
      blocks.push({
        type: header[0] & 0x7f,
        isLast: Boolean(header[0] & 0x80),
        length,
        payloadStart,
        payloadEnd,
      });
      offset = payloadEnd;
      if (header[0] & 0x80) return { blocks, audioOffset: offset };
    }
    throw new Error("FLAC 元数据块数量异常");
  }

  function parseVorbisCommentPayload(payload) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const takeLength = () => {
      if (offset + 4 > bytes.length) throw new Error("Vorbis Comment 长度字段不完整");
      const length = view.getUint32(offset, true);
      offset += 4;
      return length;
    };
    const vendorLength = takeLength();
    if (offset + vendorLength > bytes.length) throw new Error("Vorbis Comment vendor 越界");
    const vendorBytes = bytes.slice(offset, offset + vendorLength);
    offset += vendorLength;
    const count = takeLength();
    if (count > 100000) throw new Error("Vorbis Comment 条目数量异常");
    const comments = [];
    for (let index = 0; index < count; index++) {
      const length = takeLength();
      if (offset + length > bytes.length) throw new Error("Vorbis Comment 条目越界");
      comments.push(decoder.decode(bytes.slice(offset, offset + length)));
      offset += length;
    }
    return { vendorBytes, comments };
  }

  function encodeVorbisCommentPayload(vendorBytes, comments) {
    const vendor = vendorBytes?.length ? vendorBytes : encoder.encode("Clair");
    const encodedComments = comments.map((comment) => encoder.encode(comment));
    const total = 4 + vendor.length + 4 + encodedComments.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
    if (total > 0xffffff) throw new Error("更新后的 Vorbis Comment 超过 16 MB");
    const output = new Uint8Array(total);
    const view = new DataView(output.buffer);
    let offset = 0;
    view.setUint32(offset, vendor.length, true);
    offset += 4;
    output.set(vendor, offset);
    offset += vendor.length;
    view.setUint32(offset, encodedComments.length, true);
    offset += 4;
    for (const bytes of encodedComments) {
      view.setUint32(offset, bytes.length, true);
      offset += 4;
      output.set(bytes, offset);
      offset += bytes.length;
    }
    return output;
  }

  function updateComments(existingComments, updates) {
    const aliases = new Set(Object.values(FIELD_RULES).flatMap((rule) => rule.aliases));
    const kept = existingComments.filter((comment) => {
      const divider = comment.indexOf("=");
      if (divider <= 0) return true;
      return !aliases.has(comment.slice(0, divider).trim().toUpperCase());
    });
    for (const [field, rule] of Object.entries(FIELD_RULES)) {
      const value = String(updates[field] ?? "").trim();
      if (value) kept.push(`${rule.canonical}=${value}`);
    }
    return kept;
  }

  function commentsToMap(comments) {
    const map = {};
    for (const comment of comments) {
      const divider = comment.indexOf("=");
      if (divider <= 0) continue;
      map[comment.slice(0, divider).trim().toUpperCase()] = comment.slice(divider + 1);
    }
    return map;
  }

  async function readVorbisComments(file) {
    const structure = await readStructure(file);
    const block = structure.blocks.find((item) => item.type === 4);
    if (!block) return { comments: [], map: {}, vendor: "" };
    const payload = new Uint8Array(await file.slice(block.payloadStart, block.payloadEnd).arrayBuffer());
    const parsed = parseVorbisCommentPayload(payload);
    return {
      comments: parsed.comments,
      map: commentsToMap(parsed.comments),
      vendor: decoder.decode(parsed.vendorBytes),
    };
  }

  async function rewriteFlacBlob(file, updates) {
    const structure = await readStructure(file);
    const firstCommentIndex = structure.blocks.findIndex((block) => block.type === 4);
    let vendorBytes = encoder.encode("Clair");
    let existingComments = [];
    if (firstCommentIndex >= 0) {
      const block = structure.blocks[firstCommentIndex];
      const payload = new Uint8Array(await file.slice(block.payloadStart, block.payloadEnd).arrayBuffer());
      const parsed = parseVorbisCommentPayload(payload);
      vendorBytes = parsed.vendorBytes;
      existingComments = parsed.comments;
    }
    const updatedComments = updateComments(existingComments, updates);
    const updatedPayload = encodeVorbisCommentPayload(vendorBytes, updatedComments);
    const preserved = structure.blocks.filter((block) => block.type !== 4).map((block) => ({
      type: block.type,
      length: block.length,
      payload: file.slice(block.payloadStart, block.payloadEnd),
    }));
    const insertionIndex = firstCommentIndex >= 0
      ? structure.blocks.slice(0, firstCommentIndex).filter((block) => block.type !== 4).length
      : Math.max(1, preserved.findIndex((block) => block.type === 0) + 1);
    preserved.splice(insertionIndex, 0, {
      type: 4,
      length: updatedPayload.length,
      payload: updatedPayload,
    });
    const parts = [new Uint8Array([0x66, 0x4c, 0x61, 0x43])];
    preserved.forEach((block, index) => {
      parts.push(metadataHeader(block.type, block.length, index === preserved.length - 1));
      parts.push(block.payload);
    });
    parts.push(file.slice(structure.audioOffset));
    return {
      blob: new Blob(parts, { type: file.type || "audio/flac" }),
      comments: updatedComments,
      map: commentsToMap(updatedComments),
    };
  }

  return {
    FIELD_RULES,
    parseVorbisCommentPayload,
    readStructure,
    readVorbisComments,
    rewriteFlacBlob,
    updateComments,
    uint32LE,
  };
});
