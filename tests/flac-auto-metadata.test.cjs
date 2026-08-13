"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  albumFromPath,
  discNumberFromPath,
  inferUpdates,
  mergeAiUpdates,
  readSiblingSequence,
  validateAiSequence,
  titleFromFileName,
  trackNumberFromFileName,
  validateAiTags,
  yearFromPath,
} = require("../tools/flac-auto-metadata.cjs");

test("infers only safe filename and folder metadata", () => {
  const updates = inferUpdates({
    relativePath: "Beethoven Symphony No. 9 (2000)/CD 2/03 - Adagio molto e cantabile.flac",
    fileName: "03 - Adagio molto e cantabile.flac",
    comments: [],
    defaults: { ARTIST: "Berliner Philharmoniker" },
  });
  assert.deepEqual(updates, {
    TITLE: "Adagio molto e cantabile",
    TRACKNUMBER: "3",
    DISCNUMBER: "2",
    ALBUM: "Beethoven Symphony No. 9 (2000)",
    DATE: "2000",
    ARTIST: "Berliner Philharmoniker",
  });
});

test("preserves existing tags and does not invent classical credits", () => {
  const updates = inferUpdates({
    relativePath: "Album/01. Existing title.flac",
    fileName: "01. Existing title.flac",
    comments: [
      { key: "TITLE", value: "Existing title" },
      { key: "ARTIST", value: "Known artist" },
      { key: "ALBUM", value: "Known album" },
    ],
    defaults: { COMPOSER: "Ludwig van Beethoven" },
  });
  assert.deepEqual(updates, {
    TRACKNUMBER: "1",
    COMPOSER: "Ludwig van Beethoven",
  });
});

test("uses an explicit classical album-folder pattern without replacing existing tags", () => {
  const updates = inferUpdates({
    relativePath: "01 音轨01.flac",
    fileName: "01 音轨01.flac",
    comments: [{ key: "TITLE", value: "音轨01" }],
    directoryHints: ["vivaldi_the four seasons_sarah chang orpheus chamber orchestra_spring"],
  });
  assert.deepEqual(updates, {
    TRACKNUMBER: "1",
    COMPOSER: "Antonio Vivaldi",
    ALBUM: "The Four Seasons",
    ARTIST: "Sarah Chang",
    ORCHESTRA: "Orpheus Chamber Orchestra",
    WORK: "The Four Seasons — Spring",
  });
});

test("path helpers distinguish disc folders from album folders", () => {
  assert.equal(titleFromFileName("  07_track name.flac"), "track name");
  assert.equal(titleFromFileName("2/10 - Allegro.flac"), "Allegro");
  assert.equal(trackNumberFromFileName("07_track name.flac"), "7");
  assert.equal(discNumberFromPath("Album/CD2/07_track name.flac"), "2");
  assert.equal(albumFromPath("Album/CD2/07_track name.flac"), "Album");
  assert.equal(yearFromPath("Artist/Album [1998]/01.flac"), "1998");
});

test("accepts only validated high-confidence AI suggestions for missing or placeholder tags", () => {
  const ai = {
    confidence: 0.96,
    tags: validateAiTags({
      TITLE: "I. Allegro",
      ARTIST: "Incorrect replacement",
      COMPOSER: "Antonio Vivaldi",
      DATE: "not-a-date",
      EXTRA: "ignored",
    }),
  };
  assert.deepEqual(mergeAiUpdates(
    [{ key: "TITLE", value: "音轨01" }, { key: "ARTIST", value: "Sarah Chang" }],
    { TRACKNUMBER: "1" },
    ai,
    0.92,
  ), {
    TRACKNUMBER: "1",
    TITLE: "I. Allegro",
    COMPOSER: "Antonio Vivaldi",
  });
  assert.deepEqual(mergeAiUpdates([], {}, { confidence: 0.5, tags: { TITLE: "Ignored" } }, 0.92), {});
});

test("sends DeepSeek a numerically ordered sibling sequence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clair-sequence-"));
  try {
    for (const name of ["10 - Finale.flac", "02 - Largo.flac", "01 - Allegro.flac"]) {
      fs.writeFileSync(path.join(directory, name), "not a flac");
    }
    assert.deepEqual(
      readSiblingSequence(path.join(directory, "02 - Largo.flac")).map((item) => item.fileName),
      ["01 - Allegro.flac", "02 - Largo.flac", "10 - Finale.flac"],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects inconsistent Roman-numeral movement ordering from an AI sequence", () => {
  const result = validateAiSequence({
    confidence: 0.99,
    tracks: [
      { position: 1, tags: { TITLE: "I. Allegro" } },
      { position: 2, tags: { TITLE: "III. Allegro" } },
      { position: 3, tags: { TITLE: "Autumn: III. Allegro" } },
    ],
  }, 3);
  assert.equal(result.warning, "inconsistent-roman-movement-order");
  assert.deepEqual([...result.tracks.values()].map((tags) => tags.TITLE), [undefined, undefined, undefined]);
});
