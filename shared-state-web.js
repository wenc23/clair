/* Local-folder state shared with Clair Desktop. No audio or library index is written here. */
(function (root, factory) {
  const api = factory();
  root.ClairSharedState = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_BYTES = 4 * 1024 * 1024;
  const names = new Set(["favorites.json", "playlists.json", "resume.json"]);
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  function validate(name, value) {
    if (!names.has(name) || !record(value) || value.schemaVersion !== 1) return false;
    if (name === "favorites.json")
      return record(value.tracks) && Object.values(value.tracks).every((item) => typeof item === "boolean");
    if (name === "playlists.json")
      return Array.isArray(value.lists) && value.lists.every((item) => record(item) &&
        typeof item.name === "string" && Array.isArray(item.paths) &&
        item.paths.every((path) => typeof path === "string"));
    return record(value.bookmarks) && Object.values(value.bookmarks).every((item) =>
      typeof item === "number" && Number.isFinite(item) && item >= 0) &&
      (value.lastPath === undefined || typeof value.lastPath === "string") &&
      (value.updatedAt === undefined || typeof value.updatedAt === "string");
  }

  class Store {
    constructor(directory) {
      this.directory = directory;
      this.queues = new Map();
      this.revision = 0;
    }

    async read(name) {
      if (!names.has(name)) throw new Error("未知共享状态文件");
      let handle;
      try { handle = await this.directory.getFileHandle(name); }
      catch (error) { if (error.name === "NotFoundError") return null; throw error; }
      const file = await handle.getFile();
      if (file.size > MAX_BYTES) throw new Error(`${name} 过大，未覆盖原文件`);
      let value;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error(`${name} 格式无效，未覆盖原文件`); }
      if (!validate(name, value)) throw new Error(`${name} 格式无效，未覆盖原文件`);
      return value;
    }

    async write(name, value) {
      if (!validate(name, value)) throw new Error(`${name} 待保存的数据格式无效`);
      const handle = await this.directory.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      try { await writer.write(JSON.stringify(value, null, 2)); await writer.close(); }
      catch (error) { try { await writer.abort(); } catch {} throw error; }
    }

    mutate(name, transform) {
      this.revision++;
      const prior = this.queues.get(name) || Promise.resolve();
      const task = prior.catch(() => {}).then(async () => {
        const next = transform(await this.read(name));
        if (next === null || next === undefined) return false;
        await this.write(name, next);
        return true;
      });
      this.queues.set(name, task);
      return task;
    }

    async idle() {
      await Promise.all([...this.queues.values()].map((task) => task.catch(() => {})));
    }
  }

  return { Store, validate };
});
