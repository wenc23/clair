"use strict";

const assert = require("assert");
const model = require("../library-model.js");

function track(overrides = {}) {
  return {
    id: "",
    stableKey: overrides.signature || "flac:default",
    signature: overrides.signature || "flac:default",
    path: "Music/Album/01.flac",
    title: "Track",
    artist: "Artist",
    albumArtist: "Artist",
    album: "Album",
    composer: "",
    work: "",
    conductor: "",
    orchestra: "",
    year: "2024",
    sampleRate: 44100,
    bits: 16,
    favorite: false,
    tags: { trackNumber: "01", discNumber: "1" },
    ...overrides,
  };
}

{
  const original = track({ signature: "flac:abc", path: "Music/Old.flac" });
  model.assignStableIds([original]);
  assert.strictEqual(original.id, "flac:abc");
  original.path = "Music/Renamed.flac";
  model.assignStableIds([original]);
  assert.strictEqual(original.id, "flac:abc", "rename must not change a unique content id");
}

{
  const duplicates = [
    track({ signature: "flac:same", path: "Music/A.flac" }),
    track({ signature: "flac:same", path: "Music/B.flac" }),
  ];
  model.assignStableIds(duplicates);
  assert.notStrictEqual(duplicates[0].id, duplicates[1].id, "duplicates need distinct selectable ids");
}

{
  const items = [
    { track: track({ path: "Music/EAC/Beethoven/01.flac" }), index: 0 },
    { track: track({ path: "Music/EAC/Rachmaninoff/01.flac" }), index: 1 },
  ];
  const tree = model.buildTree(items, { mode: "folder", sortMode: "path" });
  assert.strictEqual(tree.sortedChildren[0].label, "Music");
  assert.strictEqual(tree.sortedChildren[0].sortedChildren[0].label, "EAC");
  assert.strictEqual(tree.sortedChildren[0].sortedChildren[0].sortedChildren.length, 2);
}

{
  const work = "Symphony No. 9";
  const items = [
    {
      track: track({
        path: "Music/Abbado.flac",
        composer: "Beethoven",
        work,
        conductor: "Abbado",
        orchestra: "Berliner Philharmoniker",
        year: "2000",
      }),
      index: 0,
    },
    {
      track: track({
        path: "Music/Karajan.flac",
        composer: "Beethoven",
        work,
        conductor: "Karajan",
        orchestra: "Berliner Philharmoniker",
        year: "1963",
      }),
      index: 1,
    },
  ];
  const tree = model.buildTree(items, { mode: "classical", sortMode: "title" });
  const recordingNodes = tree.sortedChildren[0].sortedChildren[0].sortedChildren;
  assert.strictEqual(recordingNodes.length, 2, "different recordings of one work must remain separate");
}

{
  const items = [
    { track: track({ title: "Finale", path: "Music/Album/03.flac", tags: { discNumber: "1", trackNumber: "03" } }), index: 2 },
    { track: track({ title: "Adagio", path: "Music/Album/02.flac", tags: { discNumber: "1", trackNumber: "02" } }), index: 1 },
    { track: track({ title: "Allegro", path: "Music/Album/01.flac", tags: { discNumber: "1", trackNumber: "01" } }), index: 0 },
  ];
  const tree = model.buildTree(items, { mode: "album", sortMode: "title" });
  assert.deepStrictEqual(
    model.flattenTreeItems(tree).map((item) => item.index),
    [0, 1, 2],
    "disc and track numbers must win over display sorting"
  );
}

{
  const smartTracks = [
    track({ path: "Music/Favorite.flac", favorite: true }),
    track({ path: "Music/HiRes.flac", sampleRate: 96000, bits: 24 }),
    track({ path: "Music/Classical.flac", composer: "Bach", work: "Suite" }),
    track({ path: "Music/Missing.flac", album: "", year: "" }),
  ];
  const tree = model.buildTree(
    smartTracks.map((item, index) => ({ track: item, index })),
    { mode: "smart" }
  );
  assert.deepStrictEqual(
    tree.sortedChildren.map((node) => node.label),
    ["收藏", "高解析度", "古典录音", "待整理"]
  );
}

console.log("Library model tests passed");
