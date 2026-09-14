(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const APP_VERSION = "3.2.0";
  // 配色派生（自选强调色 / 底色的对比度兜底）在 theme-model.js，先于本文件加载。
  const THEME_MODEL = window.ClairThemeModel || null;
  // 主题按"生成机制家族"分为四类，每类保留一套；每套都有明 / 暗两种模式。
  // 每套主题一个独有的"生成机制"，见 styles.css 的 --mechanism。
  // 这里不重复声明机制，只用它选频谱画法，保证"不同主题不同观感"。
  const THEMES = ["sakura", "aurora", "chrome", "tide"];
  const THEME_GROUPS = Object.freeze([
    Object.freeze({ label: "纸墨", themes: Object.freeze(["sakura"]) }),
    Object.freeze({ label: "光带", themes: Object.freeze(["aurora"]) }),
    Object.freeze({ label: "镜面", themes: Object.freeze(["chrome"]) }),
    Object.freeze({ label: "水波", themes: Object.freeze(["tide"]) }),
  ]);
  const THEME_DETAILS = Object.freeze({
    sakura: { name: "樱花", category: "纸墨", visualizer: "sakura", description: "纸墨 · 和纸纤维、漆墨线脚与朱砂印" },
    aurora: { name: "极光", category: "光带", visualizer: "aura", description: "光带 · 竖向光幕带缓慢横向漂移" },
    chrome: { name: "镀铬", category: "镜面", visualizer: "metal", description: "镜面 · 拉丝镜面、高光条与亮边斜面" },
    tide: { name: "潮汐", category: "水波", visualizer: "hydrophone", description: "水波 · 折射焦散网纹与垂直光柱" },
  });
  // 分类合并后删除的三套主题 → 保留主题。旧深链（?theme=bloom）、旧
  // localStorage 与旧 settings.json 都能靠它平滑落到新阵容，不至于失效。
  const LEGACY_THEME_ALIASES = Object.freeze({ bloom: "sakura", ember: "aurora", mono: "chrome" });
  const MODE_CHOICES = THEME_MODEL ? THEME_MODEL.MODE_CHOICES : ["auto", "light", "dark"];
  const THEME_STORAGE_KEY = "clair-theme";
  const MODE_STORAGE_KEY = "clair-theme-mode";
  const ACCENT_STORAGE_KEY = "clair-accent";
  const BASE_STORAGE_KEY = "clair-base";
  // 主题来源优先级：URL 的 ?theme= 深链 > 上次选择 > 旧名归并 > 默认。
  // 深链便于分享某个主题，也让无头截图/回归截图可以逐主题渲染。
  const requestedTheme = new URLSearchParams(location.search).get("theme");
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const initialTheme = THEMES.includes(requestedTheme)
    ? requestedTheme
    : THEMES.includes(LEGACY_THEME_ALIASES[requestedTheme])
      // 旧深链（?theme=bloom）优先于"上次选择"，否则分享出去的链接会被
      // 本机存档盖掉，指向另一个主题。
      ? LEGACY_THEME_ALIASES[requestedTheme]
      : THEMES.includes(storedTheme)
        ? storedTheme
        : THEMES.includes(LEGACY_THEME_ALIASES[storedTheme])
          ? LEGACY_THEME_ALIASES[storedTheme]
          // 兜底必须是主题清单里的真实成员：写死主题名的话，
          // 一旦主题阵容调整，这里会指向已不存在的主题，
          // THEME_DETAILS 取不到值 → 启动流程抛错 → 事件监听全部绑不上。
          : THEMES[0];
  // 明暗：mode 是"用户选择"（auto / light / dark），data-mode 上只落 light|dark。
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
  const initialModeChoice = MODE_CHOICES.includes(requestedMode)
    ? requestedMode
    : MODE_CHOICES.includes(storedMode)
      ? storedMode
      : "auto";
  // 自选配色：深链 > 上次选择；null 表示"跟随主题作者值"。
  const requestedAccent = new URLSearchParams(location.search).get("accent");
  const requestedBase = new URLSearchParams(location.search).get("base");
  const initialAccent = THEME_MODEL
    ? THEME_MODEL.normalizeHex(requestedAccent) || THEME_MODEL.normalizeHex(localStorage.getItem(ACCENT_STORAGE_KEY))
    : null;
  const initialBase = THEME_MODEL
    ? THEME_MODEL.normalizeHex(requestedBase) || THEME_MODEL.normalizeHex(localStorage.getItem(BASE_STORAGE_KEY))
    : null;
  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  const systemPrefersDark = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : { matches: true, addEventListener: null };
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
  // 标签编辑/写入共用同一字段清单，避免多份手工列表漂移
  const TAG_FIELDS = ["title", "artist", "conductor", "orchestra", "composer", "album", "work", "year"];

  // 日志持久化去抖：内存/localStorage 与本地日志文件分别合并写入，
  // 避免每条日志都做整表 JSON.stringify + 打开/关闭文件。
  const LOG_MEMORY_FLUSH_MS = 400;
  const LOG_FILE_FLUSH_MS = 1200;
  let logMemoryTimer = 0;
  let logFileTimer = 0;
  let pendingFileLogs = [];
  let logsViewDirty = false;
  let logsRenderQueued = false;

  // 可视化颜色只随主题变化，按主题缓存，避免每帧 getComputedStyle
  let visualThemeColors = null;
  let visualThemeMode = "";
  let lastAnalyzerLabel = "";
  let lastAnalyzerLabelColor = "";
  let searchRenderTimer = 0;

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
    themeDescription: $("theme-description"),
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    modeButtons: document.querySelectorAll("[data-mode-choice]"),
    accentColor: $("accent-color"),
    accentHex: $("accent-hex"),
    accentReset: $("accent-reset"),
    baseColor: $("base-color"),
    baseHex: $("base-hex"),
    baseReset: $("base-reset"),
    colorHint: $("color-hint"),
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
    theme: initialTheme,
    themeMode: initialModeChoice,
    mode: THEME_MODEL
      ? THEME_MODEL.resolveMode(initialModeChoice, systemPrefersDark.matches)
      : initialModeChoice === "light" ? "light" : "dark",
    accent: initialAccent,
    base: initialBase,
    libraryMode: "none",
    remoteLibraryName: "",
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
    libraryOrder: [],
    visualLevels: new Float32Array(80),
    visualPeaks: new Float32Array(80),
    visualHistory: [],
    visualHistoryTime: 0,
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
    const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "info";
    console[consoleMethod](`[Clair][${category}] ${message}${entry.details ? ` · ${entry.details}` : ""}`);
    scheduleLogPersistence();
    if (persistLocal && state.dataDirectory) pendingFileLogs.push(entry);
    requestLogsRender();
    syncLogBadge();
    return entry;
  }

  // 日志渲染与持久化都做合并/节流：渲染只发生在日志页可见时，
  // localStorage 与磁盘写入分别去抖到一次 trailing write。
  function scheduleLogPersistence() {
    if (!logMemoryTimer) {
      logMemoryTimer = setTimeout(() => {
        logMemoryTimer = 0;
        saveJSON("clair-logs", state.logs);
      }, LOG_MEMORY_FLUSH_MS);
    }
    if (pendingFileLogs.length && !logFileTimer) {
      logFileTimer = setTimeout(flushPendingFileLogs, LOG_FILE_FLUSH_MS);
    }
  }

  function requestLogsRender() {
    logsViewDirty = true;
    const logsView = $("logs-view");
    if (logsRenderQueued || !logsView || !logsView.classList.contains("is-active")) return;
    logsRenderQueued = true;
    requestAnimationFrame(() => {
      logsRenderQueued = false;
      if (!logsViewDirty) return;
      logsViewDirty = false;
      renderLogs();
    });
  }

  function syncLogBadge() {
    const count = state.logs.filter((entry) => entry.level === "error").length;
    const text = String(count);
    if (dom.navLogCount.textContent !== text) dom.navLogCount.textContent = text;
  }

  // 单一日志行格式：所有落盘/导出/解析共享，避免多处手工拼接漂移
  function logLineText(entry) {
    const message = String(entry.message).replace(/\r?\n/g, "\\n");
    const details = String(entry.details || "").replace(/\r?\n/g, "\\n");
    return `[${entry.time}] ${String(entry.level).toUpperCase()} ${entry.category}: ${message}${details ? ` | ${details}` : ""}\r\n`;
  }

  function parseLogLine(line) {
    const match = /^\[([^\]]+)\] (DEBUG|INFO|WARN|ERROR) ([^:]+): (.*)$/.exec(line);
    if (!match) return null;
    const divider = match[4].indexOf(" | ");
    return {
      time: match[1],
      level: match[2].toLowerCase(),
      category: match[3],
      message: divider >= 0 ? match[4].slice(0, divider) : match[4],
      details: divider >= 0 ? match[4].slice(divider + 3) : "",
    };
  }

  async function flushPendingFileLogs() {
    logFileTimer = 0;
    if (!pendingFileLogs.length) return;
    const entries = pendingFileLogs.splice(0, pendingFileLogs.length);
    if (!state.dataDirectory) return;
    const lines = entries.map(logLineText);
    enqueueLocalWrite(async (directory) => {
      const handle = await directory.getFileHandle(LOG_FILE_NAME, { create: true });
      const file = await handle.getFile();
      const writer = await handle.createWritable({ keepExistingData: true });
      if (file.size > 5 * 1024 * 1024) {
        const tail = await file.slice(Math.max(0, file.size - 1024 * 1024)).text();
        const rotated = `[${new Date().toISOString()}] INFO system: 日志已自动轮转\r\n${tail}${lines.join("")}`;
        await writer.seek(0);
        await writer.write(rotated);
        await writer.truncate(new TextEncoder().encode(rotated).length);
      } else {
        await writer.seek(file.size);
        await writer.write(lines.join(""));
      }
      await writer.close();
    }, "无法写入本地日志文件");
  }

  function enqueueLocalWrite(task, failureMessage) {
    const directory = state.dataDirectory;
    if (!directory) return Promise.resolve();
    state.localWriteQueue = state.localWriteQueue
      .then(() => task(directory))
      .catch((error) => log("error", "local-storage", failureMessage, error.message, false));
    return state.localWriteQueue;
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
      const initialLines = state.logs.slice().reverse().map(logLineText).join("");
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
      const parsed = parseLogLine(line);
      if (!parsed) continue;
      entries.push({ id: `local-${parsed.time}-${index}`, ...parsed });
    }
    return entries.reverse();
  }

  function writeLocalSettings() {
    if (!state.dataDirectory) return;
    const snapshot = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      theme: state.theme,
      themeMode: state.themeMode,
      accent: state.accent || "",
      base: state.base || "",
      groupMode: dom.groupMode.value,
      sortMode: dom.sortMode.value,
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
    if (THEMES.includes(settings.theme)) {
      applyTheme(settings.theme, { persist: false, announce: false });
    } else if (THEMES.includes(LEGACY_THEME_ALIASES[settings.theme])) {
      // 旧存档里的 bloom / ember / mono：归并到同类保留主题
      applyTheme(LEGACY_THEME_ALIASES[settings.theme], { persist: false, announce: false });
    }
    // 设置文件是"随音乐目录走"的权威：字段存在就采纳（空串 = 已恢复默认）
    if (MODE_CHOICES.includes(settings.themeMode)) {
      applyMode(settings.themeMode, { persist: false, announce: false });
    }
    const settingsAccent = typeof settings.accent === "string" ? THEME_MODEL?.normalizeHex(settings.accent) : undefined;
    const settingsBase = typeof settings.base === "string" ? THEME_MODEL?.normalizeHex(settings.base) : undefined;
    if (settingsAccent !== undefined) state.accent = settingsAccent;
    if (settingsBase !== undefined) state.base = settingsBase;
    if (settingsAccent !== undefined || settingsBase !== undefined) applyCustomColors();
    const savedGroupMode = settings.groupMode === "composer" ? "classical" : settings.groupMode;
    if (["folder", "album", "artist", "classical", "smart", "year"].includes(savedGroupMode)) {
      dom.groupMode.value = savedGroupMode;
    }
    if (["path", "title", "artist", "year"].includes(settings.sortMode)) dom.sortMode.value = settings.sortMode;
    if (Array.isArray(index.tracks)) {
      for (const item of index.tracks) {
        if (!item?.path) continue;
        // localStorage 是收藏状态的实时权威（可跨文件夹/LAN 存活）；
        // 文件索引只在本地无该曲目记录时才补充，避免旧文件覆盖新操作。
        if (!(item.path in state.metadata)) {
          state.metadata[item.path] = { favorite: Boolean(item.favorite) };
        }
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
    logsViewDirty = false;
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
    syncLogBadge();
  }

  function formatLogTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  }

  function exportLogs() {
    const text = state.logs.slice().reverse().map((entry) => logLineText(entry).trimEnd()).join("\n");
    downloadBlob("clair-log.txt", text, "text/plain;charset=utf-8");
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

  // 按当前主题缓存可视化颜色与频谱模式（仅主题切换时刷新一次）
  function refreshVisualThemeCache() {
    const styles = getComputedStyle(document.body);
    visualThemeColors = {
      accent: styles.getPropertyValue("--accent-bright").trim() || "#9fb4ff",
      fill: styles.getPropertyValue("--viz-fill").trim() || "#c9a56a",
      secondary: styles.getPropertyValue("--viz-secondary").trim() || "#5a6b7c",
      grid: styles.getPropertyValue("--line").trim() || "#2a2f3a",
      muted: styles.getPropertyValue("--faint").trim() || "#8a94a6",
      // 金属高光与热浪需要"文字色"做高光、强调色做基色
      text: styles.getPropertyValue("--text").trim() || "#ffffff",
      base: styles.getPropertyValue("--accent").trim() || "#9fb4ff",
    };
    visualThemeMode = THEME_DETAILS[state.theme]?.visualizer || "bars";
    lastAnalyzerLabel = "";
    lastAnalyzerLabelColor = "";
  }

  function applyTheme(theme, { persist = true, announce = true } = {}) {
    // 兜底同样必须取自清单，不能写死主题名（写死会在主题阵容调整后崩启动）
    const nextTheme = THEMES.includes(theme) ? theme : THEMES[0];
    const details = THEME_DETAILS[nextTheme];
    state.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    document.body.dataset.visualizer = details.visualizer;
    $("theme-select").value = nextTheme;
    if (dom.themeDescription) dom.themeDescription.textContent = details.description;
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    refreshVisualThemeCache();
    state.visualHistory = [];
    state.visualHistoryTime = 0;
    // 底色/强调色的派生依赖"当前主题 + 当前模式"的基准色，换主题后要重算
    applyCustomColors();
    if (persist) writeLocalSettings();
    if (announce) log("debug", "ui", "已切换界面主题", `${nextTheme} · ${details.description}`);
  }

  /* ---------- 明暗模式 ---------- */

  function applyMode(choice, { persist = true, announce = true } = {}) {
    const nextChoice = MODE_CHOICES.includes(choice) ? choice : "auto";
    const resolved = THEME_MODEL
      ? THEME_MODEL.resolveMode(nextChoice, Boolean(systemPrefersDark.matches))
      : nextChoice === "light" ? "light" : "dark";
    state.themeMode = nextChoice;
    state.mode = resolved;
    document.body.dataset.mode = resolved;
    dom.modeButtons.forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.modeChoice === nextChoice));
    });
    localStorage.setItem(MODE_STORAGE_KEY, nextChoice);
    // 亮色的对比度目标与暗色不同，配色覆盖必须跟着重算
    applyCustomColors();
    refreshVisualThemeCache();
    state.visualHistory = [];
    state.visualHistoryTime = 0;
    if (persist) writeLocalSettings();
    if (announce) {
      log("debug", "ui", "已切换明暗模式", nextChoice === "auto" ? `跟随系统 → ${resolved}` : resolved);
    }
  }

  /* ---------- 自选强调色 / 底色 ---------- */

  // 只读取对比度基准需要的两项；读取前必须保证没有本模块写入的内联覆盖。
  function readBasePalette() {
    const styles = getComputedStyle(document.body);
    return {
      bg: styles.getPropertyValue("--bg").trim(),
      surface: styles.getPropertyValue("--surface").trim(),
    };
  }

  function clearCustomColorTokens() {
    if (!THEME_MODEL) return;
    for (const token of Object.values(THEME_MODEL.PALETTE_TOKENS)) {
      document.body.style.removeProperty(token);
    }
    ["--accent", "--accent-bright", "--accent-deep", "--grad-1", "--grad-3"].forEach((token) => {
      document.body.style.removeProperty(token);
    });
  }

  // 用户自选的配色以行内自定义属性落在 body 上：内联样式优先级最高，
  // 且 --glow / --accent-soft / --viz-fill / --line 等派生令牌会在
  // 主题块里按新的 --accent / --text 重新解析，自动跟随。
  function applyCustomColors() {
    clearCustomColorTokens();
    if (!THEME_MODEL || (!state.accent && !state.base)) {
      updateColorInputs();
      syncThemeColor();
      return;
    }
    const result = THEME_MODEL.buildOverrides({
      accent: state.accent,
      base: state.base,
      mode: state.mode,
      current: readBasePalette(),
    });
    for (const [token, value] of Object.entries(result.tokens)) {
      document.body.style.setProperty(token, value);
    }
    const message = result.warnings.length
      ? result.warnings.map((warning) => warning.message).join("；")
      : "";
    if (dom.colorHint) {
      dom.colorHint.textContent = message || describeCustomColors();
    }
    if (message) log("warn", "ui", "自选配色未能完全应用", message);
    updateColorInputs();
    syncThemeColor();
  }

  function describeCustomColors() {
    const parts = [];
    if (state.accent) parts.push(`强调色 ${state.accent}`);
    if (state.base) parts.push(`底色 ${state.base}`);
    return parts.length ? `已自定义：${parts.join(" · ")}（已按当前模式校正对比度）` : "";
  }

  // theme-color 决定浏览器 UI / 首帧底色，必须跟当前实际底色一致。
  function syncThemeColor() {
    if (!dom.themeMeta) return;
    const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    if (bg) dom.themeMeta.setAttribute("content", bg);
  }

  function updateColorInputs() {
    const styles = getComputedStyle(document.body);
    const accentValue = state.accent || styles.getPropertyValue("--accent").trim() || "#000000";
    const baseValue = state.base || styles.getPropertyValue("--bg").trim() || "#000000";
    if (dom.accentColor) dom.accentColor.value = accentValue;
    if (dom.accentHex && document.activeElement !== dom.accentHex) dom.accentHex.value = accentValue;
    if (dom.baseColor) dom.baseColor.value = baseValue;
    if (dom.baseHex && document.activeElement !== dom.baseHex) dom.baseHex.value = baseValue;
    document.querySelectorAll("[data-accent-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(state.accent === button.dataset.accentPreset));
    });
    document.querySelectorAll("[data-base-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(state.base === button.dataset.basePreset));
    });
  }

  // kind: "accent" | "base"；rawValue 为 null / "" 表示恢复主题默认。
  function setCustomColor(kind, rawValue) {
    const label = kind === "accent" ? "强调色" : "底色";
    let normalized = null;
    if (rawValue != null && rawValue !== "") {
      normalized = THEME_MODEL ? THEME_MODEL.normalizeHex(rawValue) : null;
      if (!normalized) {
        log("warn", "ui", `${label}不是合法的十六进制颜色`, String(rawValue));
        updateColorInputs();
        return;
      }
    }
    state[kind] = normalized;
    localStorage.setItem(kind === "accent" ? ACCENT_STORAGE_KEY : BASE_STORAGE_KEY, normalized || "");
    applyCustomColors();
    refreshVisualThemeCache();
    state.visualHistory = [];
    state.visualHistoryTime = 0;
    writeLocalSettings();
    log("debug", "ui", normalized ? `已设置${label}` : `已恢复默认${label}`, normalized || "");
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
      const extension = (file.name.split(".").pop() || "").toLocaleLowerCase();
      if (magic === "ID3" || extension === "mp3") {
        const parsed = parseId3(bytes);
        info = finishMp3Info(bytes, parsed, file);
        info.tags ||= normalizeTags({});
        info.format = "MP3";
      } else {
        // Ogg/Opus/M4A/AAC/AIFF 等容器不做脆弱的 MPEG 帧同步扫描，
        // 避免把二进制误判为采样率/码率/时长；这些信息交给 <audio> 元数据。
        info = {
          format: (extension || "AUDIO").toUpperCase(),
          sampleRate: 0,
          bits: 0,
          channels: 0,
          duration: 0,
          bitrate: 0,
          coverUrl: "",
          tags: normalizeTags({}),
        };
      }
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

  function clearPlaybackSource({ cancelPending = true } = {}) {
    if (cancelPending) state.playRequestId++;
    dom.audio.pause();
    dom.audio.removeAttribute("src");
    delete dom.audio.dataset.playRequest;
    delete dom.audio.dataset.trackPath;
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
    let failedCount = 0;
    const results = await mapConcurrent(sorted, async (source) => {
      let info;
      try {
        info = await parseAudioFile(source.file);
      } catch (error) {
        failedCount++;
        log("warn", "library", "跳过无法解析的文件", `${source.path} · ${error.message}`);
        return null;
      }
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
    const tracks = results.filter(Boolean);
    if (failedCount) log("warn", "library", "部分文件解析失败已跳过", `${failedCount} 个文件`);
    window.ClairLibraryModel.assignStableIds(tracks);
    tracks.forEach(applyMetadataOverride);
    saveJSON("clair-metadata", state.metadata);
    return tracks;
  }

  function releaseTrackCoverUrls(tracks) {
    for (const track of tracks) {
      if (!track?.coverUrl) continue;
      URL.revokeObjectURL(track.coverUrl);
      state.objectUrls.delete(track.coverUrl);
    }
  }

  function currentTrackPath() {
    return state.tracks[state.currentIndex]?.path || "";
  }

  // 操作按钮可见性只由这里决定（远程只读/回收站视图）；不再依赖 CSS !important。
  function syncActionVisibility() {
    const remote = state.libraryMode === "remote";
    const trash = state.trashMode;
    $("toggle-trash").textContent = trash ? "返回音乐库" : "查看回收站";
    $("trash-selected").classList.toggle("is-hidden", remote || trash);
    $("restore-selected").classList.toggle("is-hidden", remote || !trash);
    $("toggle-trash").classList.toggle("is-hidden", remote);
    $("rename-current").classList.toggle("is-hidden", remote);
    $("edit-current-tags").classList.toggle("is-hidden", remote);
    $("save-tags").classList.toggle("is-hidden", remote);
  }

  async function loadLibrarySources(sources, { trashMode = false, token = null, preserve = false } = {}) {
    const loadToken = token ?? ++state.libraryLoadToken;
    // 进入函数就先校验代际：被取代的加载不应再做任何破坏性清空
    if (token !== null && token !== state.libraryLoadToken) return;

    const previousTracks = state.tracks;
    const previousPath = preserve ? currentTrackPath() : "";
    const previousIds = new Set(state.selected);

    if (!preserve) {
      releaseObjectUrls();
      clearPlaybackSource();
      resetPlayerDisplay();
      state.selected.clear();
      state.tracks = [];
      state.currentIndex = -1;
      renderLibrary();
    }
    state.trashMode = trashMode;

    if (!sources.length) {
      if (preserve) {
        releaseTrackCoverUrls(previousTracks);
        clearPlaybackSource();
        resetPlayerDisplay();
        state.selected.clear();
        state.currentIndex = -1;
        state.tracks = [];
        renderLibrary();
      }
      syncActionVisibility();
      updateSourceState(trashMode ? "回收站为空" : "文件夹中没有音频", false);
      dom.navTrackCount.textContent = "0";
      writeLocalLibraryIndex();
      log("warn", "library", trashMode ? "回收站为空" : "所选文件夹没有可识别音频");
      return;
    }

    log("info", "library", `开始解析 ${sources.length} 首曲目`);
    const builtTracks = await buildTracks(sources);
    if (loadToken !== state.libraryLoadToken) {
      releaseTrackCoverUrls(builtTracks);
      log("debug", "library", "已丢弃过期的音乐库扫描结果", `${sources.length} 首`);
      return;
    }
    state.tracks = builtTracks;
    if (preserve) {
      // 稳定 id 由路径/签名决定，重扫前后一致，因此可保留选择与当前曲目
      const available = new Set(builtTracks.map((track) => track.id));
      state.selected = new Set([...previousIds].filter((id) => available.has(id)));
      const newIndex = previousPath ? builtTracks.findIndex((track) => track.path === previousPath) : -1;
      if (newIndex >= 0) {
        state.currentIndex = newIndex;
        updateNowPlaying(builtTracks[newIndex]);
      } else if (dom.audio.hasAttribute("src")) {
        // 正在播放/暂停的文件被本次操作移走、重命名或删除：优雅复位
        clearPlaybackSource();
        resetPlayerDisplay();
        state.currentIndex = -1;
      } else {
        resetPlayerDisplay();
        state.currentIndex = -1;
      }
      // 播放器 DOM 已切到新封面后，才回收上一批封面 URL，避免破图
      releaseTrackCoverUrls(previousTracks);
    } else {
      state.selected.clear();
    }
    renderLibrary();
    syncActionVisibility();
    if (state.libraryMode !== "remote") {
      updateSourceState(`${state.directory?.name || ""} · ${state.tracks.length} 首`, true);
    }
    dom.navTrackCount.textContent = String(state.tracks.length);
    writeLocalLibraryIndex();
    log("info", "library", "音乐库载入完成", `${state.tracks.length} 首`);
  }

  function updateLibraryModeUI() {
    const remote = state.libraryMode === "remote";
    document.body.classList.toggle("is-remote-library", remote);
    $("connect-lan-library").textContent = remote ? "\u5df2\u8fde\u63a5\u5c40\u57df\u7f51" : "\u5c40\u57df\u7f51\u66f2\u5e93";
    $("local-data-state").textContent = remote
      ? "\u5c40\u57df\u7f51\u6a21\u5f0f\uff1aSamba \u97f3\u4e50\u6587\u4ef6\u4fdd\u6301\u53ea\u8bfb"
      : state.directory
        ? `\u672c\u5730\u6570\u636e\uff1a${state.directory.name} / ${DATA_DIRECTORY_NAME}`
        : "\u672c\u5730\u6570\u636e\uff1a\u8fde\u63a5\u540e\u521b\u5efa .Clair";
    syncActionVisibility();
  }

  // 带超时的 fetch：局域网主机吞包时不至于让 UI 无限停留在"正在连接…"
  async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: options.cache || "no-store" });
    } finally {
      clearTimeout(timer);
    }
  }

  async function connectRemoteLibrary({ silent = false } = {}) {
    try {
      updateSourceState("\u6b63\u5728\u8fde\u63a5\u5c40\u57df\u7f51\u66f2\u5e93\u2026", false);
      const statusResponse = await fetchWithTimeout("/api/status");
      if (!statusResponse.ok) {
        if (silent && statusResponse.status === 404) {
          updateSourceState("\u5c1a\u672a\u8fde\u63a5", false);
          return false;
        }
        throw new Error("\u5f53\u524d\u670d\u52a1\u672a\u542f\u7528\u5c40\u57df\u7f51\u66f2\u5e93");
      }
      const status = await statusResponse.json();
      if (!status.configured) throw new Error("\u670d\u52a1\u7aef\u5c1a\u672a\u914d\u7f6e Samba \u97f3\u4e50\u76ee\u5f55");
      const response = await fetchWithTimeout("/api/library");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `\u66f2\u5e93\u8bf7\u6c42\u5931\u8d25\uff08HTTP ${response.status}\uff09`);
      ++state.libraryLoadToken;
      releaseObjectUrls();
      clearPlaybackSource();
      resetPlayerDisplay();
      state.selected.clear();
      state.currentIndex = -1;
      state.directory = null;
      state.dataDirectory = null;
      state.trashMode = false;
      state.libraryMode = "remote";
      state.remoteLibraryName = payload.libraryName || status.libraryName || "Samba \u97f3\u4e50\u5e93";
      state.tracks = (Array.isArray(payload.tracks) ? payload.tracks : []).map((item) => {
        const tags = {
          title: item.title || "", artist: item.artist || "", albumArtist: item.albumArtist || "",
          conductor: item.conductor || "", orchestra: item.orchestra || "", composer: item.composer || "",
          album: item.album || "", work: item.work || "", year: item.year || "", genre: item.genre || "",
          trackNumber: item.trackNumber || "", discNumber: item.discNumber || "",
        };
        return {
          ...item,
          id: "",
          stableKey: `remote:${item.path}`,
          signature: `remote:${item.path}`,
          folder: String(item.path || "").split("/").slice(0, -1).join(" / "),
          tags,
          remote: true,
          coverUrl: "",
        };
      });
      window.ClairLibraryModel.assignStableIds(state.tracks);
      state.tracks.forEach(applyMetadataOverride);
      renderLibrary();
      updateLibraryModeUI();
      updateSourceState(`${state.remoteLibraryName} \u00b7 ${state.tracks.length} \u9996 \u00b7 \u53ea\u8bfb`, true);
      dom.navTrackCount.textContent = String(state.tracks.length);
      log("info", "network", "\u5c40\u57df\u7f51\u66f2\u5e93\u5df2\u8fde\u63a5", `${state.remoteLibraryName} \u00b7 ${state.tracks.length} \u9996`);
      return true;
    } catch (error) {
      if (silent) {
        updateSourceState("\u5c1a\u672a\u8fde\u63a5", false);
        return false;
      }
      updateSourceState("\u5c40\u57df\u7f51\u8fde\u63a5\u5931\u8d25", false);
      log("error", "network", "\u5c40\u57df\u7f51\u66f2\u5e93\u8fde\u63a5\u5931\u8d25", error.message);
      window.alert(`\u8fde\u63a5\u5931\u8d25\uff1a${error.message}`);
      return false;
    }
  }

  async function refreshLibrary({ preserve = true } = {}) {
    if (state.libraryMode === "remote") {
      await connectRemoteLibrary();
      return;
    }
    if (!state.directory) {
      log("warn", "library", "刷新失败：尚未连接音乐文件夹");
      return;
    }
    // 与 loadLibrarySources 共用同一个代际计数，进入扫描前先占位，
    // 避免旧扫描在清空 UI 之后才被判定过期
    const token = ++state.libraryLoadToken;
    try {
      let sources;
      if (state.trashMode) {
        try {
          const trash = await state.directory.getDirectoryHandle(TRASH_NAME);
          sources = await scanDirectory(trash, `${TRASH_NAME}/`, true);
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          sources = [];
        }
      } else {
        sources = await scanDirectory(state.directory);
      }
      if (token !== state.libraryLoadToken) return;
      await loadLibrarySources(sources, { trashMode: state.trashMode, token, preserve });
    } catch (error) {
      if (token !== state.libraryLoadToken) return;
      log("error", "library", state.trashMode ? "刷新回收站失败" : "刷新音乐库失败", error.message);
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
        state.libraryMode = "local";
        await initializeLocalData();
        log("info", "permission", "已恢复音乐文件夹授权", handle.name);
        await refreshLibrary({ preserve: false });
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
      state.libraryMode = "local";
      updateLibraryModeUI();
      state.dataDirectory = null;
      state.trashMode = false;
      await initializeLocalData();
      await rememberDirectory(state.directory);
      log("info", "permission", "用户已授权音乐文件夹", state.directory.name);
      await refreshLibrary({ preserve: false });
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

  // 仅切换行高亮，不重建整表（避免丢失滚动位置）
  function markCurrentRow(index) {
    for (const row of dom.trackList.querySelectorAll(".track-row")) {
      row.classList.toggle("is-current", Number(row.dataset.trackIndex) === index);
    }
  }

  // 选择状态变化只同步可见复选框与摘要，不整表重建
  function syncCheckboxState() {
    for (const checkbox of dom.trackList.querySelectorAll(".track-select")) {
      checkbox.checked = state.selected.has(checkbox.dataset.trackId);
    }
    updateSelectionUI();
  }

  function patchFavoriteRow(index, track) {
    const row = dom.trackList.querySelector(`.track-row[data-track-index="${index}"]`);
    const title = row?.querySelector(".track-primary strong");
    if (row && title) title.textContent = `${track.favorite ? "♥ " : ""}${track.title}`;
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
    // 只更新行高亮，不再整表重建（保留滚动位置）
    markCurrentRow(index);
    clearPlaybackSource({ cancelPending: false });
    try {
      const file = track.streamUrl ? null : await track.handle.getFile();
      if (requestId !== state.playRequestId) return;
      if (track.streamUrl) {
        if (!browserPlayable({ name: track.fileName, type: track.mimeType || "" })) {
          log("warn", "playback", "Unsupported remote audio format", track.path);
          return;
        }
        dom.audio.dataset.playRequest = String(requestId);
        dom.audio.dataset.trackPath = track.path;
        dom.audio.src = track.streamUrl;
        dom.audio.load();
        ensureAudioGraph();
        log("debug", "playback", "LAN audio stream ready", `${track.path} · ${track.mimeType} · ${formatSize(track.fileSize)}`);
        if (autoplay) {
          await state.audioContext.resume();
          await dom.audio.play();
        }
        return;
      }
      if (!browserPlayable(file)) {
        log("warn", "playback", "当前浏览器不支持此格式播放", `${track.path} · AIFF 请先转换为 FLAC/WAV/MP3`);
        return;
      }
      const mimeType = playbackMimeType(file);
      // 直接引用 File 本身而非 new Blob([file])：后者会把整个文件复制进内存，
      // 对 Hi-Res FLAC（可达数百 MB）会造成明显的内存峰值与卡顿。
      const playbackSource = file.type ? file : new Blob([file], { type: mimeType });
      state.audioUrl = URL.createObjectURL(playbackSource);
      dom.audio.dataset.playRequest = String(requestId);
      dom.audio.dataset.trackPath = track.path;
      dom.audio.src = state.audioUrl;
      dom.audio.load();
      ensureAudioGraph();
      log("debug", "playback", "播放源已准备", `${track.path} · ${mimeType} · ${formatSize(file.size)}`);
      if (autoplay) {
        await state.audioContext.resume();
        await dom.audio.play();
      }
    } catch (error) {
      // 快速切歌导致旧 play() 被中断（AbortError）、或已被更新的选择取代：都不是错误
      if (error.name === "AbortError" || requestId !== state.playRequestId) return;
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
    $("cover-letter").textContent = coverInitial(track);
    $("cover-shell").classList.toggle("has-cover", Boolean(track.coverUrl));
    const coverImage = $("cover-image");
    coverImage.src = track.coverUrl || "";
    // 满幅封面层只在真的能显示封面时启用。
    // 否则它会以一块空层盖住整个唱片区，把樱花主题的"淡墨环 + 印章"埋掉
    //（实测：无封面时印章几何正常 132×132，但视觉上完全看不见）。
    const coverLayer = $("cover-bg");
    const coverBgImage = $("cover-bg-image");
    if (coverBgImage) {
      if (track.coverUrl) {
        coverBgImage.onerror = () => document.body.classList.remove("has-cover-art");
        coverBgImage.onload = () => document.body.classList.add("has-cover-art");
        coverBgImage.src = track.coverUrl;
        // 已在缓存中时 onload 可能不触发，这里补一次判断
        if (coverBgImage.complete) {
          document.body.classList.toggle("has-cover-art", coverBgImage.naturalWidth > 0);
        }
      } else {
        coverBgImage.removeAttribute("src");
        document.body.classList.remove("has-cover-art");
      }
    }
    if (coverLayer) coverLayer.classList.toggle("is-empty", !track.coverUrl);
    $("transport-title").textContent = track.title;
    $("transport-artist").textContent = track.artist || track.composer || track.fileName;
    $("mini-cover").innerHTML = track.coverUrl
      ? `<img src="${track.coverUrl}" alt="" />`
      : `<span>${escapeHTML(coverInitial(track))}</span>`;
    $("favorite-current").textContent = track.favorite ? "♥ 已收藏" : "♡ 收藏";
    // 封面氛围光：把当前封面作为正在聆听页的模糊背景
    $("player-view").style.setProperty("--cover-bg", track.coverUrl ? `url("${track.coverUrl}")` : "none");
    $("edit-current-tags").disabled = track.format !== "FLAC";
    $("edit-current-tags").textContent = track.format === "FLAC" ? "编辑 FLAC 元数据" : "仅支持 FLAC 元数据";
    $("audio-format").textContent = track.format || "—";
    $("audio-sample-rate").textContent = formatRate(track.sampleRate);
    $("audio-bit-depth").textContent = track.bits ? `${track.bits} bit` : "—";
    if (track.remote) {
      $("edit-current-tags").disabled = true;
      $("edit-current-tags").textContent = "\u5c40\u57df\u7f51\u6a21\u5f0f\u53ea\u8bfb";
    }
    $("audio-bitrate").textContent = track.bitrate ? `${Math.round(track.bitrate)} kbps` : "—";
    $("audio-channels").textContent = track.channels === 1 ? "单声道" : track.channels === 2 ? "立体声" : track.channels ? `${track.channels} 声道` : "—";
    $("audio-duration").textContent = formatDuration(track.duration);
    dom.signalBadge.textContent = [track.format, track.bits ? `${track.bits} BIT` : "", track.sampleRate ? `${track.sampleRate / 1000} kHz` : ""].filter(Boolean).join(" · ");
  }

  // 取首个“字母/数字”字符作为封面占位字母；标题以空白或符号开头时仍能得到可用字形
  function coverInitial(track) {
    const source = String((track && (track.composer || track.title)) || "Clair");
    const match = source.match(/[\p{L}\p{N}]/u);
    return match ? match[0].toUpperCase() : "C";
  }

  // 音乐库/播放源被整体重置（换文件夹、清空、文件被移走）时复位正在聆听面板，
  // 避免封面/文案指向已被 revoke 的 blob URL 或已不存在的曲目
  function resetPlayerDisplay() {
    $("now-title").textContent = "让音乐成为可见的风景";
    $("now-work").textContent = "请选择一首曲目";
    $("now-credit").textContent = "连接本地音乐文件夹后开始聆听";
    for (const id of ["meta-artist", "meta-conductor", "meta-orchestra", "meta-composer", "meta-year", "meta-album"]) {
      $(id).textContent = "—";
    }
    $("spine-album").textContent = "本地音乐库";
    $("spine-year").textContent = "—";
    $("cover-shell").classList.remove("has-cover");
    $("cover-image").removeAttribute("src");
    $("cover-letter").textContent = "C";
    // 复位时同样要收起满幅封面层，否则樱花主题会留下一块空层盖住唱片区
    document.body.classList.remove("has-cover-art");
    const coverLayerReset = $("cover-bg");
    if (coverLayerReset) coverLayerReset.classList.add("is-empty");
    const coverBgReset = $("cover-bg-image");
    if (coverBgReset) coverBgReset.removeAttribute("src");
    $("transport-title").textContent = "尚未播放";
    $("transport-artist").textContent = "请选择曲目";
    $("mini-cover").innerHTML = "<span>C</span>";
    $("favorite-current").textContent = "♡ 收藏";
    $("player-view").style.setProperty("--cover-bg", "none");
    $("edit-current-tags").disabled = true;
    $("edit-current-tags").textContent = "仅支持 FLAC 元数据";
    for (const id of ["audio-format", "audio-sample-rate", "audio-bit-depth", "audio-bitrate", "audio-channels", "audio-duration"]) {
      $(id).textContent = "—";
    }
    dom.signalBadge.textContent = "等待载入音频";
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
    state.audioContext.resume().catch(() => {});
    if (dom.audio.paused) {
      dom.audio.play().catch((error) => {
        if (error.name === "AbortError") return; // 播放被快速切歌/暂停打断，不是错误
        log("error", "playback", "播放失败", error.message);
      });
    } else {
      dom.audio.pause();
    }
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
    patchFavoriteRow(state.currentIndex, track);
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
    if (track.remote) {
      log("warn", "metadata", "Remote library is read-only", track.path);
      return;
    }
    const fields = TAG_FIELDS;
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
    const fields = TAG_FIELDS;
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
      secureContext: state.libraryMode === "remote" || window.isSecureContext,
      directoryPicker: state.libraryMode === "remote" || typeof window.showDirectoryPicker === "function",
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
      libraryMode: state.libraryMode,
      remoteLibrary: state.remoteLibraryName,
    };
    const requiredFailures = [
      !checks.secureContext && "非安全上下文",
      false,
      false,
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
    let writer;
    try {
      writer = await target.createWritable();
      await writer.write(await track.handle.getFile());
      await writer.close();
    } catch (error) {
      // 复制中途失败时清理残留的半成品文件，否则后续操作会被“同名文件”永久卡死
      try {
        if (writer && typeof writer.abort === "function") await writer.abort();
      } catch {
        // 忽略中止失败，继续清理
      }
      try {
        await targetDirectory.removeEntry(track.fileName);
      } catch {
        // 目标可能根本没建成，忽略
      }
      throw error;
    }
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
    if (!state.directory || state.libraryMode !== "local") return;
    // 与刷新共用同一个代际计数，避免与在途扫描互相覆盖
    const token = ++state.libraryLoadToken;
    const opening = !state.trashMode;
    try {
      let sources;
      if (opening) {
        try {
          const trash = await state.directory.getDirectoryHandle(TRASH_NAME);
          sources = await scanDirectory(trash, `${TRASH_NAME}/`, true);
        } catch (error) {
          if (error.name !== "NotFoundError") throw error;
          sources = [];
        }
      } else {
        sources = await scanDirectory(state.directory);
      }
      if (token !== state.libraryLoadToken) return;
      await loadLibrarySources(sources, { trashMode: opening, token, preserve: false });
    } catch (error) {
      log("error", "files", "打开回收站失败", error.message);
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
    let writer;
    let copied = false;
    try {
      const target = await track.parentHandle.getFileHandle(name, { create: true });
      writer = await target.createWritable();
      await writer.write(await track.handle.getFile());
      await writer.close();
      copied = true;
      await removeOriginal(track);
      log("info", "files", "重命名成功", `${track.fileName} → ${name}`);
      await refreshLibrary();
    } catch (error) {
      // 复制中途失败时删除残留的新文件名，避免下次重命名被“同名文件已存在”卡死；
      // 复制已成功只是删除旧文件失败时保留新文件，避免二次损坏
      if (!copied) {
        try {
          if (writer && typeof writer.abort === "function") await writer.abort();
        } catch {
          // 忽略
        }
        try {
          await track.parentHandle.removeEntry(name);
        } catch {
          // 新文件可能并未创建成功，忽略
        }
      }
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
    // 标题/艺术家可能含换行，会拆坏 M3U 行结构
    const singleLine = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();
    for (const { track } of orderedItems) {
      lines.push(`#EXTINF:${Math.round(track.duration) || -1},${singleLine(track.artist || track.composer)} - ${singleLine(track.title)}`);
      lines.push(track.streamUrl ? new URL(track.streamUrl, window.location.href).href : track.path);
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
    // 延后到下载真正开始后再 revoke，避免个别浏览器在下载开始前就撤销 URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resizeCanvas() {
    const rect = dom.canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    dom.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    dom.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  }

  function traceSpectrumCurve(context, values, left, plotWidth, baseline, amplitude, stride = 1) {
    const points = [];
    for (let index = 0; index < values.length; index += stride) {
      points.push([
        left + index / Math.max(1, values.length - 1) * plotWidth,
        baseline - values[index] * amplitude,
      ]);
    }
    if (points.length < 2) return points;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length - 1; index++) {
      const current = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
    }
    context.lineTo(points.at(-1)[0], points.at(-1)[1]);
    return points;
  }

  function drawVisualizerGrid(context, mode, grid, left, right, top, baseline) {
    context.save();
    context.strokeStyle = grid;
    context.lineWidth = 1;
    const rows = mode === "hydrophone" ? 6 : mode === "sakura" ? 3 : 4;
    for (let row = 1; row <= rows; row++) {
      const y = top + (baseline - top) * row / (rows + 1);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
    }
    if (mode === "stellar") {
      for (let column = 1; column < 8; column++) {
        const x = left + (right - left) * column / 8;
        context.beginPath();
        context.moveTo(x, top);
        context.lineTo(x, baseline);
        context.stroke();
      }
    } else if (mode === "hydrophone") {
      context.globalAlpha = 0.7;
      for (let tick = 0; tick <= 24; tick++) {
        const x = left + (right - left) * tick / 24;
        context.beginPath();
        context.moveTo(x, baseline - (tick % 4 === 0 ? 5 : 2));
        context.lineTo(x, baseline + 2);
        context.stroke();
      }
    }
    context.restore();
  }

  function drawBarSpectrum(context, geometry, colors) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, fill } = colors;
    const bars = state.visualLevels.length;
    const gradient = context.createLinearGradient(0, top, 0, baseline);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(1, fill);
    const envelope = [];
    for (let index = 0; index < bars; index++) {
      const slot = plotWidth / bars;
      const barWidth = Math.max(2, slot - 2);
      const x = left + index * slot + (slot - barWidth) / 2;
      const barHeight = Math.max(2, state.visualLevels[index] * (baseline - top) * 0.94);
      const y = baseline - barHeight;
      context.globalAlpha = 0.78;
      context.fillStyle = gradient;
      context.fillRect(x, y, barWidth, barHeight);
      context.globalAlpha = 0.95;
      context.fillStyle = accent;
      context.fillRect(x, baseline - state.visualPeaks[index] * (baseline - top) * 0.94, barWidth, 1.5);
      envelope.push([x + barWidth / 2, y]);
    }
    context.globalAlpha = 1;
    context.strokeStyle = accent;
    context.lineWidth = 1.2;
    context.beginPath();
    envelope.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.stroke();
  }

  function drawHydrophoneSpectrum(context, geometry, colors, time) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, secondary } = colors;
    if (!state.visualHistory.length || time - state.visualHistoryTime >= 90) {
      state.visualHistory.unshift(Float32Array.from(state.visualLevels));
      if (state.visualHistory.length > 12) state.visualHistory.pop();
      state.visualHistoryTime = time;
    }
    const count = state.visualHistory.length;
    for (let index = count - 1; index >= 0; index--) {
      const rowBaseline = top + (baseline - top) * (index + 1) / (count + 1);
      const amplitude = Math.max(9, (baseline - top) / Math.max(5, count) * 1.65);
      context.strokeStyle = index === 0 ? secondary : accent;
      context.globalAlpha = index === 0 ? 0.95 : Math.max(0.12, 0.62 - index * 0.035);
      context.lineWidth = index === 0 ? 1.6 : 1;
      traceSpectrumCurve(context, state.visualHistory[index], left, plotWidth, rowBaseline, amplitude, 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function drawSakuraSpectrum(context, geometry, colors) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, fill, secondary } = colors;
    const amplitude = (baseline - top) * 0.72;
    const primaryPoints = traceSpectrumCurve(context, state.visualLevels, left, plotWidth, baseline, amplitude);
    if (primaryPoints.length) {
      context.lineTo(primaryPoints.at(-1)[0], baseline);
      context.lineTo(primaryPoints[0][0], baseline);
      context.closePath();
      context.fillStyle = fill;
      context.globalAlpha = 0.62;
      context.fill();
    }
    for (let layer = 2; layer >= 0; layer--) {
      context.strokeStyle = layer === 0 ? accent : secondary;
      context.globalAlpha = layer === 0 ? 0.94 : 0.18 + layer * 0.1;
      context.lineWidth = layer === 0 ? 1.7 : 1.1;
      traceSpectrumCurve(
        context,
        state.visualLevels,
        left,
        plotWidth,
        baseline - layer * 5,
        amplitude * (1 - layer * 0.09),
        layer + 1
      );
      context.stroke();
    }
    for (let index = 6; index < state.visualLevels.length; index += 10) {
      const level = state.visualLevels[index];
      if (level < 0.14) continue;
      const x = left + index / (state.visualLevels.length - 1) * plotWidth;
      const y = baseline - level * amplitude;
      const petal = 1.5 + level * 2.7;
      context.save();
      context.translate(x, y);
      context.fillStyle = index % 20 === 6 ? accent : secondary;
      context.globalAlpha = 0.58 + level * 0.32;
      for (let leaf = 0; leaf < 5; leaf++) {
        context.save();
        context.rotate(leaf * Math.PI * 0.4 + index * 0.07);
        context.beginPath();
        context.ellipse(0, -petal * 1.15, petal * 0.62, petal * 1.18, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
      context.fillStyle = accent;
      context.globalAlpha = 0.92;
      context.beginPath();
      context.arc(0, 0, Math.max(0.8, petal * 0.22), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function drawContourSpectrum(context, geometry, colors) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, secondary } = colors;
    const amplitude = (baseline - top) * 0.5;
    for (let layer = 5; layer >= 0; layer--) {
      context.strokeStyle = layer === 0 ? accent : secondary;
      context.globalAlpha = layer === 0 ? 0.96 : Math.max(0.14, 0.5 - layer * 0.055);
      context.lineWidth = layer === 0 ? 1.7 : 1;
      traceSpectrumCurve(
        context,
        state.visualLevels,
        left,
        plotWidth,
        baseline - layer * 8,
        amplitude * (0.7 + layer * 0.045),
        2
      );
      context.stroke();
    }
    context.fillStyle = secondary;
    context.globalAlpha = 0.9;
    for (let index = 4; index < state.visualLevels.length; index += 8) {
      if (state.visualLevels[index] < 0.55) continue;
      const x = left + index / (state.visualLevels.length - 1) * plotWidth;
      const y = baseline - state.visualLevels[index] * amplitude;
      context.beginPath();
      context.arc(x, y, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawStellarSpectrum(context, geometry, colors) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, secondary } = colors;
    const amplitude = (baseline - top) * 0.78;
    const points = [];
    for (let index = 0; index < state.visualLevels.length; index += 4) {
      points.push([
        left + index / (state.visualLevels.length - 1) * plotWidth,
        baseline - state.visualLevels[index] * amplitude,
        state.visualLevels[index],
      ]);
    }
    context.strokeStyle = accent;
    context.globalAlpha = 0.45;
    context.lineWidth = 0.8;
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.stroke();
    context.shadowColor = accent;
    context.shadowBlur = 7;
    points.forEach(([x, y, level], index) => {
      context.fillStyle = level > 0.58 || index % 6 === 0 ? secondary : accent;
      context.globalAlpha = 0.58 + level * 0.42;
      context.beginPath();
      context.arc(x, y, 1.25 + level * 2.7, 0, Math.PI * 2);
      context.fill();
    });
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }

  // 极光幕：把频谱画成三层错位的半透明光带，并沿频谱宽度做色相过渡。
  // 与其它模式的区别在于它用横向渐变而非纵向渐变着色。
  function drawAuraSpectrum(context, geometry, colors, time) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, secondary, fill, grid } = colors;
    const bars = state.visualLevels.length;
    const span = baseline - top;
    const layers = [
      { offset: 0, alpha: 0.5, scale: 1, stops: [accent, secondary] },
      { offset: 0.13, alpha: 0.32, scale: 0.82, stops: [secondary, grid] },
      { offset: 0.27, alpha: 0.2, scale: 0.64, stops: [fill, accent] },
    ];
    for (const layer of layers) {
      const gradient = context.createLinearGradient(left, 0, left + plotWidth, 0);
      gradient.addColorStop(0, layer.stops[0]);
      gradient.addColorStop(0.5, layer.stops[1]);
      gradient.addColorStop(1, layer.stops[0]);
      context.strokeStyle = gradient;
      context.globalAlpha = layer.alpha;
      context.lineWidth = 1.8;
      context.beginPath();
      for (let index = 0; index < bars; index++) {
        const x = left + (index / (bars - 1)) * plotWidth;
        const wave = Math.sin(index * 0.19 + time / 620 + layer.offset * 9) * 0.06;
        const y = baseline - Math.min(1, state.visualLevels[index] * layer.scale + wave) * span * 0.96;
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  // 镀铬：横向拉丝镜面 + 一道扫过的高光条。与柱状画法的区别在于它强调
  // "反射"——频谱被画成一条连续的金属带，而不是一根根柱子。
  function drawMetalSpectrum(context, geometry, colors, time) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, base, text, fill } = colors;
    const bars = state.visualLevels.length;
    const span = baseline - top;
    let peak = 0;
    for (let index = 0; index < bars; index++) peak = Math.max(peak, state.visualLevels[index]);
    const bandHeight = Math.max(8, span * 0.5);
    const bandTop = baseline - bandHeight;

    // 金属带：纵向渐变模拟反射
    const metal = context.createLinearGradient(0, bandTop, 0, baseline);
    metal.addColorStop(0, fill);
    metal.addColorStop(0.42, accent);
    metal.addColorStop(0.52, text);
    metal.addColorStop(0.62, accent);
    metal.addColorStop(1, fill);
    context.globalAlpha = 0.9;
    context.fillStyle = metal;
    context.beginPath();
    context.moveTo(left, baseline);
    for (let index = 0; index < bars; index++) {
      const x = left + (index / (bars - 1)) * plotWidth;
      context.lineTo(x, baseline - Math.max(0.06, state.visualLevels[index]) * bandHeight);
    }
    context.lineTo(left + plotWidth, baseline);
    context.closePath();
    context.fill();

    // 扫过的高光条
    const sweep = ((time / 5200) % 1) * 1.5 - 0.25;
    const sweepX = left + sweep * plotWidth;
    const sheen = context.createLinearGradient(sweepX - 90, 0, sweepX + 90, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.34)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    context.globalAlpha = 0.7;
    context.fillStyle = sheen;
    context.fillRect(left, bandTop - 6, plotWidth, bandHeight + 6);

    // 顶边一条亮线，强化"金属边缘"
    context.globalAlpha = 0.95;
    context.strokeStyle = text;
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 0; index < bars; index++) {
      const x = left + (index / (bars - 1)) * plotWidth;
      const y = baseline - Math.max(0.06, state.visualLevels[index]) * bandHeight;
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    }
    context.stroke();
    context.globalAlpha = 1;
    void base;
  }

  // 余烬：湍流柱 + 高温渐变 + 微闪烁。柱顶抖动、颜色从暗红到亮黄，
  // 与镀铬的"连续带"和极光的"连续线"都不同。
  function drawHeatSpectrum(context, geometry, colors, time) {
    const { left, plotWidth, top, baseline } = geometry;
    const { accent, base, secondary, fill } = colors;
    const bars = state.visualLevels.length;
    const span = baseline - top;
    const slot = plotWidth / bars;
    for (let index = 0; index < bars; index++) {
      const level = state.visualLevels[index];
      // 湍流：让柱高有细碎抖动
      const turb = Math.sin(index * 1.7 + time / 130) * 0.05 + Math.sin(index * 0.41 - time / 90) * 0.03;
      const height = Math.max(2, Math.min(1, level + turb * (1 - level)) * span * 0.94);
      const x = left + index * slot;
      const width = Math.max(2, slot - 1.5);
      const gradient = context.createLinearGradient(0, baseline - height, 0, baseline);
      gradient.addColorStop(0, secondary);
      gradient.addColorStop(0.35, accent);
      gradient.addColorStop(1, base);
      context.globalAlpha = 0.86;
      context.fillStyle = gradient;
      context.fillRect(x, baseline - height, width, height);
      // 柱顶高光：像烧红的尖端
      context.globalAlpha = 0.9;
      context.fillStyle = accent;
      context.fillRect(x, baseline - height, width, 1.5);
    }
    // 底部余温辉光
    const glow = context.createLinearGradient(0, baseline - span * 0.28, 0, baseline);
    glow.addColorStop(0, "rgba(255,120,40,0)");
    glow.addColorStop(1, fill);
    context.globalAlpha = 0.5;
    context.fillStyle = glow;
    context.fillRect(left, baseline - span * 0.28, plotWidth, span * 0.28);
    context.globalAlpha = 1;
  }

  function drawWaveform(context, geometry, colors, active, time, mode) {
    const { left, plotWidth, baseline, height } = geometry;
    const { secondary } = colors;
    context.strokeStyle = secondary;
    context.globalAlpha = mode === "stellar" ? 0.52 : 0.7;
    context.lineWidth = mode === "sakura" ? 1.25 : 1;
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
      // 颜色/频谱模式只随主题变化：切主题时刷新缓存，渲染循环不再每帧 getComputedStyle
      if (!visualThemeColors) refreshVisualThemeCache();
      const colors = visualThemeColors;
      const mode = visualThemeMode;
      const active = Boolean(state.analyser && !dom.audio.paused && state.frequencyData);
      const motionTime = reducedMotion.matches && !active ? 0 : time;
      const bars = state.visualLevels.length;
      const geometry = {
        width,
        height,
        left: 6,
        right: width - 6,
        top: 8,
        baseline: height * 0.79,
      };
      geometry.plotWidth = geometry.right - geometry.left;
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
        const seconds = motionTime / 1000;
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

      const speed = active ? 0.38 : reducedMotion.matches ? 1 : 0.12;
      for (let index = 0; index < bars; index++) {
        state.visualLevels[index] += (levels[index] - state.visualLevels[index]) * speed;
        state.visualPeaks[index] = Math.max(state.visualLevels[index], state.visualPeaks[index] - 0.008);
      }

      drawVisualizerGrid(context, mode, colors.grid, geometry.left, geometry.right, geometry.top, geometry.baseline);
      if (mode === "hydrophone") drawHydrophoneSpectrum(context, geometry, colors, motionTime);
      else if (mode === "sakura") drawSakuraSpectrum(context, geometry, colors);
      else if (mode === "contour") drawContourSpectrum(context, geometry, colors);
      else if (mode === "stellar") drawStellarSpectrum(context, geometry, colors);
      else if (mode === "aura") drawAuraSpectrum(context, geometry, colors, motionTime);
      else if (mode === "metal") drawMetalSpectrum(context, geometry, colors, motionTime);
      else if (mode === "heat") drawHeatSpectrum(context, geometry, colors, motionTime);
      else drawBarSpectrum(context, geometry, colors);
      drawWaveform(context, geometry, colors, active, motionTime, mode);

      const idleLabels = {
        hydrophone: "PASSIVE LISTENING",
        sakura: "BLOSSOM STILL",
        contour: "QUIET TERRAIN",
        stellar: "STAR CHART",
        aura: "AURORA DRIFT",
        metal: "POLISHED SHEEN",
        heat: "BURNING LOW",
        bars: "IDLE MOTION",
      };
      // 仅在内容/颜色真正变化时写 DOM，减少每帧 layout/style 开销
      const labelText = active
        ? `${(20 * Math.log10(Math.max(average, 0.001))).toFixed(1)} dBFS`
        : idleLabels[mode];
      const labelColor = active ? colors.accent : colors.muted;
      if (labelText !== lastAnalyzerLabel) {
        lastAnalyzerLabel = labelText;
        $("analyzer-level").textContent = labelText;
      }
      if (labelColor !== lastAnalyzerLabelColor) {
        lastAnalyzerLabelColor = labelColor;
        $("analyzer-level").style.color = labelColor;
      }
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
    $("connect-lan-library").addEventListener("click", async () => { if (await connectRemoteLibrary()) setView("library"); });
    $("theme-select").addEventListener("change", (event) => applyTheme(event.target.value));
    dom.modeButtons.forEach((button) => {
      button.addEventListener("click", () => applyMode(button.dataset.modeChoice));
    });
    // 系统主题变化只在"跟随系统"时生效；手动选过就保持用户选择。
    if (typeof systemPrefersDark.addEventListener === "function") {
      systemPrefersDark.addEventListener("change", () => {
        if (state.themeMode === "auto") applyMode("auto", { persist: false, announce: false });
      });
    }
    [["accent", dom.accentColor, dom.accentHex, dom.accentReset], ["base", dom.baseColor, dom.baseHex, dom.baseReset]]
      .forEach(([kind, colorInput, hexInput, resetButton]) => {
        if (colorInput) colorInput.addEventListener("input", (event) => setCustomColor(kind, event.target.value));
        if (hexInput) hexInput.addEventListener("change", (event) => setCustomColor(kind, event.target.value));
        if (resetButton) resetButton.addEventListener("click", () => setCustomColor(kind, null));
      });
    document.querySelectorAll("[data-accent-preset]").forEach((button) => {
      button.addEventListener("click", () => setCustomColor("accent", button.dataset.accentPreset));
    });
    document.querySelectorAll("[data-base-preset]").forEach((button) => {
      button.addEventListener("click", () => setCustomColor("base", button.dataset.basePreset));
    });
    $("refresh-library").addEventListener("click", () => refreshLibrary());
    dom.search.addEventListener("input", () => {
      // 输入去抖后再重建列表，避免每键整表 innerHTML
      clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(renderLibrary, 150);
    });
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
      syncCheckboxState();
    });
    $("clear-selection").addEventListener("click", () => {
      state.selected.clear();
      syncCheckboxState();
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
      // 拖拽中暂停时实时跳转；播放中只在松开（change）时提交，避免对高码率文件反复 seek 抖动
      const duration = dom.audio.duration;
      dom.seek.style.setProperty("--fill", `${Number(dom.seek.value) / 10}%`);
      if (dom.audio.paused && duration) {
        dom.audio.currentTime = duration * Number(dom.seek.value) / 1000;
      }
    });
    dom.seek.addEventListener("change", () => {
      if (dom.audio.duration) dom.audio.currentTime = dom.audio.duration * Number(dom.seek.value) / 1000;
    });
    dom.volume.addEventListener("input", () => {
      dom.audio.volume = Number(dom.volume.value);
      dom.volume.style.setProperty("--fill", `${Number(dom.volume.value) * 100}%`);
    });
    dom.audio.addEventListener("play", () => {
      dom.play.textContent = "Ⅱ";
      document.body.classList.add("is-playing");
      log("info", "playback", "开始播放", currentTrack()?.title || "");
    });
    dom.audio.addEventListener("pause", () => {
      dom.play.textContent = "▶";
      document.body.classList.remove("is-playing");
    });
    dom.audio.addEventListener("ended", () => {
      // 若当前曲目已被清空/移出列表（例如刷新后文件被移走），不要在空列表上乱跳
      if (state.currentIndex >= 0) navigate(1);
    });
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
      dom.seek.style.setProperty("--fill", `${dom.audio.currentTime / dom.audio.duration * 100}%`);
    });
    dom.audio.addEventListener("error", () => {
      if (!dom.audio.hasAttribute("src")) return;
      // 事件来自已被取代的播放源（快速切歌/清理后）时忽略，避免把错误归到新曲目
      if (dom.audio.dataset.playRequest && dom.audio.dataset.playRequest !== String(state.playRequestId)) return;
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
        path: dom.audio.dataset.trackPath || currentTrack()?.path || "",
        mimeType: currentTrack()?.mimeType || "",
        networkState: dom.audio.networkState,
        readyState: dom.audio.readyState,
      }));
    });
    dom.logLevel.addEventListener("change", renderLogs);
    $("run-diagnostics").addEventListener("click", runDiagnostics);
    $("export-logs").addEventListener("click", exportLogs);
    $("clear-logs").addEventListener("click", async () => {
      // 同时丢弃尚未落盘的文件日志，避免清空后被迟到的 flush 重新写入
      pendingFileLogs.length = 0;
      if (logFileTimer) {
        clearTimeout(logFileTimer);
        logFileTimer = 0;
      }
      state.logs = [];
      logsViewDirty = false;
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
      // 尽力把内存日志同步进 localStorage（磁盘 flush 为异步，交由页面关闭流程）
      saveJSON("clair-logs", state.logs);
    });
    new ResizeObserver(resizeCanvas).observe(dom.canvas);
    dom.volume.style.setProperty("--fill", `${Number(dom.volume.value) * 100}%`);
    dom.seek.style.setProperty("--fill", "0%");
  }

  async function boot() {
    removeLegacyDisplayOverrides();
    applyTheme(state.theme);
    applyMode(state.themeMode, { announce: false });
    // 深链里的配色与主题/模式一样写回本地：分享链接打开后刷新仍保持一致。
    localStorage.setItem(ACCENT_STORAGE_KEY, state.accent || "");
    localStorage.setItem(BASE_STORAGE_KEY, state.base || "");
    syncThemeColor();
    bindEvents();
    resizeCanvas();
    requestAnimationFrame(drawVisualizer);
    renderLibrary();
    renderLogs();
    updateSourceState("尚未连接", false);
    log("info", "system", `Clair ${APP_VERSION} 已启动`, "可视化引擎正在运行");
    updateLibraryModeUI();
    if (await connectRemoteLibrary({ silent: true })) return;
    await restoreRememberedDirectory();
  }

  boot().catch((error) => log("error", "system", "应用启动失败", error.message));
})();
