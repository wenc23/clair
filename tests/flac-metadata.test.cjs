const assert = require("node:assert/strict");
const {
  readStructure,
  readVorbisComments,
  rewriteFlacBlob,
} = require("../flac-metadata.js");

const encoder = new TextEncoder();

function littleEndian(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function commentPayload(vendor, comments) {
  const vendorBytes = encoder.encode(vendor);
  const commentBytes = comments.map((comment) => encoder.encode(comment));
  return new Blob([
    littleEndian(vendorBytes.length),
    vendorBytes,
    littleEndian(commentBytes.length),
    ...commentBytes.flatMap((bytes) => [littleEndian(bytes.length), bytes]),
  ]);
}

function header(type, length, isLast) {
  return new Uint8Array([
    type | (isLast ? 0x80 : 0),
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

async function run() {
  const magic = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
  const streamInfo = new Uint8Array(34);
  const originalComments = commentPayload("unit-test", [
    "TITLE=Old title",
    "ARTIST=Old artist",
    "GENRE=Classical",
  ]);
  const pictureBlock = new Uint8Array([0x00, 0x00, 0x00, 0x03, 0xaa, 0xbb, 0xcc, 0xdd]);
  const audioFrames = new Uint8Array([0xff, 0xf8, 0x69, 0x00, 0x11, 0x22, 0x33]);
  const source = new Blob([
    magic,
    header(0, streamInfo.length, false),
    streamInfo,
    header(4, originalComments.size, false),
    originalComments,
    header(6, pictureBlock.length, true),
    pictureBlock,
    audioFrames,
  ], { type: "audio/flac" });

  const rewritten = await rewriteFlacBlob(source, {
    title: "New title",
    artist: "New artist",
    conductor: "Test conductor",
    orchestra: "",
    composer: "Test composer",
    album: "",
    work: "Test work",
    year: "2026",
  });
  const structure = await readStructure(rewritten.blob);
  assert.deepEqual(structure.blocks.map((block) => block.type), [0, 4, 6]);
  assert.equal(structure.blocks.at(-1).isLast, true);
  const preservedPicture = new Uint8Array(await rewritten.blob.slice(
    structure.blocks[2].payloadStart,
    structure.blocks[2].payloadEnd
  ).arrayBuffer());
  assert.deepEqual(preservedPicture, pictureBlock);
  const tags = await readVorbisComments(rewritten.blob);
  assert.equal(tags.map.TITLE, "New title");
  assert.equal(tags.map.ARTIST, "New artist");
  assert.equal(tags.map.CONDUCTOR, "Test conductor");
  assert.equal(tags.map.COMPOSER, "Test composer");
  assert.equal(tags.map.WORK, "Test work");
  assert.equal(tags.map.DATE, "2026");
  assert.equal(tags.map.GENRE, "Classical");
  assert.equal(tags.map.ALBUM, undefined);
  const rewrittenAudio = new Uint8Array(await rewritten.blob.slice(structure.audioOffset).arrayBuffer());
  assert.deepEqual(rewrittenAudio, audioFrames);

  const noCommentSource = new Blob([
    magic,
    header(0, streamInfo.length, true),
    streamInfo,
    audioFrames,
  ], { type: "audio/flac" });
  const inserted = await rewriteFlacBlob(noCommentSource, { title: "Inserted" });
  const insertedStructure = await readStructure(inserted.blob);
  assert.deepEqual(insertedStructure.blocks.map((block) => block.type), [0, 4]);
  assert.equal((await readVorbisComments(inserted.blob)).map.TITLE, "Inserted");
  const insertedAudio = new Uint8Array(await inserted.blob.slice(insertedStructure.audioOffset).arrayBuffer());
  assert.deepEqual(insertedAudio, audioFrames);
  await assert.rejects(
    () => rewriteFlacBlob(new Blob(["not a flac"]), { title: "Invalid" }),
    /不是有效的 FLAC/
  );

  console.log("FLAC metadata tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
