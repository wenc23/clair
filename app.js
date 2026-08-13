(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const APP_VERSION = "3.1.0";
  const AUDIO_EXTENSIONS = /\.(flac|wav|wave|mp3|m4a|aac|ogg|opus|aiff?)$/i;
  const AUDIO_MIME_TYPES = {
    flac: "audio/flac",
    wav: "audio/wav",
    wave: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    opus: "audio/ogg; codecs=opus",
    aif: "audio/aiff",
    aiff: "audio/aiff",
  };
  const TRASH_NAME = ".Clair 回收站";
  const DATA_DIRECTORY_NAME = ".Clair";
  const LOG_FILE_NAME = "clair.log";
  const LIBRARY_INDEX_FILE_NAME = "library.json";
  const SETTINGS_FILE_NAME = "settings.json";
  const METADATA_BACKUP_DIRECTORY_NAME = "metadata-backups";

  const dom = {
    audio: $("audio"),
    canvas: $("visualizer"),
    play: $("play"),
    previous: $("previous"),
    next: $("next"),
    shuffle: $("shuffle"),
    repeat: $("repeat"),
    seek: $("seek"),
    volume: $("volume"),
    currentTime: $("current-time"),
    totalTime: $("total-time"),
    trackList: $("track-list"),
    search: $("library-search"),
    groupMode: $("group-mode"),
    sortMode: $("sort-mode"),
    sourceState: $("source-state"),
    sourceStateWrap: document.querySelector(".source-state"),
    signalBadge: $("signal-badge"),
    selectionSummary: $("selection-summary"),
    librarySummary: $("library-summary"),
    logList: $("log-list"),
    logSummary: $("log-summary"),
    logLevel: $("log-level"),
    navTrackCount: $("nav-track-count"),
    navLogCount: $("nav-log-count"),
    tagDialog: $("tag-dialog"),
    soundDialog: $("sound-dialog"),
    healthPanel: $("health-panel"),
  };

  const state = {
    tracks: [],
    currentIndex: -1,
    selected: new Set(),
    directory: null,
    dataDirectory: null,
    localWriteQueue: Promise.resolve(),
    localIndex: {},
    trashMode: false,
    logs: loadLogs(),
    metadata: loadRecord("clair-metadata"),
    collapsedGroups: loadSet("clair-collapsed-groups"),
    theme: localStorage.getItem("clair-theme") || "nocturne",
    shuffle: false,
    repeat: "all",
    audioContext: null,
    sourceNode: null,
    analyser: null,
    lowFilter: null,
    midFilter: null,
    highFilter: null,
    panner: null,
    frequencyData: null,
    waveformData: null,
    objectUrls: new Set(),
    audioUrl: "",
    playRequestId: 0,
    libraryLoadToken: 0,
    refreshToken: 0,
    libraryOrder: [],
    visualLevels: new Float32Array(80),
    visualPeaks: new Float32Array(80),
    lastVisualizerError: "",
  };

  function loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage failure should never stop playback.
    }
  }

  function loadArray(key) {
    const value = loadJSON(key, []);
    return Array.isArray(value) ? value : [];
  }

  function loadRecord(key) {
    const value = loadJSON(key, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function loadLogs() {
    return loadArray("clair-logs").filter((entry) =>
      entry && typeof entry === "object" && typeof entry.level === "string" && typeof entry.message === "string"
    );
  }

  function loadSet(key) {
    return new Set(loadArray(key));
  }

  function log(level, category, message, details = "", persistLocal = true) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: new Date().toISOString(),
      level,
      category,
      message,
      details: details ? String(details) : "",
    };
    state.logs.unshift(entry);
    state.logs = state.logs.slice(0, 500);
    saveJSON("clair-logs", state.logs);
    const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "info";
    console[consoleMethod](`[Clair][${category}] ${message}${entry.details ? ` · ${entry.details}` : ""}`);
    renderLogs();
    if (persistLocal) appendLocalLog(entry);
    return entry;
  }

  function enqueueLocalWrite(task, failureMessage) {
    const directory = state.dataDirectory;
    if (!directory) return Promise.resolve();
    state.localWriteQueue = state.localWriteQueue
      .then(() => task(directory))
      .catch((error) => log("error", "local-storage", failureMessage, error.message, false));
    return state.localWriteQueue;
  }

  function formatLogLine(entry) {
    const message = String(entry.message).replace(/\r?\n/g, "\\n");
    const details = String(entry.details || "").replace(/\r?\n/g, "\\n");
    return `[${entry.time}] ${entry.level.toUpperCase()} ${entry.category}: ${message}${details ? ` | ${details}` : ""}\r\n`;
  }

  function appendLocalLog(entry) {
    if (!state.dataDirectory) return;
    const line = formatLogLine(entry);
    enqueueLocalWrite(async (directory) => {
      const handle = await directory.getFileHandle(LOG_FILE_NAME, { create: true });
      const file = await handle.getFile();
      const writer = await handle.createWritable({ keepExistingData: true });
      if (file.size > 5 * 1024 * 1024) {
        const tail = await file.slice(Math.max(0, file.size - 1024 * 1024)).text();
        const rotated = `[${new Date().toISOString()}] INFO system: 日志已自动轮转\r\n${tail}${line}`;
        await writer.seek(0);
        await writer.write(rotated);
        await writer.truncate(new TextEncoder().encode(rotated).length);
      } else {
        await writer.seek(file.size);
        await writer.write(line);
      }
      await writer.close();
    }, "无法写入本地日志文件");
  }

  async function readLocalJson(name, fallback) {
    if (!state.dataDirectory) return fallback;
    try {
      const handle = await state.dataDirectory.getFileHandle(name);
      return JSON.parse(await (await handle.getFile()).text());
    } catch (error) {
      if (error.name !== "NotFoundError") {
        log("warn", "local-storage", `无法读取 ${name}`, error.message);
      }
      return fallback;
    }
  }

  async function writeLocalJsonNow(directory, name, value) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    await writer.write(`${JSON.stringify(value, null, 2)}\r\n`);
    await writer.close();
  }

  async function ensureLocalLogFile() {
    try {
      await state.dataDirectory.getFileHandle(LOG_FILE_NAME);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      const handle = await state.dataDirectory.getFileHandle(LOG_FILE_NAME, { create: true });
      const writer = await handle.createWritable();
      const initialLines = state.logs.slice().reverse().map(formatLogLine).join("");
      await writer.write(initialLines);
      await writer.close();
    }
  }

  async function readLocalLogEntries() {
    const handle = await state.dataDirectory.getFileHandle(LOG_FILE_NAME);
    const file = await handle.getFile();
    const text = await file.slice(Math.max(0, file.size - 2 * 1024 * 1024)).text();
    const entries = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(/^\[([^\]]+)\] (DEBUG|INFO|WARN|ERROR) ([^:]+): (.*)$/);
      if (!match) continue;
      const divider = match[4].indexOf(" | ");
      entries.push({
        id: `local-${match[1]}-${index}`,
        time: match[1],
        level: match[2].toLowerCase(),
        category: match[3],
        message: divider >= 0 ? match[4].slice(0, divider) : match[4],
        details: divider >= 0 ? match[4].slice(divider + 3) : "",
      });
    }
    return entries.reverse();
  }

  function writeLocalSettings() {
    if (!state.dataDirectory) return;
    const snapshot = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      theme: state.theme,
      groupMode: dom.groupMode.value,
      sortMode: dom.sortMode.value,
      collapsedGroups: [...state.collapsedGroups],
    };
    enqueueLocalWrite((directory) => writeLocalJsonNow(directory, SETTINGS_FILE_NAME, snapshot), "无法保存本地设置");
  }

  function writeLocalLibraryIndex() {
    if (!state.dataDirectory || state.trashMode) return;
    const snapshot = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      rootDirectory: state.directory?.name || "",
      trackCount: state.tracks.length,
      tracks: state.tracks.map((track) => ({
        id: track.id,
        contentSignature: track.signature,
        path: track.path,
        fileName: track.fileName,
        fileSize: track.fileSize,
        format: track.format,
        title: track.title,
        artist: track.artist,
        albumArtist: track.albumArtist,
        conductor: track.conductor,
        orchestra: track.orchestra,
        composer: track.composer,
        album: track.album,
        work: track.work,
        year: track.year,
        sampleRate: track.sampleRate,
        bits: track.bits,
        bitrate: track.bitrate,
        duration: track.duration,
        favorite: Boolean(track.favorite),
      })),
    };
    state.localIndex = snapshot;
    enqueueLocalWrite((directory) => writeLocalJsonNow(directory, LIBRARY_INDEX_FILE_NAME, snapshot), "无法保存音乐库索引");
  }

  async function initializeLocalData() {
    state.dataDirectory = await state.directory.getDirectoryHandle(DATA_DIRECTORY_NAME, { create: true });
    await ensureLocalLogFile();
    const [settings, index, localLogs] = await Promise.all([
      readLocalJson(SETTINGS_FILE_NAME, {}),
      readLocalJson(LIBRARY_INDEX_FILE_NAME, {}),
      readLocalLogEntries(),
    ]);
    const mergedLogs = new Map();
    for (const entry of [...state.logs, ...localLogs]) {
      const key = `${entry.time}|${entry.level}|${entry.category}|${entry.message}|${entry.details}`;
      if (!mergedLogs.has(key)) mergedLogs.set(key, entry);
    }
    state.logs = [...mergedLogs.values()]
      .sort((left, right) => String(right.time).localeCompare(String(left.time)))
      .slice(0, 500);
    saveJSON("clair-logs", state.logs);
    renderLogs();
    if (["nocturne", "ivory", "ocean"].includes(settings.theme)) {
      state.theme = settings.theme;
      document.body.dataset.theme = settings.theme;
      $("theme-select").value = settings.theme;
      localStorage.setItem("clair-theme", settings.theme);
    }
    const savedGroupMode = settings.groupMode === "composer" ? "classical" : settings.groupMode;
    if (["folder", "album", "artist", "classical", "smart", "year"].includes(savedGroupMode)) {
      dom.groupMode.value = savedGroupMode;
    }
    if (["path", "title", "artist", "year"].includes(settings.sortMode)) dom.sortMode.value = settings.sortMode;
    if (Array.isArray(settings.collapsedGroups)) {
      state.collapsedGroups = new Set(settings.collapsedGroups);
      saveJSON("clair-collapsed-groups", settings.collapsedGroups);
    }
    if (Array.isArray(index.tracks)) {
      for (const item of index.tracks) {
        if (!item?.path) continue;
        state.metadata[item.path] = {
          ...(state.metadata[item.path] || {}),
          favorite: Boolean(item.favorite),
        };
      }
    }
    state.localIndex = index;
    $("local-data-state").textContent = `本地数据：${state.directory.name} / ${DATA_DIRECTORY_NAME}`;
    writeLocalSettings();
  }

  function clearLocalLogFile() {
    if (!state.dataDirectory) return Promise.resolve();
    return enqueueLocalWrite(async (directory) => {
      const handle = await directory.getFileHandle(LOG_FILE_NAME, { create: true });
      const writer = await handle.createWritable();
      await writer.write("");
      await writer.close();
    }, "无法清空本地日志文件");
  }

  function removeLegacyDisplayOverrides() {
    let changed = false;
    for (const saved of Object.values(state.metadata)) {
      if (saved && typeof saved === "object" && "tags" in saved) {
        delete saved.tags;
        changed = true;
      }
    }
    if (changed) saveJSON("clair-metadata", state.metadata);
  }

  window.addEventListener("error", (event) => {
    log("error", "runtime", event.message || "未知脚本错误", `${event.filename || ""}:${event.lineno || ""}`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    log("error", "promise", "未处理的异步错误", event.reason?.message || event.reason || "");
  });

  function renderLogs() {
    if (!dom.logList) return;
    const level = dom.logLevel?.value || "all";
    const rows = state.logs.filter((entry) => level === "all" || entry.level === level);
    dom.logList.innerHTML = rows.length
      ? rows.map((entry) => `
          <div class="log-entry" data-level="${escapeHTML(entry.level)}">
            <span class="log-time">${formatLogTime(entry.time)}</span>
            <span class="log-level">${escapeHTML(entry.level)}</span>
            <span class="log-category">${escapeHTML(entry.category)}</span>
            <span class="log-message">${escapeHTML(entry.message)}${entry.details ? ` · ${escapeHTML(entry.details)}` : ""}</span>
          </div>`).join("")
      : `<div class="empty-state">暂无符合条件的日志</div>`;
    dom.logSummary.textContent = `${rows.length} / ${state.logs.length} 条`;
    dom.navLogCount.textContent = String(state.logs.filter((entry) => entry.level === "error").length);
  }

  function formatLogTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  }

  function exportLogs() {
    const lines = state.logs.slice().reverse().map((entry) =>
      `[${entry.time}] ${entry.level.toUpperCase()} ${entry.category}: ${entry.message}${entry.details ? ` | ${entry.details}` : ""}`
    );
    downloadBlob("clair-log.txt", lines.join("\n"), "text/plain;charset=utf-8");
    log("info", "log", "已导出运行日志");
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setView(name) {
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.viewPanel === name);
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === name);
    });
    const labels = {
      player: ["NOW PLAYING", "正在聆听"],
      library: ["MUSIC LIBRARY", state.trashMode ? "音乐回收站" : "音乐库"],
      logs: ["ACTIVITY LOG", "运行日志"],
    };
    $("page-kicker").textContent = labels[name][0];
    $("page-title").textContent = labels[name][1];
    if (name === "logs") renderLogs();
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.body.dataset.theme = theme;
    $("theme-select").value = theme;
    localStorage.setItem("clair-theme", theme);
    writeLocalSettings();
    log("debug", "ui", "已切换界面主题", theme);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function formatRate(rate) {
    return rate ? `${Number(rate).toLocaleString()} Hz` : "—";
  }

  function formatSize(bytes) {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  }

  function byteSignature(bytes, fileSize) {
    let hash = 2166136261;
    const stride = Math.max(1, Math.floor(bytes.length / 8192));
    for (let index = 0; index < bytes.length; index += stride) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }
    return `${fileSize}:${(hash >>> 0).toString(16)}`;
  }

  function hexBytes(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function id3PayloadOffset(bytes) {
    if (String.fromCharCode(...bytes.slice(0, 3)) !== "ID3" || bytes.length < 10) return 0;
    return 10
      + ((bytes[6] & 0x7f) << 21)
      + ((bytes[7] & 0x7f) << 14)
      + ((bytes[8] & 0x7f) << 7)
      + (bytes[9] & 0x7f);
  }

  function decodeText(bytes, encoding = 3) {
    try {
      const charset = encoding === 0 ? "iso-8859-1" : encoding === 3 ? "utf-8" : "utf-16";
      return new TextDecoder(charset).decode(bytes).replace(/^\uFEFF/, "").split("\u0000")[0].trim();
    } catch {
      return "";
    }
  }

  function normalizeTags(raw) {
    const value = (key) => raw[key] || "";
    const date = value("DATE") || value("YEAR") || value("TDRC") || value("TYER");
    return {
      title: value("TITLE") || value("TIT2"),
      artist: value("SINGER") || value("VOCAL") || value("SOLOIST") || value("ARTIST") || value("TPE1") || value("PERFORMER"),
      performer: value("PERFORMER") || value("ARTIST") || value("TPE1"),
      conductor: value("CONDUCTOR") || value("TPE3"),
      orchestra: value("ORCHESTRA") || value("BAND"),
      ensemble: value("ENSEMBLE"),
      composer: value("COMPOSER") || value("TCOM"),
      album: value("ALBUM") || value("TALB"),
      albumArtist: value("ALBUMARTIST") || value("TPE2"),
      work: value("WORK") || value("GROUPING") || value("TIT1"),
      movement: value("MOVEMENT") || value("TITLE") || value("TIT2"),
      trackNumber: value("MOVEMENTNUMBER") || value("TRACKNUMBER") || value("TRCK"),
      discNumber: value("DISCNUMBER") || value("TPOS"),
      totalTracks: value("TOTALTRACKS") || value("TRACKTOTAL"),
      totalDiscs: value("TOTALDISCS") || value("DISCTOTAL"),
      year: (date.match(/\b(?:1[4-9]|20|21)\d{2}\b/) || [date])[0],
      genre: value("GENRE") || value("TCON"),
      replayGain: value("REPLAYGAIN_TRACK_GAIN"),
    };
  }

  function parseFlac(bytes, file) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = {};
    const info = { format: "FLAC", sampleRate: 0, bits: 0, channels: 0, duration: 0, bitrate: 0, coverUrl: "" };
    if (bytes.length >= 42 && String.fromCharCode(...bytes.slice(0, 4)) === "fLaC") {
      const packed = view.getBigUint64(18, false);
      info.sampleRate = Number((packed >> 44n) & 0xfffffn);
      info.channels = Number((packed >> 41n) & 0x7n) + 1;
      info.bits = Number((packed >> 36n) & 0x1fn) + 1;
      const samples = Number(packed & 0xfffffffffn);
      info.duration = info.sampleRate ? samples / info.sampleRate : 0;
      info.bitrate = info.duration ? file.size * 8 / info.duration / 1000 : 0;
      const streamMd5 = bytes.slice(26, 42);
      if (streamMd5.some(Boolean)) info.audioMd5 = hexBytes(streamMd5);
    }
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const header = bytes[offset];
      const type = header & 0x7f;
      const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const start = offset + 4;
      if (start + length > bytes.length) break;
      if (type === 4 && length >= 8) {
        let position = start;
        const vendorLength = view.getUint32(position, true);
        position += 4 + vendorLength;
        if (position + 4 <= start + length) {
          const count = view.getUint32(position, true);
          position += 4;
          for (let index = 0; index < count && position + 4 <= start + length; index++) {
            const size = view.getUint32(position, true);
            position += 4;
            if (position + size > start + length) break;
            const entry = decodeText(bytes.slice(position, position + size));
            const divider = entry.indexOf("=");
            if (divider > 0) raw[entry.slice(0, divider).toUpperCase()] = entry.slice(divider + 1).trim();
            position += size;
          }
        }
      }
      if (type === 6 && length > 36 && !info.coverUrl) {
        let position = start + 4;
        const mimeLength = view.getUint32(position, false);
        position += 4;
        const mime = decodeText(bytes.slice(position, position + mimeLength));
        position += mimeLength;
        const descriptionLength = view.getUint32(position, false);
        position += 4 + descriptionLength + 16;
        const imageLength = view.getUint32(position, false);
        position += 4;
        if (position + imageLength <= start + length) {
          info.coverUrl = createObjectURL(new Blob([bytes.slice(position, position + imageLength)], { type: mime || "image/jpeg" }));
        }
      }
      offset = start + length;
      if (header & 0x80) {
        info.audioOffset = offset;
        break;
      }
    }
    info.tags = normalizeTags(raw);
    return info;
  }

  function parseId3(bytes) {
    const raw = {};
    const info = { format: "MP3", sampleRate: 0, bits: 0, channels: 0, duration: 0, bitrate: 0, coverUrl: "" };
    if (String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return { raw, info, audioOffset: 0 };
    const version = bytes[3];
    const tagSize = ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 10;
    const limit = Math.min(bytes.length, 10 + tagSize);
    const frameMap = {
      TIT1: "TIT1", TIT2: "TIT2", TPE1: "TPE1", TPE2: "TPE2", TPE3: "TPE3",
      TALB: "TALB", TCOM: "TCOM", TRCK: "TRCK", TPOS: "TPOS", TDRC: "TDRC", TYER: "TYER", TCON: "TCON",
    };
    while (offset + 10 <= limit) {
      const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const length = version === 4
        ? ((bytes[offset + 4] & 127) << 21) + ((bytes[offset + 5] & 127) << 14) + ((bytes[offset + 6] & 127) << 7) + (bytes[offset + 7] & 127)
        : view.getUint32(offset + 4, false);
      if (!length || offset + 10 + length > limit) break;
      const payload = bytes.slice(offset + 10, offset + 10 + length);
      if (frameMap[id]) raw[frameMap[id]] = decodeText(payload.slice(1), payload[0]);
      if (id === "APIC" && !info.coverUrl) {
        const encoding = payload[0];
        let position = 1;
        while (position < payload.length && payload[position] !== 0) position++;
        const mime = decodeText(payload.slice(1, position)) || "image/jpeg";
        position += 2;
        if (encoding === 1 || encoding === 2) {
          while (position + 1 < payload.length && (payload[position] !== 0 || payload[position + 1] !== 0)) position += 2;
          position += 2;
        } else {
          while (position < payload.length && payload[position] !== 0) position++;
          position++;
        }
        if (position < payload.length) {
          info.coverUrl = createObjectURL(new Blob([payload.slice(position)], { type: mime }));
        }
      }
      offset += 10 + length;
    }
    info.tags = normalizeTags(raw);
    return { raw, info, audioOffset: 10 + tagSize };
  }

  function finishMp3Info(bytes, parsed, file) {
    const { info } = parsed;
    for (let offset = parsed.audioOffset; offset + 4 < bytes.length; offset++) {
      if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
      const version = (bytes[offset + 1] >> 3) & 3;
      const layer = (bytes[offset + 1] >> 1) & 3;
      const bitIndex = bytes[offset + 2] >> 4;
      const rateIndex = (bytes[offset + 2] >> 2) & 3;
      const rates = version === 3 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
      const mpeg1 = [
        [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
      ];
      const mpeg2 = [
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      ];
      if (version !== 1 && layer && bitIndex > 0 && bitIndex < 15 && rateIndex < 3) {
        info.sampleRate = rates[rateIndex];
        info.bitrate = (version === 3 ? mpeg1 : mpeg2)[3 - layer][bitIndex];
        info.channels = ((bytes[offset + 3] >> 6) & 3) === 3 ? 1 : 2;
        info.duration = info.bitrate ? file.size * 8 / (info.bitrate * 1000) : 0;
        break;
      }
    }
    return info;
  }

  function parseWav(bytes, file) {
    const info = { format: "WAV", sampleRate: 0, bits: 0, channels: 0, duration: 0, bitrate: 0, coverUrl: "", tags: normalizeTags({}) };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
    let offset = 12;
    let dataBytes = 0;
    while (offset + 8 <= bytes.length) {
      const id = text(offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (id === "fmt " && start + 16 <= bytes.length) {
        info.channels = view.getUint16(start + 2, true);
        info.sampleRate = view.getUint32(start + 4, true);
        info.bitrate = view.getUint32(start + 8, true) * 8 / 1000;
        info.bits = view.getUint16(start + 14, true);
      }
      if (id === "data") {
        dataBytes = size;
        break;
      }
      offset = start + size + (size % 2);
    }
    info.duration = info.bitrate && dataBytes ? dataBytes / (info.bitrate * 125) : 0;
    if (!info.duration && info.bitrate) info.duration = file.size * 8 / (info.bitrate * 1000);
    return info;
  }

  async function parseAudioFile(file) {
    const bytes = new Uint8Array(await file.slice(0, 2097152).arrayBuffer());
    const magic = String.fromCharCode(...bytes.slice(0, 4));
    let info;
    if (magic === "fLaC") {
      info = parseFlac(bytes, file);
      if (window.ClairFlacMetadata) {
        try {
          const vorbis = await window.ClairFlacMetadata.readVorbisComments(file);
          info.tags = normalizeTags(vorbis.map);
        } catch (error) {
          info.metadataWarning = error.message;
        }
      }
    }
    else if (magic === "RIFF") info = parseWav(bytes, file);
    else {
      const parsed = parseId3(bytes);
      info = finishMp3Info(bytes, parsed, file);
      info.tags ||= normalizeTags({});
      const extension = file.name.split(".").pop();
      info.format = extension && extension !== file.name ? extension.toUpperCase() : "AUDIO";
    }
    if (info.audioMd5) {
      info.signature = `flac:${info.audioMd5}`;
    } else {
      const payloadOffset = magic === "fLaC"
        ? Number(info.audioOffset) || 0
        : magic.startsWith("ID3")
          ? id3PayloadOffset(bytes)
          : 0;
      const signatureBytes = payloadOffset < bytes.length
        ? bytes.slice(payloadOffset)
        : new Uint8Array(await file.slice(payloadOffset, payloadOffset + 2097152).arrayBuffer());
      info.signature = `sample:${byteSignature(signatureBytes, Math.max(0, file.size - payloadOffset))}`;
    }
    return info;
  }

  function createObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    state.objectUrls.add(url);
    return url;
  }

  function releaseObjectUrls() {
    for (const url of state.objectUrls) URL.revokeObjectURL(url);
    state.objectUrls.clear();
  }

  function releaseTrackObjectUrls(tracks) {
    for (const track of tracks) {
      if (!track.coverUrl) continue;
      URL.revokeObjectURL(track.coverUrl);
      state.objectUrls.delete(track.coverUrl);
    }
  }

  function clearPlaybackSource({ cancelPending = true } = {}) {
    if (cancelPending) state.playRequestId++;
    dom.audio.pause();
    dom.audio.removeAttribute("src");
    dom.audio.load();
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = "";
    }
  }

  function playbackMimeType(file) {
    const extension = file.name.split(".").pop().toLocaleLowerCase();
    return AUDIO_MIME_TYPES[extension] || file.type || "application/octet-stream";
  }

  function browserPlayable(file) {
    // Chrome/Edge 的 <audio> 不支持 AIFF；其余格式（FLAC/WAV/MP3/M4A/AAC/Ogg）均可播放。
    const extension = file.name.split(".").pop().toLocaleLowerCase();
    return extension !== "aiff" && extension !== "aif";
  }

  function isAudioFile(file) {
    return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
  }

  async function scanDirectory(directory, prefix = `${directory.name}/`, includeTrash = false) {
    const sources = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "directory" && name === DATA_DIRECTORY_NAME) continue;
      if (handle.kind === "directory" && name === TRASH_NAME && !includeTrash) continue;
      const path = `${prefix}${name}`;
      if (handle.kind === "directory") {
        sources.push(...await scanDirectory(handle, `${path}/`, includeTrash));
      } else {
        const file = await handle.getFile();
        if (isAudioFile(file)) sources.push({ file, path, handle, parentHandle: directory });
      }
    }
    return sources;
  }

  async function mapConcurrent(items, worker, concurrency = 6) {
    const result = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        result[index] = await worker(items[index], index);
      }
    });
    await Promise.all(workers);
    return result;
  }

  function applyMetadataOverride(track) {
    const saved = state.metadata[track.id] || state.metadata[track.path];
    if (!saved) return track;
    if (!state.metadata[track.id]) state.metadata[track.id] = saved;
    track.favorite = Boolean(saved.favorite);
    return track;
  }

  function finalizeTrackLabels(track) {
    track.title = track.tags.title || track.fileName.replace(/\.[^.]+$/, "");
    track.artist = track.tags.artist || track.tags.performer || "";
    track.conductor = track.tags.conductor || "";
    track.orchestra = track.tags.orchestra || "";
    track.composer = track.tags.composer || "";
    track.album = track.tags.album || "";
    track.albumArtist = track.tags.albumArtist || "";
    track.work = track.tags.work || "";
    track.year = String(track.tags.year || "").slice(0, 4);
    track.genre = track.tags.genre || "";
    return track;
  }

  async function buildTracks(sources) {
    const sorted = sources.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    let parsedCount = 0;
    const tracks = await mapConcurrent(sorted, async (source) => {
      const info = await parseAudioFile(source.file);
      if (info.metadataWarning) log("warn", "metadata", "FLAC 元数据读取异常", `${source.path} · ${info.metadataWarning}`);
      parsedCount++;
      if (parsedCount % 25 === 0 || parsedCount === sorted.length) {
        dom.sourceState.textContent = `解析 ${parsedCount} / ${sorted.length}`;
      }
      const folder = source.path.split("/").slice(0, -1).join(" / ");
      const track = {
        id: "",
        stableKey: info.signature,
        path: source.path,
        folder,
        fileName: source.file.name,
        fileSize: source.file.size,
        mimeType: playbackMimeType(source.file),
        handle: source.handle,
        parentHandle: source.parentHandle,
        favorite: false,
        ...info,
      };
      return finalizeTrackLabels(track);
    });
    window.ClairLibraryModel.assignStableIds(tracks);
    tracks.forEach(applyMetadataOverride);
    saveJSON("clair-metadata", state.metadata);
    return tracks;
  }

  async function loadLibrarySources(sources, { trashMode = false } = {}) {
    const loadToken = ++state.libraryLoadToken;
    releaseObjectUrls();
    clearPlaybackSource();
    state.selected.clear();
    state.currentIndex = -1;
    state.trashMode = trashMode;
    state.tracks = [];
    renderLibrary();
    if (!sources.length) {
      updateSourceState(trashMode ? "回收站为空" : "文件夹中没有音频", false);
      dom.navTrackCount.textContent = "0";
      $("toggle-trash").textContent = trashMode ? "返回音乐库" : "查看回收站";
      $("trash-selected").classList.toggle("is-hidden", trashMode);
      $("restore-selected").classList.toggle("is-hidden", !trashMode);
      writeLocalLibraryIndex();
      log("warn", "library", trashMode ? "回收站为空" : "所选文件夹没有可识别音频");
      return;
    }
    log("info", "library", `开始解析 ${sources.length} 首曲目`);
    const builtTracks = await buildTracks(sources);
    if (loadToken !== state.libraryLoadToken) {
      releaseTrackObjectUrls(builtTracks);
      log("debug", "library", "已丢弃过期的音乐库扫描结果", `${sources.length} 首`);
      return;
    }
    state.tracks = builtTracks;
    renderLibrary();
    updateSourceState(`${state.directory.name} · ${state.tracks.length} 首`, true);
    dom.navTrackCount.textContent = String(state.tracks.length);
    $("toggle-trash").textContent = trashMode ? "返回音乐库" : "查看回收站";
    $("trash-selected").classList.toggle("is-hidden", trashMode);
    $("restore-selected").classList.toggle("is-hidden", !trashMode);
    writeLocalLibraryIndex();
    log("info", "library", "音乐库载入完成", `${state.tracks.length} 首`);
  }

  async function refreshLibrary() {
    if (!state.directory) {
      log("warn", "library", "刷新失败：尚未连接音乐文件夹");
      return;
    }
    const refreshToken = ++state.refreshToken;
    try {
      if (state.trashMode) {
        try {
          const trash = await state.directory.getDirectoryHandle(TRASH_NAME);
          const sources = await scanDirectory(trash, `${TRASH_NAME}/`, true);
          if (refreshToken !== state.refreshToken) return;
          await loadLibrarySources(sources, { trashMode: true });
        } catch (error) {
          if (error.name === "NotFoundError") {
            if (refreshToken !== state.refreshToken) return;
            await loadLibrarySources([], { trashMode: true });
          } else {
            throw error;
          }
        }
      } else {
        const sources = await scanDirectory(state.directory);
        if (refreshToken !== state.refreshToken) return;
        await loadLibrarySources(sources);
      }
    } catch (error) {
      if (refreshToken !== state.refreshToken) return;
      log("error", "library", "刷新音乐库失败", error.message);
      updateSourceState("读取失败", false);
    }
  }

  function updateSourceState(text, connected) {
    dom.sourceState.textContent = text;
    dom.sourceStateWrap.classList.toggle("is-connected", connected);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("clair-library", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function rememberDirectory(handle) {
    try {
      const database = await openDatabase();
      await new Promise((resolve, reject) => {
        const request = database.transaction("handles", "readwrite").objectStore("handles").put(handle, "library");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      database.close();
    } catch (error) {
      log("warn", "permission", "无法记住音乐文件夹", error.message);
    }
  }

  async function restoreRememberedDirectory() {
    try {
      const database = await openDatabase();
      const handle = await new Promise((resolve, reject) => {
        const request = database.transaction("handles").objectStore("handles").get("library");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      if (handle && await handle.queryPermission({ mode: "readwrite" }) === "granted") {
        state.directory = handle;
        await initializeLocalData();
        log("info", "permission", "已恢复音乐文件夹授权", handle.name);
        await refreshLibrary();
      }
    } catch (error) {
      log("debug", "permission", "没有可恢复的音乐文件夹授权", error.message);
    }
  }

  async function chooseLibrary() {
    if (!window.showDirectoryPicker) {
      log("error", "permission", "浏览器不支持文件夹写入 API", "请使用 Chrome/Edge 并通过 localhost 打开");
      updateSourceState("当前浏览器不支持", false);
      return;
    }
    try {
      const selectedDirectory = await window.showDirectoryPicker({ mode: "readwrite" });
      await state.localWriteQueue;
      state.directory = selectedDirectory;
      state.dataDirectory = null;
      state.trashMode = false;
      await initializeLocalData();
      await rememberDirectory(state.directory);
      log("info", "permission", "用户已授权音乐文件夹", state.directory.name);
      await refreshLibrary();
      setView("library");
    } catch (error) {
      if (error.name !== "AbortError") log("error", "permission", "选择音乐文件夹失败", error.message);
    }
  }

  function getFilteredTracks() {
    const query = dom.search.value.trim().toLocaleLowerCase();
    return state.tracks.map((track, index) => ({ track, index })).filter(({ track }) => {
      if (!query) return true;
      return [
        track.title, track.artist, track.conductor, track.orchestra, track.composer,
        track.albumArtist, track.album, track.work, track.year, track.genre, track.folder, track.fileName,
      ].join(" ").toLocaleLowerCase().includes(query);
    });
  }

  function getLibraryTree(items = getFilteredTracks()) {
    return window.ClairLibraryModel.buildTree(items, {
      mode: dom.groupMode.value,
      sortMode: dom.sortMode.value,
    });
  }

  function saveCollapsedGroups() {
    saveJSON("clair-collapsed-groups", [...state.collapsedGroups]);
    writeLocalSettings();
  }

  function setVisibleGroupsCollapsed(collapsed) {
    const keys = window.ClairLibraryModel.collectTreeKeys(getLibraryTree());
    for (const key of keys) {
      if (collapsed) state.collapsedGroups.add(key);
      else state.collapsedGroups.delete(key);
    }
    saveCollapsedGroups();
    renderLibrary();
    log("debug", "library", collapsed ? "已折叠当前分组" : "已展开当前分组", `${keys.length} 个节点`);
  }

  function trackNumberLabel(track, fallback) {
    const trackNumber = String(track.tags.trackNumber || fallback);
    const discNumber = window.ClairLibraryModel.ordinal(track.tags.discNumber);
    return discNumber > 1 ? `${discNumber}.${trackNumber}` : trackNumber;
  }

  function renderTrackRow(item, position, depth) {
    const { track, index } = item;
    const classical = window.ClairLibraryModel.isClassicalTrack(track);
    const firstValue = classical ? track.conductor : track.album;
    const firstLabel = classical ? "指挥" : "专辑";
    const secondValue = classical ? track.orchestra : track.year;
    const secondLabel = classical ? "乐团" : "年代";
    return `
      <div class="track-row ${index === state.currentIndex ? "is-current" : ""}"
        data-track-index="${index}" style="--tree-depth:${Math.min(depth, 4)}">
        <input class="track-select" type="checkbox" data-track-id="${escapeHTML(track.id)}" ${state.selected.has(track.id) ? "checked" : ""} aria-label="选择 ${escapeHTML(track.title)}" />
        <span class="track-number">${escapeHTML(trackNumberLabel(track, String(position + 1).padStart(2, "0")))}</span>
        <div class="track-primary">
          <strong>${track.favorite ? "♥ " : ""}${escapeHTML(track.title)}</strong>
          <span>${escapeHTML(track.artist || track.composer || track.fileName)}</span>
        </div>
        <div class="track-secondary">
          <strong>${escapeHTML(firstValue || "—")}</strong>
          <span>${firstLabel}</span>
        </div>
        <div class="track-secondary">
          <strong>${escapeHTML(secondValue || "—")}</strong>
          <span>${secondLabel}</span>
        </div>
        <span class="track-duration">${formatDuration(track.duration)}</span>
      </div>`;
  }

  function renderTreeNode(node, html) {
    const collapsed = state.collapsedGroups.has(node.key);
    html.push(`
      <button class="group-header tree-level-${Math.min(node.depth, 4)} ${collapsed ? "is-collapsed" : ""}" type="button"
        data-group-key="${escapeHTML(node.key)}" aria-expanded="${String(!collapsed)}"
        aria-level="${node.depth + 1}" style="--tree-depth:${Math.min(node.depth, 4)}">
        <span class="group-chevron">⌄</span>
        <span class="group-label">${escapeHTML(node.label)}</span>
        <small>${node.count} 首</small>
      </button>`);
    if (collapsed) return;
    for (const child of node.sortedChildren) renderTreeNode(child, html);
    node.tracks.forEach((item, position) => html.push(renderTrackRow(item, position, node.depth + 1)));
  }

  function renderLibrary() {
    const items = getFilteredTracks();
    const tree = getLibraryTree(items);
    const orderedItems = window.ClairLibraryModel.flattenTreeItems(tree);
    state.libraryOrder = orderedItems.map((item) => item.index);
    const html = [];
    for (const child of tree.sortedChildren) renderTreeNode(child, html);
    dom.trackList.innerHTML = html.length ? html.join("") : `<div class="empty-state">没有匹配的曲目</div>`;
    dom.librarySummary.textContent = `${tree.sortedChildren.length} 个顶层分组 · ${items.length} / ${state.tracks.length} 首`;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = state.selected.size;
    dom.selectionSummary.textContent = count ? `已选择 ${count} 首` : "未选择";
    $("trash-selected").textContent = `移至回收站 (${count})`;
    $("restore-selected").textContent = `恢复已选择 (${count})`;
  }

  function currentTrack() {
    return state.tracks[state.currentIndex] || null;
  }

  async function selectTrack(index, autoplay = true) {
    const track = state.tracks[index];
    if (!track) return;
    const requestId = ++state.playRequestId;
    state.currentIndex = index;
    updateNowPlaying(track);
    renderLibrary();
    clearPlaybackSource({ cancelPending: false });
    try {
      const file = await track.handle.getFile();
      if (requestId !== state.playRequestId) return;
      if (!browserPlayable(file)) {
        log("warn", "playback", "当前浏览器不支持此格式播放", `${track.path} · AIFF 请先转换为 FLAC/WAV/MP3`);
        return;
      }
      const mimeType = playbackMimeType(file);
      // 直接引用 File 本身而非 new Blob([file])：后者会把整个文件复制进内存，
      // 对 Hi-Res FLAC（可达数百 MB）会造成明显的内存峰值与卡顿。
      const playbackSource = file.type ? file : new Blob([file], { type: mimeType });
      state.audioUrl = URL.createObjectURL(playbackSource);
      dom.audio.src = state.audioUrl;
      dom.audio.load();
      ensureAudioGraph();
      log("debug", "playback", "播放源已准备", `${track.path} · ${mimeType} · ${formatSize(file.size)}`);
      if (autoplay) {
        await state.audioContext.resume();
        await dom.audio.play();
      }
    } catch (error) {
      const blocked = error.name === "NotAllowedError" && !dom.audio.error;
      log(
        blocked ? "warn" : "error",
        "playback",
        blocked ? "浏览器阻止了自动播放" : "播放源载入失败",
        `${track.path} · ${error.message}`
      );
    }
  }

  function updateNowPlaying(track) {
    $("now-title").textContent = track.title;
    $("now-work").textContent = track.work || track.album || track.folder;
    $("now-credit").textContent = [track.artist, track.conductor, track.orchestra].filter(Boolean).join(" · ") || track.fileName;
    $("meta-artist").textContent = track.artist || "—";
    $("meta-conductor").textContent = track.conductor || "—";
    $("meta-orchestra").textContent = track.orchestra || "—";
    $("meta-composer").textContent = track.composer || "—";
    $("meta-year").textContent = track.year || "—";
    $("meta-album").textContent = track.album || "—";
    $("spine-album").textContent = track.album || track.work || "本地音乐";
    $("spine-year").textContent = track.year || "—";
    $("cover-letter").textContent = (track.composer || track.title || "C").trim().charAt(0).toUpperCase();
    $("cover-shell").classList.toggle("has-cover", Boolean(track.coverUrl));
    $("cover-image").src = track.coverUrl || "";
    $("transport-title").textContent = track.title;
    $("transport-artist").textContent = track.artist || track.composer || track.fileName;
    $("mini-cover").innerHTML = track.coverUrl ? `<img src="${track.coverUrl}" alt="" />` : `<span>${escapeHTML((track.title || "C").charAt(0))}</span>`;
    $("favorite-current").textContent = track.favorite ? "♥ 已收藏" : "♡ 收藏";
    $("edit-current-tags").disabled = track.format !== "FLAC";
    $("edit-current-tags").textContent = track.format === "FLAC" ? "编辑 FLAC 元数据" : "仅支持 FLAC 元数据";
    $("audio-format").textContent = track.format || "—";
    $("audio-sample-rate").textContent = formatRate(track.sampleRate);
    $("audio-bit-depth").textContent = track.bits ? `${track.bits} bit` : "—";
    $("audio-bitrate").textContent = track.bitrate ? `${Math.round(track.bitrate)} kbps` : "—";
    $("audio-channels").textContent = track.channels === 1 ? "单声道" : track.channels === 2 ? "立体声" : track.channels ? `${track.channels} 声道` : "—";
    $("audio-duration").textContent = formatDuration(track.duration);
    dom.signalBadge.textContent = [track.format, track.bits ? `${track.bits} BIT` : "", track.sampleRate ? `${track.sampleRate / 1000} kHz` : ""].filter(Boolean).join(" · ");
  }

  function ensureAudioGraph() {
    if (state.audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.76;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.waveformData = new Uint8Array(state.analyser.fftSize);
    state.lowFilter = state.audioContext.createBiquadFilter();
    state.lowFilter.type = "lowshelf";
    state.lowFilter.frequency.value = 140;
    state.midFilter = state.audioContext.createBiquadFilter();
    state.midFilter.type = "peaking";
    state.midFilter.frequency.value = 1200;
    state.midFilter.Q.value = 0.85;
    state.highFilter = state.audioContext.createBiquadFilter();
    state.highFilter.type = "highshelf";
    state.highFilter.frequency.value = 6200;
    state.panner = state.audioContext.createStereoPanner ? state.audioContext.createStereoPanner() : null;
    state.sourceNode = state.audioContext.createMediaElementSource(dom.audio);
    state.sourceNode.connect(state.lowFilter);
    state.lowFilter.connect(state.midFilter);
    state.midFilter.connect(state.highFilter);
    if (state.panner) {
      state.highFilter.connect(state.panner);
      state.panner.connect(state.analyser);
    } else {
      state.highFilter.connect(state.analyser);
    }
    state.analyser.connect(state.audioContext.destination);
    applySoundControls();
    log("info", "audio", "音频分析与 EQ 引擎已初始化", `${state.audioContext.sampleRate} Hz`);
  }

  function applySoundControls() {
    if (state.lowFilter) state.lowFilter.gain.value = Number($("eq-low").value);
    if (state.midFilter) state.midFilter.gain.value = Number($("eq-mid").value);
    if (state.highFilter) state.highFilter.gain.value = Number($("eq-high").value);
    if (state.panner) state.panner.pan.value = Number($("balance").value);
  }

  function togglePlay() {
    const track = currentTrack();
    if (!track) {
      setView("library");
      log("warn", "playback", "播放失败：尚未选择曲目");
      return;
    }
    if (!dom.audio.hasAttribute("src")) {
      selectTrack(state.currentIndex, true);
      return;
    }
    ensureAudioGraph();
    state.audioContext.resume();
    if (dom.audio.paused) dom.audio.play().catch((error) => log("error", "playback", "播放失败", error.message));
    else dom.audio.pause();
  }

  function navigate(direction) {
    if (!state.tracks.length) return;
    const order = state.libraryOrder.length ? state.libraryOrder : state.tracks.map((_, index) => index);
    let currentPosition = order.indexOf(state.currentIndex);
    if (currentPosition < 0) currentPosition = 0;
    let nextIndex;
    if (state.repeat === "one" && direction > 0) nextIndex = state.currentIndex;
    else if (state.shuffle) nextIndex = order[Math.floor(Math.random() * order.length)];
    else {
      const nextPosition = currentPosition + direction;
      nextIndex = nextPosition >= 0 && nextPosition < order.length ? order[nextPosition] : -1;
    }
    if (nextIndex < 0) {
      if (state.repeat === "off") {
        dom.audio.pause();
        return;
      }
      const wrappedPosition = (currentPosition + direction + order.length) % order.length;
      nextIndex = order[wrappedPosition];
    }
    selectTrack(nextIndex, true);
  }

  function toggleFavorite() {
    const track = currentTrack();
    if (!track) return;
    track.favorite = !track.favorite;
    state.metadata[track.id] = { ...(state.metadata[track.id] || {}), favorite: track.favorite };
    saveJSON("clair-metadata", state.metadata);
    writeLocalLibraryIndex();
    updateNowPlaying(track);
    renderLibrary();
    log("info", "library", track.favorite ? "已收藏曲目" : "已取消收藏", track.title);
  }

  function openTagEditor() {
    const track = currentTrack();
    if (!track) {
      log("warn", "metadata", "无法编辑：尚未选择曲目");
      return;
    }
    if (track.format !== "FLAC") {
      log("warn", "metadata", "无法写入元数据：当前曲目不是 FLAC", track.fileName);
      window.alert("当前只支持直接写入 FLAC 的 Vorbis Comment 元数据。");
      return;
    }
    const fields = ["title", "artist", "conductor", "orchestra", "composer", "album", "work", "year"];
    for (const field of fields) $(`tag-${field}`).value = track[field] || "";
    $("tag-write-target").textContent = `将直接写入：${track.path}`;
    dom.tagDialog.showModal();
  }

  function managedTagValuesFromMap(map) {
    const values = {};
    for (const [field, rule] of Object.entries(window.ClairFlacMetadata.FIELD_RULES)) {
      values[field] = rule.aliases.map((alias) => map[alias]).find((value) => value !== undefined) || "";
    }
    return values;
  }

  async function saveMetadataBackup(track, originalVorbis, requestedValues) {
    const directory = await state.dataDirectory.getDirectoryHandle(METADATA_BACKUP_DIRECTORY_NAME, { create: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const suffix = Math.random().toString(16).slice(2, 8);
    const safeName = track.fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 96);
    const backupName = `${timestamp}-${suffix}-${safeName}.json`;
    const handle = await directory.getFileHandle(backupName, { create: true });
    const writer = await handle.createWritable();
    await writer.write(`${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      trackPath: track.path,
      fileSize: track.fileSize,
      vendor: originalVorbis.vendor,
      originalComments: originalVorbis.comments,
      requestedValues,
    }, null, 2)}\r\n`);
    await writer.close();
    return `${DATA_DIRECTORY_NAME}/${METADATA_BACKUP_DIRECTORY_NAME}/${backupName}`;
  }

  async function writeFlacInternalMetadata(track, values) {
    if (!window.ClairFlacMetadata) throw new Error("FLAC 元数据模块未载入");
    const original = await track.handle.getFile();
    const originalVorbis = await window.ClairFlacMetadata.readVorbisComments(original);
    const backupPath = await saveMetadataBackup(track, originalVorbis, values);
    const rewritten = await window.ClairFlacMetadata.rewriteFlacBlob(original, values);
    const writer = await track.handle.createWritable();
    try {
      await writer.write(rewritten.blob);
      await writer.close();
    } catch (error) {
      if (typeof writer.abort === "function") {
        try {
          await writer.abort();
        } catch {
          // The original error is more useful.
        }
      }
      throw error;
    }

    try {
      const updated = await track.handle.getFile();
      const verified = await window.ClairFlacMetadata.readVorbisComments(updated);
      for (const [field, rule] of Object.entries(window.ClairFlacMetadata.FIELD_RULES)) {
        const expected = String(values[field] ?? "").trim();
        const actual = String(verified.map[rule.canonical] ?? "").trim();
        if (actual !== expected) throw new Error(`${rule.canonical} 写入后校验不一致`);
      }
      return { beforeSize: original.size, afterSize: updated.size, backupPath };
    } catch (verificationError) {
      try {
        const current = await track.handle.getFile();
        const restored = await window.ClairFlacMetadata.rewriteFlacBlob(
          current,
          managedTagValuesFromMap(originalVorbis.map)
        );
        const rollback = await track.handle.createWritable();
        await rollback.write(restored.blob);
        await rollback.close();
        throw new Error(`写入校验失败，已按备份自动还原：${verificationError.message}`);
      } catch (rollbackError) {
        if (rollbackError.message.startsWith("写入校验失败，已按备份自动还原")) throw rollbackError;
        throw new Error(`写入校验失败且自动还原失败；备份位于 ${backupPath}：${rollbackError.message}`);
      }
    }
  }

  async function saveFlacMetadata() {
    const track = currentTrack();
    if (!track) return;
    const fields = ["title", "artist", "conductor", "orchestra", "composer", "album", "work", "year"];
    const values = {};
    for (const field of fields) {
      values[field] = $(`tag-${field}`).value.trim();
    }
    if (!window.confirm(`将直接修改 FLAC 文件内部元数据：\n${track.path}\n\n音频帧与封面会原样保留。是否继续？`)) return;
    const saveButton = $("save-tags");
    const originalLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = "正在写入并校验…";
    dom.audio.pause();
    try {
      const result = await writeFlacInternalMetadata(track, values);
      if (state.metadata[track.id]) {
        delete state.metadata[track.id].tags;
        saveJSON("clair-metadata", state.metadata);
      }
      const path = track.path;
      dom.tagDialog.close();
      log(
        "info",
        "metadata",
        "FLAC 内部元数据写入成功",
        `${path} · ${formatSize(result.beforeSize)} → ${formatSize(result.afterSize)} · 备份 ${result.backupPath}`
      );
      await refreshLibrary();
      const refreshedIndex = state.tracks.findIndex((item) => item.path === path);
      if (refreshedIndex >= 0) await selectTrack(refreshedIndex, false);
    } catch (error) {
      log("error", "metadata", "FLAC 内部元数据写入失败", `${track.path} · ${error.message}`);
      window.alert(`写入失败：${error.message}`);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  }

  function runDiagnostics() {
    let canvas2D = false;
    try {
      canvas2D = Boolean(dom.canvas.getContext("2d"));
    } catch {
      canvas2D = false;
    }
    const checks = {
      version: APP_VERSION,
      secureContext: window.isSecureContext,
      directoryPicker: typeof window.showDirectoryPicker === "function",
      audioContext: Boolean(window.AudioContext || window.webkitAudioContext),
      resizeObserver: typeof window.ResizeObserver === "function",
      canvas2D,
      directoryConnected: Boolean(state.directory),
      localDataDirectory: Boolean(state.dataDirectory),
      localLogFile: state.dataDirectory ? `${DATA_DIRECTORY_NAME}/${LOG_FILE_NAME}` : "",
      localLibraryIndex: state.dataDirectory ? `${DATA_DIRECTORY_NAME}/${LIBRARY_INDEX_FILE_NAME}` : "",
      analyserReady: Boolean(state.analyser),
      tracks: state.tracks.length,
      currentTrack: currentTrack()?.path || "",
      view: document.querySelector("[data-view-panel].is-active")?.dataset.viewPanel || "",
    };
    const requiredFailures = [
      !checks.secureContext && "非安全上下文",
      !checks.directoryPicker && "缺少文件夹访问 API",
      !checks.audioContext && "缺少 Web Audio API",
      !checks.resizeObserver && "缺少 ResizeObserver",
      !checks.canvas2D && "Canvas 2D 不可用",
    ].filter(Boolean);
    log(
      requiredFailures.length ? "warn" : "info",
      "diagnostics",
      requiredFailures.length ? "运行诊断发现兼容性问题" : "运行诊断通过",
      JSON.stringify({ ...checks, issues: requiredFailures })
    );
  }

  async function nestedDirectory(root, parts) {
    let directory = root;
    for (const part of parts.filter(Boolean)) directory = await directory.getDirectoryHandle(part, { create: true });
    return directory;
  }

  async function copyFileWithoutOverwrite(track, targetDirectory) {
    try {
      await targetDirectory.getFileHandle(track.fileName);
      throw new Error("目标位置存在同名文件");
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
    const target = await targetDirectory.getFileHandle(track.fileName, { create: true });
    const writer = await target.createWritable();
    await writer.write(await track.handle.getFile());
    await writer.close();
  }

  async function removeOriginal(track) {
    await track.parentHandle.getFileHandle(track.fileName);
    await track.parentHandle.removeEntry(track.fileName);
  }

  async function moveTrackToTrash(track) {
    const trash = await state.directory.getDirectoryHandle(TRASH_NAME, { create: true });
    const parts = track.path.split("/").slice(1, -1);
    const target = await nestedDirectory(trash, parts);
    await copyFileWithoutOverwrite(track, target);
    await removeOriginal(track);
  }

  async function restoreTrack(track) {
    const parts = track.path.split("/").slice(1, -1);
    const target = await nestedDirectory(state.directory, parts);
    await copyFileWithoutOverwrite(track, target);
    await removeOriginal(track);
  }

  async function processSelected(mode) {
    const selectedTracks = state.tracks.filter((track) => state.selected.has(track.id));
    if (!selectedTracks.length) {
      log("warn", "files", mode === "restore" ? "尚未选择要恢复的文件" : "尚未选择要移入回收站的文件");
      return;
    }
    const action = mode === "restore" ? "恢复" : "移至回收站";
    if (!window.confirm(`${action}已选择的 ${selectedTracks.length} 首曲目吗？`)) return;
    let success = 0;
    for (const track of selectedTracks) {
      try {
        if (mode === "restore") await restoreTrack(track);
        else await moveTrackToTrash(track);
        success++;
        log("info", "files", `${action}成功`, track.path);
      } catch (error) {
        log("error", "files", `${action}失败：${track.fileName}`, error.message);
      }
    }
    state.selected.clear();
    await refreshLibrary();
    log("info", "files", `${action}完成`, `${success} / ${selectedTracks.length}`);
  }

  async function toggleTrash() {
    if (!state.directory) return;
    if (state.trashMode) {
      state.trashMode = false;
      await refreshLibrary();
      return;
    }
    try {
      const trash = await state.directory.getDirectoryHandle(TRASH_NAME);
      await loadLibrarySources(await scanDirectory(trash, `${TRASH_NAME}/`, true), { trashMode: true });
    } catch (error) {
      if (error.name === "NotFoundError") {
        await loadLibrarySources([], { trashMode: true });
        log("info", "files", "回收站为空");
      } else log("error", "files", "打开回收站失败", error.message);
    }
  }

  async function renameCurrent() {
    const track = currentTrack();
    if (!track) return;
    const extension = (track.fileName.match(/\.[^.]+$/) || [""])[0];
    let name = window.prompt("输入新的文件名", track.fileName);
    if (!name || name === track.fileName) return;
    if (!/\.[^.]+$/.test(name)) name += extension;
    try {
      await track.parentHandle.getFileHandle(name);
      throw new Error("同名文件已存在");
    } catch (error) {
      if (error.name !== "NotFoundError") {
        log("error", "files", "重命名失败", error.message);
        return;
      }
    }
    try {
      const target = await track.parentHandle.getFileHandle(name, { create: true });
      const writer = await target.createWritable();
      await writer.write(await track.handle.getFile());
      await writer.close();
      await removeOriginal(track);
      log("info", "files", "重命名成功", `${track.fileName} → ${name}`);
      await refreshLibrary();
    } catch (error) {
      log("error", "files", "重命名失败", error.message);
    }
  }

  function runHealthCheck() {
    const signatures = new Map();
    for (const track of state.tracks) {
      if (!signatures.has(track.signature)) signatures.set(track.signature, []);
      signatures.get(track.signature).push(track);
    }
    const duplicateGroups = [...signatures.values()].filter((group) => group.length > 1).length;
    const classicalTracks = state.tracks.filter(window.ClairLibraryModel.isClassicalTrack);
    const coreMissing = state.tracks.filter((track) =>
      !track.title || (!track.artist && !track.composer && !track.orchestra)
    ).length;
    const classicalIncomplete = classicalTracks.filter((track) =>
      !track.composer || !track.work || !track.conductor || !track.orchestra
    ).length;
    $("health-total").textContent = String(state.tracks.length);
    $("health-duplicates").textContent = String(duplicateGroups);
    $("health-classical").textContent = String(classicalTracks.length);
    $("health-core").textContent = String(coreMissing);
    $("health-classical-incomplete").textContent = String(classicalIncomplete);
    $("health-year").textContent = String(state.tracks.filter((track) => !track.year).length);
    dom.healthPanel.classList.remove("is-hidden");
    log(
      "info",
      "health",
      "音乐库体检完成",
      `${duplicateGroups} 组疑似重复 · ${coreMissing} 首基础资料缺失 · ${classicalIncomplete} 首古典资料不完整`
    );
  }

  function exportM3U() {
    const lines = ["#EXTM3U"];
    const orderedItems = window.ClairLibraryModel.flattenTreeItems(getLibraryTree());
    for (const { track } of orderedItems) {
      lines.push(`#EXTINF:${Math.round(track.duration) || -1},${track.artist || track.composer} - ${track.title}`);
      lines.push(track.path);
    }
    downloadBlob("clair-playlist.m3u", lines.join("\n"), "audio/x-mpegurl;charset=utf-8");
    log("info", "library", "已导出 M3U", `${getFilteredTracks().length} 首`);
  }

  function downloadBlob(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    dom.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    dom.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  }

  function drawVisualizer(time) {
    try {
      const canvas = dom.canvas;
      const context = canvas.getContext("2d");
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      if (!width || !height) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const styles = getComputedStyle(document.body);
      const accent = styles.getPropertyValue("--accent-bright").trim();
      const fill = styles.getPropertyValue("--viz-fill").trim();
      const secondary = styles.getPropertyValue("--viz-secondary").trim();
      const grid = styles.getPropertyValue("--line").trim();
      const muted = styles.getPropertyValue("--faint").trim();
      const active = Boolean(state.analyser && !dom.audio.paused && state.frequencyData);
      const bars = state.visualLevels.length;
      const left = 6;
      const right = width - 6;
      const top = 8;
      const baseline = height * 0.79;
      const plotWidth = right - left;
      const maximumFrequency = Math.min(state.audioContext ? state.audioContext.sampleRate / 2 : 24000, 20000);
      const levels = new Float32Array(bars);
      let average = 0;

      if (active) {
        state.analyser.getByteFrequencyData(state.frequencyData);
        state.analyser.getByteTimeDomainData(state.waveformData);
        for (let index = 0; index < bars; index++) {
          const low = 25 * Math.pow(maximumFrequency / 25, index / bars);
          const high = 25 * Math.pow(maximumFrequency / 25, (index + 1) / bars);
          const start = Math.max(0, Math.floor(low / maximumFrequency * state.frequencyData.length));
          const end = Math.min(state.frequencyData.length - 1, Math.ceil(high / maximumFrequency * state.frequencyData.length));
          let sum = 0;
          let count = 0;
          for (let bin = start; bin <= end; bin++) {
            sum += state.frequencyData[bin] * state.frequencyData[bin];
            count++;
          }
          levels[index] = Math.min(1, Math.sqrt(sum / Math.max(1, count)) / 255);
          average += levels[index];
        }
      } else {
        const seconds = time / 1000;
        for (let index = 0; index < bars; index++) {
          const envelope = Math.exp(-index / 92);
          const value =
            0.08 +
            Math.max(0, Math.sin(index * 0.23 + seconds * 1.45)) * 0.12 +
            Math.max(0, Math.cos(index * 0.071 - seconds * 0.92)) * 0.08;
          levels[index] = value * envelope;
          average += levels[index];
        }
      }
      average /= bars;

      context.strokeStyle = grid;
      context.lineWidth = 1;
      for (let row = 1; row <= 4; row++) {
        const y = top + (baseline - top) * row / 5;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.stroke();
      }

      const barGradient = context.createLinearGradient(0, top, 0, baseline);
      barGradient.addColorStop(0, accent);
      barGradient.addColorStop(1, fill);
      const envelopePoints = [];
      for (let index = 0; index < bars; index++) {
        const speed = active ? 0.38 : 0.12;
        state.visualLevels[index] += (levels[index] - state.visualLevels[index]) * speed;
        state.visualPeaks[index] = Math.max(state.visualLevels[index], state.visualPeaks[index] - 0.008);
        const slot = plotWidth / bars;
        const barWidth = Math.max(2, slot - 2);
        const x = left + index * slot + (slot - barWidth) / 2;
        const barHeight = Math.max(2, state.visualLevels[index] * (baseline - top) * 0.94);
        const y = baseline - barHeight;
        context.globalAlpha = 0.78;
        context.fillStyle = barGradient;
        context.fillRect(x, y, barWidth, barHeight);
        context.globalAlpha = 0.95;
        context.fillStyle = accent;
        context.fillRect(x, baseline - state.visualPeaks[index] * (baseline - top) * 0.94, barWidth, 1.5);
        envelopePoints.push([x + barWidth / 2, y]);
      }

      context.globalAlpha = 1;
      context.strokeStyle = accent;
      context.lineWidth = 1.2;
      context.beginPath();
      envelopePoints.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.stroke();

      context.strokeStyle = secondary;
      context.globalAlpha = 0.7;
      context.lineWidth = 1;
      context.beginPath();
      const waveY = baseline + (height - baseline) * 0.48;
      const waveHeight = Math.max(13, (height - baseline) * 0.33);
      for (let index = 0; index < 220; index++) {
        const x = left + index / 219 * plotWidth;
        const sample = active
          ? (state.waveformData[Math.floor(index / 219 * (state.waveformData.length - 1))] - 128) / 128
          : Math.sin(index * 0.17 + time / 190) * 0.25 + Math.sin(index * 0.052 - time / 310) * 0.13;
        const y = waveY + sample * waveHeight;
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      }
      context.stroke();
      context.globalAlpha = 1;
      $("analyzer-level").textContent = active ? `${(20 * Math.log10(Math.max(average, 0.001))).toFixed(1)} dBFS` : "IDLE MOTION";
      $("analyzer-level").style.color = active ? accent : muted;
    } catch (error) {
      if (error.message !== state.lastVisualizerError) {
        state.lastVisualizerError = error.message;
        log("error", "visualizer", "频谱渲染异常", error.message);
      }
    } finally {
      requestAnimationFrame(drawVisualizer);
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    document.querySelectorAll("[data-view-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump)));
    $("choose-library").addEventListener("click", chooseLibrary);
    $("theme-select").addEventListener("change", (event) => applyTheme(event.target.value));
    $("refresh-library").addEventListener("click", refreshLibrary);
    dom.search.addEventListener("input", renderLibrary);
    dom.groupMode.addEventListener("change", () => {
      renderLibrary();
      writeLocalSettings();
    });
    dom.sortMode.addEventListener("change", () => {
      renderLibrary();
      writeLocalSettings();
    });
    dom.trackList.addEventListener("click", (event) => {
      const groupHeader = event.target.closest(".group-header");
      if (groupHeader) {
        const key = groupHeader.dataset.groupKey;
        const collapsing = !state.collapsedGroups.has(key);
        if (collapsing) state.collapsedGroups.add(key);
        else state.collapsedGroups.delete(key);
        saveCollapsedGroups();
        renderLibrary();
        log("debug", "library", collapsing ? "已折叠分组" : "已展开分组", key.split("\u241f").slice(1).join("\u241f"));
        return;
      }
      const checkbox = event.target.closest(".track-select");
      if (checkbox) {
        event.stopPropagation();
        checkbox.checked ? state.selected.add(checkbox.dataset.trackId) : state.selected.delete(checkbox.dataset.trackId);
        updateSelectionUI();
        return;
      }
      const row = event.target.closest(".track-row");
      if (row) selectTrack(Number(row.dataset.trackIndex), true);
    });
    $("select-visible").addEventListener("click", () => {
      getFilteredTracks().forEach(({ track }) => state.selected.add(track.id));
      renderLibrary();
    });
    $("clear-selection").addEventListener("click", () => {
      state.selected.clear();
      renderLibrary();
    });
    $("collapse-groups").addEventListener("click", () => setVisibleGroupsCollapsed(true));
    $("expand-groups").addEventListener("click", () => setVisibleGroupsCollapsed(false));
    $("trash-selected").addEventListener("click", () => processSelected("trash"));
    $("restore-selected").addEventListener("click", () => processSelected("restore"));
    $("toggle-trash").addEventListener("click", toggleTrash);
    $("rename-current").addEventListener("click", renameCurrent);
    $("health-check").addEventListener("click", runHealthCheck);
    $("export-m3u").addEventListener("click", exportM3U);
    $("favorite-current").addEventListener("click", toggleFavorite);
    $("edit-current-tags").addEventListener("click", openTagEditor);
    $("save-tags").addEventListener("click", saveFlacMetadata);
    $("open-sound").addEventListener("click", () => dom.soundDialog.showModal());
    ["eq-low", "eq-mid", "eq-high", "balance"].forEach((id) => $(id).addEventListener("input", applySoundControls));
    dom.play.addEventListener("click", togglePlay);
    dom.previous.addEventListener("click", () => navigate(-1));
    dom.next.addEventListener("click", () => navigate(1));
    dom.shuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      dom.shuffle.classList.toggle("is-active", state.shuffle);
      log("debug", "playback", state.shuffle ? "已开启随机播放" : "已关闭随机播放");
    });
    dom.repeat.addEventListener("click", () => {
      state.repeat = state.repeat === "all" ? "one" : state.repeat === "one" ? "off" : "all";
      dom.repeat.textContent = state.repeat === "one" ? "↻¹" : state.repeat === "off" ? "↻̸" : "↻";
      dom.repeat.classList.toggle("is-active", state.repeat !== "off");
      log("debug", "playback", "循环模式已切换", state.repeat);
    });
    dom.seek.addEventListener("input", () => {
      if (dom.audio.duration) dom.audio.currentTime = dom.audio.duration * Number(dom.seek.value) / 1000;
    });
    dom.volume.addEventListener("input", () => { dom.audio.volume = Number(dom.volume.value); });
    dom.audio.addEventListener("play", () => {
      dom.play.textContent = "Ⅱ";
      log("info", "playback", "开始播放", currentTrack()?.title || "");
    });
    dom.audio.addEventListener("pause", () => { dom.play.textContent = "▶"; });
    dom.audio.addEventListener("ended", () => navigate(1));
    dom.audio.addEventListener("loadedmetadata", () => {
      const track = currentTrack();
      if (track) {
        track.duration = dom.audio.duration;
        $("audio-duration").textContent = formatDuration(track.duration);
      }
      dom.totalTime.textContent = formatDuration(dom.audio.duration);
    });
    dom.audio.addEventListener("timeupdate", () => {
      if (!dom.audio.duration) return;
      dom.currentTime.textContent = formatDuration(dom.audio.currentTime);
      dom.totalTime.textContent = formatDuration(dom.audio.duration);
      dom.seek.value = String(Math.round(dom.audio.currentTime / dom.audio.duration * 1000));
    });
    dom.audio.addEventListener("error", () => {
      if (!dom.audio.hasAttribute("src")) return;
      const track = currentTrack();
      const mediaError = dom.audio.error;
      const errorNames = {
        1: "MEDIA_ERR_ABORTED",
        2: "MEDIA_ERR_NETWORK",
        3: "MEDIA_ERR_DECODE",
        4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
      };
      log("error", "playback", "音频文件无法播放", JSON.stringify({
        code: mediaError?.code || 0,
        reason: errorNames[mediaError?.code] || "UNKNOWN",
        message: mediaError?.message || "",
        hint: mediaError?.code === 4 ? "浏览器不支持该文件的格式/编码（AIFF 不受 Chrome/Edge 支持），可转换后重试" : "",
        path: track?.path || "",
        mimeType: track?.mimeType || "",
        networkState: dom.audio.networkState,
        readyState: dom.audio.readyState,
      }));
    });
    dom.logLevel.addEventListener("change", renderLogs);
    $("run-diagnostics").addEventListener("click", runDiagnostics);
    $("export-logs").addEventListener("click", exportLogs);
    $("clear-logs").addEventListener("click", async () => {
      state.logs = [];
      saveJSON("clair-logs", state.logs);
      renderLogs();
      await clearLocalLogFile();
    });
    document.addEventListener("keydown", (event) => {
      if (event.target.matches("input,select,textarea,button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowRight") navigate(1);
      else if (event.code === "ArrowLeft") navigate(-1);
      else if (event.key.toLocaleLowerCase() === "f") toggleFavorite();
    });
    window.addEventListener("beforeunload", () => {
      clearPlaybackSource();
      releaseObjectUrls();
    });
    new ResizeObserver(resizeCanvas).observe(dom.canvas);
  }

  async function boot() {
    removeLegacyDisplayOverrides();
    applyTheme(state.theme);
    bindEvents();
    resizeCanvas();
    requestAnimationFrame(drawVisualizer);
    renderLibrary();
    renderLogs();
    updateSourceState("尚未连接", false);
    log("info", "system", `Clair ${APP_VERSION} 已启动`, "可视化引擎正在运行");
    await restoreRememberedDirectory();
  }

  boot().catch((error) => log("error", "system", "应用启动失败", error.message));
})();
