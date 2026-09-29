"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Store, validate } = require("../shared-state-web.js");

function fakeDirectory() {
  const files = new Map();
  return {
    files,
    async getFileHandle(name, options = {}) {
      if (!files.has(name)) {
        if (!options.create) throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
        files.set(name, "");
      }
      return {
        async getFile() {
          const content = files.get(name);
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { size: Buffer.byteLength(content), text: async () => content };
        },
        async createWritable() {
          let pending = "";
          return {
            async write(value) { pending = value; },
            async close() { files.set(name, pending); },
            async abort() {},
          };
        },
      };
    },
  };
}

test("shared state refuses malformed schema rather than overwriting it", async () => {
  const directory = fakeDirectory();
  directory.files.set("favorites.json", '{"schemaVersion":1,"tracks":[]}');
  const store = new Store(directory);
  await assert.rejects(store.mutate("favorites.json", () => ({ schemaVersion: 1, tracks: { song: true } })), /格式无效/);
  assert.equal(directory.files.get("favorites.json"), '{"schemaVersion":1,"tracks":[]}');
  assert.equal(validate("playlists.json", { schemaVersion: 1, lists: {} }), false);
  assert.equal(validate("resume.json", { schemaVersion: 1, bookmarks: [] }), false);
});

test("rapid Web edits to one file are serialized without losing either change", async () => {
  const directory = fakeDirectory();
  const store = new Store(directory);
  const favorite = (key) => store.mutate("favorites.json", (current) => ({
    schemaVersion: 1, tracks: { ...(current?.tracks || {}), [key]: true },
  }));
  await Promise.all([favorite("Music/a.mp3"), favorite("Music/b.mp3")]);
  assert.deepEqual((await store.read("favorites.json")).tracks,
    { "Music/a.mp3": true, "Music/b.mp3": true });

  const add = (key) => store.mutate("playlists.json", (current) => ({
    schemaVersion: 1, lists: [{ name: "mix", paths: [...(current?.lists?.[0]?.paths || []), key] }],
  }));
  await Promise.all([add("Music/a.mp3"), add("Music/b.mp3")]);
  assert.deepEqual((await store.read("playlists.json")).lists[0].paths,
    ["Music/a.mp3", "Music/b.mp3"]);
});

test("two stores read the same folder, but different roots stay isolated", async () => {
  const root = fakeDirectory();
  const web = new Store(root);
  const desktopLike = new Store(root);
  await web.mutate("resume.json", () => ({ schemaVersion: 1,
    lastPath: "Music/a.mp3", bookmarks: { "Music/a.mp3": 1234 } }));
  assert.equal((await desktopLike.read("resume.json")).bookmarks["Music/a.mp3"], 1234);
  const other = new Store(fakeDirectory());
  assert.equal(await other.read("resume.json"), null);
});
