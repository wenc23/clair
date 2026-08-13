(function attachClairLibraryModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClairLibraryModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClairLibraryModel() {
  "use strict";

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  function ordinal(value) {
    const match = String(value || "").match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function isClassicalTrack(track) {
    const genre = String(track.genre || track.tags?.genre || "").toLocaleLowerCase();
    if (/classical|古典|クラシック|klassik/.test(genre)) return true;
    return Boolean(
      track.conductor
      || track.orchestra
      || (track.composer && track.work)
    );
  }

  function isHighResolution(track) {
    return Number(track.sampleRate) > 48000 || Number(track.bits) > 16;
  }

  function assignStableIds(tracks) {
    const counts = new Map();
    for (const track of tracks) {
      const stableKey = track.stableKey || track.signature || track.path;
      counts.set(stableKey, (counts.get(stableKey) || 0) + 1);
    }
    for (const track of tracks) {
      const stableKey = track.stableKey || track.signature || track.path;
      track.id = counts.get(stableKey) > 1 ? `${stableKey}\u241f${track.path}` : stableKey;
    }
    return tracks;
  }

  function recordingLabel(track) {
    const album = track.album && track.album !== track.work ? track.album : "";
    return [
      album,
      track.conductor,
      track.orchestra,
      track.year,
    ].filter(Boolean).join(" · ") || "未标注录音版本";
  }

  function descriptor(label, order = label) {
    return { label: String(label || "未分类"), order };
  }

  function hierarchyForTrack(track, mode) {
    if (mode === "folder") {
      const folders = String(track.path || "")
        .split("/")
        .slice(0, -1)
        .filter(Boolean);
      return (folders.length ? folders : ["音乐库"]).map((label) => descriptor(label));
    }
    if (mode === "classical") {
      return [
        descriptor(track.composer || "未标注作曲家"),
        descriptor(track.work || track.album || "未标注作品"),
        descriptor(recordingLabel(track)),
      ];
    }
    if (mode === "album") {
      const artist = track.albumArtist || track.artist || track.composer || "未标注专辑艺术家";
      const album = track.album || "未归入专辑";
      return [
        descriptor(artist),
        descriptor(track.year ? `${album} (${track.year})` : album),
      ];
    }
    if (mode === "artist") {
      return [
        descriptor(track.artist || track.composer || "未标注艺术家"),
        descriptor(track.album || track.work || "未归入专辑"),
      ];
    }
    if (mode === "smart") {
      if (track.favorite) return [descriptor("收藏", 0)];
      if (isHighResolution(track)) return [descriptor("高解析度", 1)];
      if (isClassicalTrack(track)) return [descriptor("古典录音", 2)];
      if (!track.album || !track.year) return [descriptor("待整理", 3)];
      return [descriptor("其他曲目", 4)];
    }
    if (mode === "year") {
      const year = track.year || "年代未标注";
      return [descriptor(year, track.year ? -Number(track.year) : Number.MAX_SAFE_INTEGER)];
    }
    return [descriptor("音乐库")];
  }

  function fallbackTrackCompare(left, right, sortMode) {
    if (sortMode === "title") return collator.compare(left.track.title, right.track.title);
    if (sortMode === "artist") return collator.compare(left.track.artist, right.track.artist);
    if (sortMode === "year") {
      const leftYear = Number(left.track.year) || Number.MAX_SAFE_INTEGER;
      const rightYear = Number(right.track.year) || Number.MAX_SAFE_INTEGER;
      if (leftYear !== rightYear) return leftYear - rightYear;
    }
    return collator.compare(left.track.path, right.track.path);
  }

  function compareTrackItems(left, right, sortMode = "path") {
    const leftDisc = ordinal(left.track.tags?.discNumber);
    const rightDisc = ordinal(right.track.tags?.discNumber);
    if (leftDisc || rightDisc) {
      if (!leftDisc) return 1;
      if (!rightDisc) return -1;
      if (leftDisc !== rightDisc) return leftDisc - rightDisc;
    }
    const leftTrack = ordinal(left.track.tags?.trackNumber);
    const rightTrack = ordinal(right.track.tags?.trackNumber);
    if (leftTrack || rightTrack) {
      if (!leftTrack) return 1;
      if (!rightTrack) return -1;
      if (leftTrack !== rightTrack) return leftTrack - rightTrack;
    }
    return fallbackTrackCompare(left, right, sortMode);
  }

  function createNode(label, key, depth, order) {
    return {
      label,
      key,
      depth,
      order,
      count: 0,
      children: new Map(),
      tracks: [],
    };
  }

  function buildTree(items, { mode = "folder", sortMode = "path" } = {}) {
    const root = createNode("root", mode, -1, "");
    for (const item of items) {
      let node = root;
      for (const part of hierarchyForTrack(item.track, mode)) {
        const key = `${node.key}\u241f${part.label}`;
        if (!node.children.has(part.label)) {
          node.children.set(part.label, createNode(part.label, key, node.depth + 1, part.order));
        }
        node = node.children.get(part.label);
        node.count++;
      }
      node.tracks.push(item);
    }

    function sortNode(node) {
      node.sortedChildren = [...node.children.values()].sort((left, right) => {
        if (typeof left.order === "number" && typeof right.order === "number") return left.order - right.order;
        return collator.compare(String(left.order), String(right.order));
      });
      node.tracks.sort((left, right) => compareTrackItems(left, right, sortMode));
      node.sortedChildren.forEach(sortNode);
    }
    sortNode(root);
    return root;
  }

  function flattenTreeItems(root) {
    const items = [];
    function visit(node) {
      for (const child of node.sortedChildren || node.children.values()) visit(child);
      items.push(...node.tracks);
    }
    visit(root);
    return items;
  }

  function collectTreeKeys(root) {
    const keys = [];
    function visit(node) {
      for (const child of node.sortedChildren || node.children.values()) {
        keys.push(child.key);
        visit(child);
      }
    }
    visit(root);
    return keys;
  }

  return {
    assignStableIds,
    buildTree,
    collectTreeKeys,
    compareTrackItems,
    flattenTreeItems,
    hierarchyForTrack,
    isClassicalTrack,
    isHighResolution,
    ordinal,
    recordingLabel,
  };
});
