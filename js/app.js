/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const Config = window.Game.Config;
  const State = window.Game.State;
  const Utils = window.Game.Utils;
  const Terrain = window.Game.Terrain;
  const Renderer = window.Game.Renderer;
  const Minimap = window.Game.Minimap;
  const UI = window.Game.UI;
  const Input = window.Game.Input;
  const I18n = window.Game.I18n;

  function createDefaultPlayer(rows, cols) {
    return {
      row: Math.floor(rows / 2),
      col: Math.floor(cols / 2),
      moving: false,
      startRow: Math.floor(rows / 2),
      startCol: Math.floor(cols / 2),
      targetRow: Math.floor(rows / 2),
      targetCol: Math.floor(cols / 2),
      moveStartTime: 0,
      moveDuration: 180,
      progress: 1,
      direction: 's',
      pathQueue: []
    };
  }

  const IMPORT_TILE_CODES = {
    gr: "grass",
    di: "dirt",
    fo: "forest",
    la: "lake",
    ri: "river",
    ro: "road",
    mo: "mountain",
    se: "settlement"
  };

  function decodeImportedTileType(tile) {
    const compactType = tile && typeof tile.t === "string" ? tile.t.toLowerCase() : "";
    if (compactType && IMPORT_TILE_CODES[compactType]) return IMPORT_TILE_CODES[compactType];
    return tile && typeof tile.type === "string" ? tile.type : "grass";
  }

  function buildTagsForImportedType(type, tile) {
    const tags = new Set(Array.isArray(tile && tile.tags) ? tile.tags : []);
    if (type === "road") tags.add("road");
    if (type === "settlement") tags.add("settlement");
    if (type === "forest") {
      tags.add("forest");
      tags.add("blocked");
    }
    if (type === "mountain") {
      tags.add("mountain");
      tags.add("mountainCore");
      tags.add("blocked");
    }
    if (type === "lake") {
      tags.add("lake");
      tags.add("blocked");
    }
    if (type === "river") {
      tags.add("stream");
      tags.add("blocked");
    }
    return tags;
  }

  function normalizeImportedTile(tile) {
    const type = decodeImportedTileType(tile);
    const numericElevation = Number(tile && (tile.elevation ?? tile.e));
    return {
      type,
      elevation: Number.isFinite(numericElevation) ? numericElevation : 0,
      tags: buildTagsForImportedType(type, tile)
    };
  }

  function parseImportedTileCoordinate(tile) {
    if (tile && typeof tile.cr === "string") {
      const match = tile.cr.match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/);
      if (match) {
        return { x: Number(match[1]), y: Number(match[2]) };
      }
    }
    return {
      x: Number(tile && tile.x),
      y: Number(tile && tile.y)
    };
  }

  function buildTerrainGridFromTiles(payload, cols, rows) {
    const tiles = Array.isArray(payload && payload.tiles) ? payload.tiles : [];
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => normalizeImportedTile(null)));

    for (const tile of tiles) {
      const { x, y } = parseImportedTileCoordinate(tile);
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
      grid[y][x] = normalizeImportedTile(tile);
    }

    return grid;
  }

  function loadImageElementFromUrl(src, useAnonymousCors) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      if (useAnonymousCors) image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      image.src = src;
    });
  }

  function shouldTryBlobImageLoad(src) {
    const safeSrc = String(src || "").trim();
    if (!safeSrc) return false;
    if (/^data:/i.test(safeSrc)) return false;
    if (/^blob:/i.test(safeSrc)) return false;
    return typeof fetch === "function";
  }

  async function loadImageElement(src, options = {}) {
    const safeSrc = String(src || "").trim();
    if (!safeSrc) throw new Error("Image source is empty.");

    const preferBlob = options && options.preferBlob !== false;
    let fetchError = null;

    if (preferBlob && shouldTryBlobImageLoad(safeSrc)) {
      try {
        const response = await fetch(buildNoCacheUrl(safeSrc), { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        try {
          const image = await loadImageElementFromUrl(objectUrl, false);
          image.__simsoftLoadMode = "blob";
          image.__simsoftOriginalSrc = safeSrc;
          return image;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        fetchError = error;
      }
    }

    const useAnonymousCors = !isFileProtocol() && /^https?:\/\//i.test(safeSrc);
    const image = await loadImageElementFromUrl(safeSrc, useAnonymousCors);
    image.__simsoftLoadMode = fetchError ? "direct-fallback" : "direct";
    if (fetchError) {
      image.__simsoftFallbackReason = fetchError && fetchError.message ? fetchError.message : String(fetchError);
    }
    image.__simsoftOriginalSrc = safeSrc;
    return image;
  }


  function getExpectedBackgroundResolution(cols, rows) {
    let maxSize = 4096;
    try {
      const gl = State && State.dom ? State.dom.gl : null;
      const reported = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0) : 0;
      if (Number.isFinite(reported) && reported > 0) {
        maxSize = Math.max(1024, Math.min(Math.floor(reported), 8192));
      }
    } catch (error) {
      maxSize = 4096;
    }
    const safeCols = Math.max(1, Number(cols) || 1);
    const safeRows = Math.max(1, Number(rows) || 1);
    const pxPerCell = Math.max(1, Math.floor(Math.min(maxSize / safeCols, maxSize / safeRows, 64)));
    return {
      width: Math.max(1, Math.min(maxSize, safeCols * pxPerCell)),
      height: Math.max(1, Math.min(maxSize, safeRows * pxPerCell))
    };
  }

  function clampInteger(value, minValue, maxValue, fallbackValue) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallbackValue;
    const rounded = Math.round(numeric);
    return Math.min(maxValue, Math.max(minValue, rounded));
  }

  function estimateSquareSourceResolutionFromDiamond(imageWidth, imageHeight, cols, rows) {
    const safeImageWidth = Math.max(1, Number(imageWidth) || 1);
    const safeImageHeight = Math.max(1, Number(imageHeight) || 1);
    const safeCols = Math.max(1, Number(cols) || 1);
    const safeRows = Math.max(1, Number(rows) || 1);

    // Export path pads the rotated diamond image by 2px on each side.
    const exportPadding = 2;
    const paddedSide = Math.max(1, Math.min(safeImageWidth, safeImageHeight));
    const diagonalExtent = Math.max(1, paddedSide - exportPadding * 2);
    const logicalPerimeter = diagonalExtent * Math.SQRT2;
    const totalUnits = safeCols + safeRows;

    const estimatedWidth = Math.max(1, Math.round((logicalPerimeter * safeCols) / totalUnits));
    const estimatedHeight = Math.max(1, Math.round((logicalPerimeter * safeRows) / totalUnits));

    return {
      width: estimatedWidth,
      height: estimatedHeight
    };
  }

  function convertDiamondImageToSquareCanvas(image, cols, rows) {
    if (!image) return null;
    const sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const estimatedResolution = estimateSquareSourceResolutionFromDiamond(sourceWidth, sourceHeight, cols, rows);

    let resolution = {
      width: estimatedResolution.width,
      height: estimatedResolution.height
    };

    const maxResolution = getExpectedBackgroundResolution(cols, rows);
    if (resolution.width > maxResolution.width || resolution.height > maxResolution.height) {
      const scale = Math.min(maxResolution.width / resolution.width, maxResolution.height / resolution.height);
      resolution = {
        width: Math.max(1, Math.round(resolution.width * scale)),
        height: Math.max(1, Math.round(resolution.height * scale))
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
    return canvas;
  }

  function convertImageToRotatedBackgroundCanvas(image, cols, rows) {
    if (!image) return null;
    const resolution = getExpectedBackgroundResolution(cols, rows);
    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    // After rotation, destination width/height axes are swapped.
    ctx.drawImage(image, 0, 0, canvas.height, canvas.width);
    return canvas;
  }

  function imageLooksDiamondShaped(image) {
    if (!image) return false;
    try {
      const width = Math.max(1, image.naturalWidth || image.width || 0);
      const height = Math.max(1, image.naturalHeight || image.height || 0);
      const probeCanvas = document.createElement("canvas");
      probeCanvas.width = width;
      probeCanvas.height = height;
      const probeCtx = probeCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
      if (!probeCtx) return false;
      probeCtx.clearRect(0, 0, width, height);
      probeCtx.drawImage(image, 0, 0, width, height);

      const sampleAlpha = (x, y) => {
        const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
        return probeCtx.getImageData(sx, sy, 1, 1).data[3];
      };

      const margin = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
      const centerAlpha = sampleAlpha(width / 2, height / 2);
      const topLeftAlpha = sampleAlpha(margin, margin);
      const topRightAlpha = sampleAlpha(width - 1 - margin, margin);
      const bottomLeftAlpha = sampleAlpha(margin, height - 1 - margin);
      const bottomRightAlpha = sampleAlpha(width - 1 - margin, height - 1 - margin);
      const cornerThreshold = 16;
      const centerThreshold = 32;

      return centerAlpha > centerThreshold
        && topLeftAlpha <= cornerThreshold
        && topRightAlpha <= cornerThreshold
        && bottomLeftAlpha <= cornerThreshold
        && bottomRightAlpha <= cornerThreshold;
    } catch (error) {
      return false;
    }
  }
  const MAP_DATA_SCRIPT_GLOBAL = "__SIMSOFT_IMPORTED_MAP_DATA__";


  const MAP_CACHE_DB_NAME = "simsoftMapCache";
  const MAP_CACHE_STORE_NAME = "maps";

  function supportsIndexedDb() {
    return typeof indexedDB !== "undefined";
  }

  function openMapCacheDb() {
    return new Promise((resolve, reject) => {
      if (!supportsIndexedDb()) {
        reject(new Error("IndexedDB is not available."));
        return;
      }
      const request = indexedDB.open(MAP_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MAP_CACHE_STORE_NAME)) {
          db.createObjectStore(MAP_CACHE_STORE_NAME, { keyPath: "seed" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
    });
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) {
        reject(new Error("No blob was provided."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read blob as data URL."));
      reader.readAsDataURL(blob);
    });
  }

  function convertImageElementToDataUrl(image) {
    try {
      if (!image) return "";
      const width = Math.max(1, image.naturalWidth || image.width || 0);
      const height = Math.max(1, image.naturalHeight || image.height || 0);
      if (!width || !height) return "";
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return "";
      ctx.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } catch (error) {
      return "";
    }
  }

  async function cacheImportedMap(seed, payload, imageSource, sourceLabel) {
    const safeSeed = String(seed || "").trim();
    if (!safeSeed || !payload || !supportsIndexedDb()) return;
    try {
      let imageDataUrl = "";
      if (typeof Blob !== "undefined" && imageSource instanceof Blob) {
        imageDataUrl = await readBlobAsDataUrl(imageSource);
      } else if (imageSource instanceof HTMLImageElement && imageSource.src) {
        imageDataUrl = convertImageElementToDataUrl(imageSource);
        if (!imageDataUrl && !/^blob:/i.test(String(imageSource.src))) {
          imageDataUrl = String(imageSource.src);
        }
      }
      if (!imageDataUrl) return;
      const db = await openMapCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(MAP_CACHE_STORE_NAME, "readwrite");
        const store = tx.objectStore(MAP_CACHE_STORE_NAME);
        store.put({
          seed: safeSeed,
          payload,
          imageDataUrl,
          sourceLabel: String(sourceLabel || "cache"),
          savedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to write cache entry."));
        tx.onabort = () => reject(tx.error || new Error("Cache transaction was aborted."));
      });
      db.close();
    } catch (error) {
      // Caching is a best-effort local convenience feature.
    }
  }

  async function tryLoadSeedFilesFromCache(seed) {
    const safeSeed = String(seed || "").trim();
    if (!safeSeed || !supportsIndexedDb()) return null;
    try {
      const db = await openMapCacheDb();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(MAP_CACHE_STORE_NAME, "readonly");
        const store = tx.objectStore(MAP_CACHE_STORE_NAME);
        const request = store.get(safeSeed);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Failed to read cache entry."));
      });
      db.close();
      if (!record || !record.payload || !record.imageDataUrl) return null;
      const image = await loadImageElement(record.imageDataUrl);
      return {
        payload: record.payload,
        image,
        source: `local cache (${record.sourceLabel || "previously loaded map"})`,
        loadedFromJs: true,
        loadedFromCache: true
      };
    } catch (error) {
      return null;
    }
  }

  const localMapFileCache = {
    byRelativePath: new Map(),
    byName: new Map(),
    orderedFiles: [],
    sourceLabel: ""
  };

  function isFileProtocol() {
    return window.location && window.location.protocol === "file:";
  }

  function normalizeRelativePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  }

  function buildCandidateRelativePaths(seed, extension) {
    const encodedSeed = encodeURIComponent(seed);
    return [
      `map/${seed}.${extension}`,
      `map/${encodedSeed}.${extension}`,
      `${seed}.${extension}`,
      `${encodedSeed}.${extension}`
    ].map(normalizeRelativePath);
  }

  function getSeedFileFromCache(seed, extension) {
    const candidates = buildCandidateRelativePaths(seed, extension);
    for (const candidate of candidates) {
      if (localMapFileCache.byRelativePath.has(candidate)) {
        return localMapFileCache.byRelativePath.get(candidate);
      }
    }
    const directName = `${seed}.${extension}`.toLowerCase();
    const encodedName = `${encodeURIComponent(seed)}.${extension}`.toLowerCase();
    return localMapFileCache.byName.get(directName) || localMapFileCache.byName.get(encodedName) || null;
  }

  async function tryLoadSeedFilesFromSelectedFolder(seed) {
    const safeSeed = (seed || "").trim();
    if (!safeSeed || !localMapFileCache.byName.size) return null;

    const jsFile = getSeedFileFromCache(safeSeed, "js");
    if (!jsFile) return null;

    return await loadMapFilesFromSelectedFolder(safeSeed, jsFile, localMapFileCache.sourceLabel || "selected folder");
  }

  function stripExtension(fileName) {
    return String(fileName || "").replace(/\.[^.]+$/, "");
  }

  function resolveImportedSeed(fallbackSeed, payload) {
    const payloadSeed = payload && typeof payload.seed === "string" ? payload.seed.trim() : "";
    return payloadSeed || String(fallbackSeed || "").trim() || "map";
  }

  function clearMapDataScriptGlobal() {
    try {
      delete window[MAP_DATA_SCRIPT_GLOBAL];
    } catch (error) {
      window[MAP_DATA_SCRIPT_GLOBAL] = undefined;
    }
  }

  function normalizeScriptPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.mapData && typeof payload.mapData === "object") return payload.mapData;
    if (payload.default && typeof payload.default === "object") return payload.default;
    return payload;
  }

  function buildNoCacheUrl(url) {
    if (!url || isFileProtocol()) return url;
    const separator = url.indexOf("?") === -1 ? "?" : "&";
    return `${url}${separator}_ts=${Date.now()}`;
  }

  async function loadMapDataFromJsUrl(jsUrl) {
    if (!jsUrl) return null;
    return await new Promise((resolve, reject) => {
      clearMapDataScriptGlobal();
      const script = document.createElement("script");
      script.async = true;
      script.defer = false;
      script.src = buildNoCacheUrl(jsUrl);
      script.onload = () => {
        const payload = normalizeScriptPayload(window[MAP_DATA_SCRIPT_GLOBAL]);
        clearMapDataScriptGlobal();
        script.remove();
        if (!payload) {
          reject(new Error(`Map data script loaded but did not set window.${MAP_DATA_SCRIPT_GLOBAL}.`));
          return;
        }
        resolve(payload);
      };
      script.onerror = () => {
        clearMapDataScriptGlobal();
        script.remove();
        reject(new Error(`Failed to load script: ${jsUrl}`));
      };
      document.head.appendChild(script);
    });
  }

  async function loadMapDataFromJsFile(jsFile) {
    if (!jsFile) return null;
    const objectUrl = URL.createObjectURL(jsFile);
    try {
      return await loadMapDataFromJsUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function loadImageFromPayload(payload) {
    const dataUrl = payload && payload.mapImage && typeof payload.mapImage.dataUrl === "string"
      ? payload.mapImage.dataUrl
      : "";
    if (!dataUrl) return null;
    return await loadImageElement(dataUrl);
  }

  function getFirstMapEntryFromSelectedFolder() {
    if (!localMapFileCache.orderedFiles.length) return null;

    for (const file of localMapFileCache.orderedFiles) {
      const fileName = String(file && file.name ? file.name : "");
      if (!/\.js$/i.test(fileName)) continue;
      const baseName = stripExtension(fileName);
      return {
        seed: baseName,
        jsFile: file
      };
    }

    return null;
  }

  async function loadMapFilesFromSelectedFolder(seed, jsFile, sourceLabel) {
    if (!jsFile) return null;

    try {
      const payload = await loadMapDataFromJsFile(jsFile);
      if (!payload) {
        UI.addLog(`Selected folder .js file did not provide map data for ${seed}.`);
        return null;
      }

      const image = await loadImageFromPayload(payload);
      if (!image) {
        UI.addLog(`Selected folder .js file did not provide mapImage.dataUrl for ${seed}.`);
        return null;
      }

      const resolvedSeed = resolveImportedSeed(seed, payload);
      const cacheSource = image;
      await cacheImportedMap(resolvedSeed, payload, cacheSource, sourceLabel || localMapFileCache.sourceLabel || "selected folder");
      if (resolvedSeed !== seed) {
        await cacheImportedMap(seed, payload, cacheSource, sourceLabel || localMapFileCache.sourceLabel || "selected folder");
      }
      return {
        seed: resolvedSeed,
        payload,
        image,
        source: sourceLabel || localMapFileCache.sourceLabel || "selected folder",
        loadedFromJs: true
      };
    } catch (error) {
      UI.addLog(`Stored map files could not be read for ${seed}.`, error && error.message ? error.message : String(error));
      return null;
    }
  }

  async function registerLocalMapFiles(fileList) {
    localMapFileCache.byRelativePath.clear();
    localMapFileCache.byName.clear();
    localMapFileCache.orderedFiles = [];
    localMapFileCache.sourceLabel = "";

    const files = Array.from(fileList || []);
    if (!files.length) {
      UI.addLog("No local folder was selected for map loading.");
      return false;
    }

    const rootFolderName = String(files[0].webkitRelativePath || "").split("/")[0] || "selected folder";
    localMapFileCache.sourceLabel = rootFolderName;

    let indexedCount = 0;
    let skippedNestedCount = 0;
    for (const file of files) {
      const rawRelativePath = String((file && file.webkitRelativePath) || (file && file.name) || "");
      const normalizedRelativePath = normalizeRelativePath(rawRelativePath);
      const pathParts = normalizedRelativePath ? normalizedRelativePath.split("/").filter(Boolean) : [];
      const isDirectChild = pathParts.length <= 2;
      if (!isDirectChild) {
        skippedNestedCount += 1;
        continue;
      }
      const fileName = String(file && file.name ? file.name : "").toLowerCase();
      if (normalizedRelativePath) localMapFileCache.byRelativePath.set(normalizedRelativePath, file);
      if (fileName) localMapFileCache.byName.set(fileName, file);
      localMapFileCache.orderedFiles.push(file);
      indexedCount += 1;
    }

    UI.addLog(`Local map folder indexed.`, `${indexedCount} direct files scanned from ${rootFolderName}.` + (skippedNestedCount ? ` ${skippedNestedCount} nested files were ignored.` : ""));

    const firstEntry = getFirstMapEntryFromSelectedFolder();
    if (!firstEntry) {
      UI.addLog("No loadable map files were found in the selected folder.", "Expected at least one .js map file containing map data and mapImage.dataUrl.");
      return false;
    }

    const world = State.world || {};
    const cols = world.cols || Config.DEFAULT_COLS;
    const rows = world.rows || Config.DEFAULT_ROWS;
    const imported = await loadMapFilesFromSelectedFolder(firstEntry.seed, firstEntry.jsFile, localMapFileCache.sourceLabel || "selected folder");
    if (imported && imported.payload && imported.image) {
      applyImportedWorld(imported.seed, cols, rows, imported.payload, imported.image, imported.source);
      return true;
    }

    UI.addLog("Stored map files found in the selected folder could not be loaded.", `First detected map entry: ${firstEntry.seed}.`);
    return false;
  }

  function promptLocalMapFolderSelection() {
    const folderInput = State.dom && State.dom.localMapFolderInput;
    if (!folderInput) {
      UI.addLog("Local folder picker is not available in this build.");
      return;
    }
    folderInput.value = "";
    folderInput.click();
  }

  async function tryLoadMapFromJsPath(seed, jsUrl, sourceLabel) {
    let payload = null;
    try {
      payload = await loadMapDataFromJsUrl(jsUrl);
      if (!payload) return null;
      const image = await loadImageFromPayload(payload);
      if (!image) {
        UI.addLog(`JS map bundle loaded but mapImage.dataUrl is missing: ${jsUrl}`);
        return null;
      }
      const resolvedSeed = resolveImportedSeed(seed, payload);
      await cacheImportedMap(resolvedSeed, payload, image, sourceLabel);
      if (resolvedSeed !== seed) {
        await cacheImportedMap(seed, payload, image, sourceLabel);
      }
      return {
        seed: resolvedSeed,
        payload,
        image,
        source: sourceLabel,
        loadedFromJs: true
      };
    } catch (error) {
      throw error;
    }
  }

  async function tryLoadStartupSequence(seed) {
    const safeSeed = (seed || "").trim();
    if (!safeSeed) return null;

    const candidates = [
      {
        key: `${safeSeed}`,
        jsUrl: `map/${encodeURIComponent(safeSeed)}.js`,
        sourceLabel: "map folder (seed root JS)",
        label: `${safeSeed}.js in /map`
      },
      {
        key: `${safeSeed}`,
        jsUrl: `map/${encodeURIComponent(safeSeed)}/${encodeURIComponent(safeSeed)}.js`,
        sourceLabel: "map folder (seed subfolder JS)",
        label: `${safeSeed}.js in /map/${safeSeed}`
      },
      {
        key: "map",
        jsUrl: "map/map.js",
        sourceLabel: "map folder (fixed map JS)",
        label: "map.js in /map"
      }
    ];

    let stepIndex = 1;
    for (const candidate of candidates) {
      UI.addLog(`Startup load step ${stepIndex}/${candidates.length + 1}: trying JS map bundle.`, `Path: ${candidate.jsUrl}`);
      try {
        const importedFromJs = await tryLoadMapFromJsPath(candidate.key, candidate.jsUrl, candidate.sourceLabel);
        if (importedFromJs) {
          UI.addLog(`Startup load succeeded with JS map bundle.`, `Source: ${candidate.label}`);
          return importedFromJs;
        }
        UI.addLog(`JS map bundle was not usable.`, candidate.jsUrl);
      } catch (error) {
        UI.addLog(`JS map bundle load failed.`, error && error.message ? error.message : String(error));
      }
      stepIndex += 1;
    }

    UI.addLog(`Startup load step ${candidates.length + 1}/${candidates.length + 1}: generating a new map.`);
    return null;
  }

  async function tryLoadSeedFiles(seed) {
    const safeSeed = (seed || "").trim();
    if (!safeSeed) return null;

    const jsUrl = `map/${encodeURIComponent(safeSeed)}.js`;

    try {
      const importedFromJs = await tryLoadMapFromJsPath(safeSeed, jsUrl, "map folder (seed JS)");
      if (importedFromJs) return importedFromJs;
      UI.addLog(`No valid JS map bundle found for ${safeSeed}.`, jsUrl);
    } catch (error) {
      UI.addLog(`Seed JS map bundle could not be loaded for ${safeSeed}.`, error && error.message ? error.message : String(error));
    }

    const cached = await tryLoadSeedFilesFromCache(safeSeed);
    if (cached) {
      UI.addLog(`Loaded cached map for ${safeSeed}.`, "The app used the previously cached local copy of this map.");
      return cached;
    }

    return await tryLoadSeedFilesFromSelectedFolder(safeSeed);
  }

  function applyImportedWorld(seed, cols, rows, payload, image, sourceLabel) {
    const world = State.world;
    const camera = State.camera;
    const render = State.render;
    const importedMap = payload && payload.map ? payload.map : {};
    const importedCamera = payload && payload.camera ? payload.camera : {};
    const importedPlayer = payload && payload.player ? payload.player : {};
    const resolvedCols = Math.max(1, Number(importedMap.cols) || cols);
    const resolvedRows = Math.max(1, Number(importedMap.rows) || rows);
    const fallbackPlayer = createDefaultPlayer(resolvedRows, resolvedCols);

    world.seed = seed;
    world.cols = resolvedCols;
    world.rows = resolvedRows;
    world.tileWidth = Number(importedMap.tileWidth) || world.tileWidth || Config.TILE_WIDTH;
    world.tileHeight = Number(importedMap.tileHeight) || world.tileHeight || Config.TILE_HEIGHT;
    world.selected = null;
    world.hover = null;
    world.previewPath = [];
    world.terrain = buildTerrainGridFromTiles(payload, resolvedCols, resolvedRows);
    try {
      const Terrain = window.Game && window.Game.Terrain;
      world.generatedTerrainShapes = Terrain && typeof Terrain.buildGeneratedTerrainShapes === "function"
        ? Terrain.buildGeneratedTerrainShapes(world.terrain, seed)
        : [];
    } catch (error) {
      world.generatedTerrainShapes = [];
    }
    world.params = payload && payload.params ? payload.params : {
      hillCount: 0,
      streamCount: 0,
      roadCount: 0,
      hasLake: false,
      hasForest: false,
      hasSettlement: false,
      actualHillCoverage: 0,
      actualForestCoverage: 0,
      actualSettlementCoverage: 0,
      actualGrassCoverage: 0,
      actualDirtCoverage: 0,
      actualWaterCoverage: 0,
      actualStoneCoverage: 0
    };
    world.player = {
      ...fallbackPlayer,
      row: clampInteger(importedPlayer.row, 0, resolvedRows - 1, fallbackPlayer.row),
      col: clampInteger(importedPlayer.col, 0, resolvedCols - 1, fallbackPlayer.col),
      startRow: clampInteger(importedPlayer.row, 0, resolvedRows - 1, fallbackPlayer.startRow),
      startCol: clampInteger(importedPlayer.col, 0, resolvedCols - 1, fallbackPlayer.startCol),
      targetRow: clampInteger(importedPlayer.row, 0, resolvedRows - 1, fallbackPlayer.targetRow),
      targetCol: clampInteger(importedPlayer.col, 0, resolvedCols - 1, fallbackPlayer.targetCol),
      direction: importedPlayer.direction || fallbackPlayer.direction,
      moving: false,
      progress: 1,
      pathQueue: []
    };

    if (Number.isFinite(Number(importedCamera.pitchAngle))) camera.pitchAngle = Number(importedCamera.pitchAngle);
    if (Number.isFinite(Number(importedCamera.depthStrength))) camera.depthStrength = Number(importedCamera.depthStrength);
    if (Number.isFinite(Number(importedCamera.blendPixelSize))) camera.blendPixelSize = Number(importedCamera.blendPixelSize);
    if (Number.isFinite(Number(importedCamera.blendStrength))) camera.blendStrength = Number(importedCamera.blendStrength);
    if (Number.isFinite(Number(importedCamera.noiseGridDivisions))) camera.noiseGridDivisions = Number(importedCamera.noiseGridDivisions);
    if (typeof importedCamera.showGrid === "boolean") camera.showGrid = importedCamera.showGrid;
    if (typeof importedCamera.reliefEnabled === "boolean") camera.reliefEnabled = importedCamera.reliefEnabled;
    if (Number.isFinite(Number(importedCamera.sunAzimuth))) camera.sunAzimuth = Number(importedCamera.sunAzimuth);
    if (Number.isFinite(Number(importedCamera.sunElevation))) camera.sunElevation = Number(importedCamera.sunElevation);
    if (Number.isFinite(Number(importedCamera.shadowStrength))) camera.shadowStrength = Number(importedCamera.shadowStrength);
    if (Number.isFinite(Number(importedCamera.highlightStrength))) camera.highlightStrength = Number(importedCamera.highlightStrength);
    if (Number.isFinite(Number(importedCamera.shadowLength))) camera.shadowLength = Number(importedCamera.shadowLength);
    camera.zoom = Number.isFinite(Number(importedCamera.zoom)) ? Number(importedCamera.zoom) : Config.DEFAULT_START_ZOOM;
    camera.x = world.player.col;
    camera.y = world.player.row;

    const importedImageMeta = payload && payload.mapImage ? payload.mapImage : null;
    const importedImageShape = importedImageMeta && typeof importedImageMeta.shape === "string"
      ? importedImageMeta.shape.toLowerCase()
      : "";
    const shouldTreatImageAsDiamond = importedImageShape === "diamond" || (!importedImageShape && imageLooksDiamondShaped(image));

    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    const backgroundMode = shouldTreatImageAsDiamond ? "diamond->square" : "rotated-square";
    let backgroundCanvas = null;
    if (shouldTreatImageAsDiamond) {
      backgroundCanvas = convertDiamondImageToSquareCanvas(image, resolvedCols, resolvedRows);
    } else {
      backgroundCanvas = convertImageToRotatedBackgroundCanvas(image, resolvedCols, resolvedRows);
    }
    if (!backgroundCanvas) {
      backgroundCanvas = convertImageToRotatedBackgroundCanvas(image, resolvedCols, resolvedRows);
    }

    render.worldBackgroundCanvas = backgroundCanvas;
    render.needsBackgroundRebuild = false;
    render.needsBackgroundUpload = true;
    render.backgroundTextureReady = false;
    render.backgroundUploadBlocked = false;
    render.backgroundSource = `imported:${sourceLabel || 'map'}`;
    render.preserveBackground = true;

    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.fitCameraToWorld();
    Renderer.markDirty();
    const sourceText = sourceLabel ? `Source: ${sourceLabel}.` : "";
    const spawnTile = world.terrain && world.terrain[world.player.row]
      ? world.terrain[world.player.row][world.player.col]
      : null;
    const spawnBlocked = !!(spawnTile && spawnTile.tags && typeof spawnTile.tags.has === "function" && spawnTile.tags.has("blocked"));
    const spawnTileType = spawnTile && spawnTile.type ? spawnTile.type : "unknown";
    UI.addLog(
      `Stored map files loaded for seed ${seed}.`,
      `${sourceText} Loaded map image and map data for ${seed}. SourceImage: ${sourceWidth}x${sourceHeight}. BackgroundMode: ${backgroundMode}. Canvas: ${backgroundCanvas.width}x${backgroundCanvas.height}. PreserveBackground: true.`.trim()
    );
    UI.addLog(
      `Imported spawn tile resolved.`,
      `Player row=${world.player.row}, col=${world.player.col}, tileType=${spawnTileType}, blocked=${spawnBlocked}`
    );
    UI.addLog(
      `Quad texture source set to imported map image.`,
      `Background source: ${render.backgroundSource}. Canvas: ${backgroundCanvas.width}x${backgroundCanvas.height}.`
    );
    if (backgroundCanvas.width !== sourceWidth || backgroundCanvas.height !== sourceHeight) {
      UI.addLog(
        `Imported map image resized for quad texture upload.`,
        `SourceImage: ${sourceWidth}x${sourceHeight} -> Canvas: ${backgroundCanvas.width}x${backgroundCanvas.height}`
      );
    }
  }

  function applyGeneratedWorld(seed, cols, rows, options = {}) {
    const world = State.world;
    world.seed = seed;
    world.cols = cols;
    world.rows = rows;
    world.selected = null;
    world.hover = null;
    world.previewPath = [];
    world.player = createDefaultPlayer(rows, cols);

    const generated = Terrain.generateWorld(seed, cols, rows);
    if (generated && generated.playerStart) {
      world.player.row = generated.playerStart.row;
      world.player.col = generated.playerStart.col;
      world.player.startRow = generated.playerStart.row;
      world.player.startCol = generated.playerStart.col;
      world.player.targetRow = generated.playerStart.row;
      world.player.targetCol = generated.playerStart.col;
    }
    State.camera.zoom = Config.DEFAULT_START_ZOOM;
    State.camera.x = world.player.col;
    State.camera.y = world.player.row;

    world.terrain = generated.grid;
    world.params = generated.params;
    world.generatedTerrainShapes = Array.isArray(generated.generatedTerrainShapes) ? generated.generatedTerrainShapes : [];

    const preserveBackground = !!(options && options.preserveBackground);
    // If preserving an externally provided map image background, do not trigger a full
    // background rebuild which would overwrite the provided image.
    State.render.preserveBackground = preserveBackground;
    State.render.needsBackgroundRebuild = !preserveBackground;
    State.render.needsBackgroundUpload = true;
    State.render.backgroundTextureReady = false;
    State.render.backgroundUploadBlocked = false;
    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.fitCameraToWorld();
    Renderer.markDirty();
    UI.addLog(I18n.t("logs.worldRebuilt", { seed, cols, rows }));
    if (preserveBackground) {
      UI.addLog(`World generated for seed ${seed}, preserving imported background image.`);
    }
  }

  async function rebuildWorld(seed, cols, rows, options = {}) {
    UI.showLoading();
    try {
      const imported = options && options.preferFixedStartupMap
        ? await tryLoadStartupSequence(seed)
        : await tryLoadSeedFiles(seed);
      if (imported && imported.payload && imported.image) {
        applyImportedWorld(imported.seed || seed, cols, rows, imported.payload, imported.image, imported.source);
        return;
      }

      applyGeneratedWorld(seed, cols, rows);
    } finally {
      UI.hideLoading();
    }
  }

  function updateWorldSummary(seed, cols, rows) {
    UI.updateDialogText(
      I18n.t("dialog.worldSummary", {
        seed,
        cols,
        rows,
        hills: State.world.params.hillCount,
        streams: State.world.params.streamCount,
        roads: State.world.params.roadCount
      })
    );
  }

  async function handleApplySettings() {
    const dom = State.dom;

    const seed = (dom.seedInput.value || "").trim() || Config.DEFAULT_SEED;
    const cols = Utils.clamp(Number(dom.mapWidthInput.value) || Config.DEFAULT_COLS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const rows = Utils.clamp(Number(dom.mapHeightInput.value) || Config.DEFAULT_ROWS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const pitchAngle = Utils.clamp(Number(dom.cameraPitchInput.value) || Config.DEFAULT_CAMERA_PITCH, Config.MIN_CAMERA_PITCH, Config.MAX_CAMERA_PITCH);
    const depthStrength = Utils.clamp(Number(dom.depthStrengthInput.value) || Config.DEFAULT_DEPTH_STRENGTH, Config.MIN_DEPTH_STRENGTH, Config.MAX_DEPTH_STRENGTH);
    const blendPixelSize = Utils.clamp(
      Number(dom.blendPixelSizeInput && dom.blendPixelSizeInput.value) || Config.DEFAULT_BLEND_PIXEL_SIZE,
      Config.MIN_BLEND_PIXEL_SIZE,
      Config.MAX_BLEND_PIXEL_SIZE
    );
    const blendStrength = Utils.clamp(
      Number(dom.blendStrengthInput && dom.blendStrengthInput.value) || Config.DEFAULT_BLEND_STRENGTH,
      Config.MIN_BLEND_STRENGTH,
      Config.MAX_BLEND_STRENGTH
    );
    const noiseGridDivisions = Utils.clamp(
      Number(dom.noiseGridDivisionsInput && dom.noiseGridDivisionsInput.value) || Config.DEFAULT_NOISE_GRID_DIVISIONS,
      Config.MIN_NOISE_GRID_DIVISIONS,
      Config.MAX_NOISE_GRID_DIVISIONS
    );
    
    const showGrid = !!(dom.showGridInput && dom.showGridInput.checked);
    const showTerrainWalls = !(dom.showTerrainWallsInput) || !!dom.showTerrainWallsInput.checked;
    const reliefEnabled = !!(dom.reliefEnabledInput && dom.reliefEnabledInput.checked);
    const sunAzimuth = Utils.clamp(
      Number(dom.sunAzimuthInput && dom.sunAzimuthInput.value) || Config.DEFAULT_SUN_AZIMUTH,
      Config.MIN_SUN_AZIMUTH,
      Config.MAX_SUN_AZIMUTH
    );
    const sunElevation = Utils.clamp(
      Number(dom.sunElevationInput && dom.sunElevationInput.value) || Config.DEFAULT_SUN_ELEVATION,
      Config.MIN_SUN_ELEVATION,
      Config.MAX_SUN_ELEVATION
    );
    const shadowStrength = Utils.clamp(
      Number(dom.shadowStrengthInput && dom.shadowStrengthInput.value) || Config.DEFAULT_SHADOW_STRENGTH,
      Config.MIN_SHADOW_STRENGTH,
      Config.MAX_SHADOW_STRENGTH
    );
    const highlightStrength = Utils.clamp(
      Number(dom.highlightStrengthInput && dom.highlightStrengthInput.value) || Config.DEFAULT_HIGHLIGHT_STRENGTH,
      Config.MIN_HIGHLIGHT_STRENGTH,
      Config.MAX_HIGHLIGHT_STRENGTH
    );
    const shadowLength = Utils.clamp(
      Number(dom.shadowLengthInput && dom.shadowLengthInput.value) || Config.DEFAULT_SHADOW_LENGTH,
      Config.MIN_SHADOW_LENGTH,
      Config.MAX_SHADOW_LENGTH
    );

    State.camera.pitchAngle = pitchAngle;
    State.camera.depthStrength = depthStrength;
    State.camera.blendPixelSize = blendPixelSize;
    State.camera.blendStrength = blendStrength;
    State.camera.noiseGridDivisions = noiseGridDivisions;
    State.camera.showGrid = showGrid;
    State.camera.showTerrainWalls = showTerrainWalls;
    State.camera.reliefEnabled = reliefEnabled;
    State.camera.sunAzimuth = sunAzimuth;
    State.camera.sunElevation = sunElevation;
    State.camera.shadowStrength = shadowStrength;
    State.camera.highlightStrength = highlightStrength;
    State.camera.shadowLength = shadowLength;
    // Preserve TERRAIN_SHAPES across the world rebuild triggered by settings apply.
    // Some rebuild paths may reset or clear configuration arrays; keep a copy
    // and restore it if necessary to avoid overlays vanishing when users press Apply.
    const savedTerrainShapes = Array.isArray(Config.TERRAIN_SHAPES) ? JSON.parse(JSON.stringify(Config.TERRAIN_SHAPES)) : null;
    await rebuildWorld(seed, cols, rows);
    // If the rebuild or any startup sequence cleared the config entry, restore it.
    try {
      if (savedTerrainShapes && (!Array.isArray(Config.TERRAIN_SHAPES) || Config.TERRAIN_SHAPES.length === 0)) {
        Config.TERRAIN_SHAPES = savedTerrainShapes;
        if (UI && UI.addLog) UI.addLog('Restored terrain overlay shapes after settings applied.');
      }
    } catch (e) {
      console.warn('Failed to restore TERRAIN_SHAPES after settings apply', e);
    }
    UI.closeSettingsModal();
    UI.addLog(I18n.t("logs.settingsApplied", { seed, cols, rows }));
    updateWorldSummary(seed, cols, rows);
  }

  async function handleLanguageChange(lang) {
    await I18n.loadLanguage(lang);
    UI.applyCurrentLanguageToUI();
    updateWorldSummary(State.world.seed, State.world.cols, State.world.rows);
  }

  function resizeAll() {
    UI.updateResponsiveLayout();
    Renderer.resizeCanvas();
    Renderer.updateZoomLimits();
    Minimap.resizeMinimap();
    Renderer.markDirty();
  }

  function loop(timestamp) {
    const now = timestamp || performance.now();
    const previousTimestamp = loop.__lastTimestamp || now;
    const deltaMs = now - previousTimestamp;
    loop.__lastTimestamp = now;

    Input.updateCameraFromKeyboard();
    Input.updateCameraInertia(deltaMs);
    Input.updatePlayerMovement(now);
    Renderer.updateCameraFollow();
    Renderer.renderWorld();
    Minimap.renderMinimap();
    requestAnimationFrame(loop);
  }

  function normalizeUrl(url) {
    if (!url) return I18n.t("logs.unknownSource");
    try {
      const parsed = new URL(url, window.location.href);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || parsed.href;
    } catch (error) {
      return String(url);
    }
  }

  function formatStack(error) {
    if (!error || !error.stack) return I18n.t("logs.noStack");
    return error.stack;
  }

  function buildErrorDetails(message, source, lineno, colno, errorObj, extra) {
    const detailLines = [
      `${I18n.t("logs.message")}    : ${message || I18n.t("logs.unknown")}`,
      `${I18n.t("logs.file")}      : ${normalizeUrl(source)}`,
      `${I18n.t("logs.line")}      : ${lineno || 0}`,
      `${I18n.t("logs.column")}    : ${colno || 0}`
    ];

    if (extra) {
      detailLines.push(`${I18n.t("logs.extraInfo")} : ${extra}`);
    }

    if (errorObj && errorObj.name) {
      detailLines.push(`${I18n.t("logs.errorType")} : ${errorObj.name}`);
    }

    detailLines.push(`${I18n.t("logs.stack")}     :`);
    detailLines.push(formatStack(errorObj));

    return detailLines.join("\n");
  }

  function registerGlobalErrorHandlers() {
    const ignoreFileOriginWarning = (message) => {
      return typeof message === "string" && message.indexOf("Unsafe attempt to load URL file:///") !== -1;
    };

    window.onerror = function (message, source, lineno, colno, errorObj) {
      if (ignoreFileOriginWarning(message)) return true;
      UI.addLog(I18n.t("logs.runtimeError"), buildErrorDetails(message, source, lineno, colno, errorObj));
      return false;
    };

    window.addEventListener("error", (event) => {
      if (ignoreFileOriginWarning(event.message)) return;
      if (event.error || event.message) {
        UI.addLog(
          I18n.t("logs.globalError"),
          buildErrorDetails(event.message, event.filename, event.lineno, event.colno, event.error)
        );
        return;
      }

      const target = event.target;
      if (target && target !== window) {
        const source = target.src || target.href || target.currentSrc || I18n.t("logs.unknownSource");
        UI.addLog(
          I18n.t("logs.staticResourceFailed"),
          buildErrorDetails(
            I18n.t("logs.resourceLoadError"),
            source,
            0,
            0,
            null,
            `${I18n.t("logs.tag")}: <${String(target.tagName || "unknown").toLowerCase()}>`
          )
        );
      }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const reasonMessage = reason && reason.message ? reason.message : String(reason);
      UI.addLog(
        I18n.t("logs.promiseRejection"),
        buildErrorDetails(reasonMessage, reason && reason.fileName, reason && reason.lineNumber, reason && reason.columnNumber, reason)
      );
    });
  }


  async function ensureTerrainTexturesLoaded() {
    const renderer = window.Game.Renderer;
    if (!renderer || !renderer.ensureTerrainTexturesLoaded) {
      UI.addLog("Terrain texture loader is not available.");
      return;
    }
    try {
      await renderer.ensureTerrainTexturesLoaded();
      if (renderer.getTerrainTextureStatus) {
        const info = renderer.getTerrainTextureStatus();
        UI.addLog(`Terrain textures loaded (${info.count}).`, `Status: ${info.status}`);
      } else {
        UI.addLog("Terrain textures loaded.");
      }
    } catch (error) {
      UI.addLog("Terrain textures could not be fully loaded.", error && error.message ? error.message : String(error));
    }
  }

  async function init() {
    try {
      await I18n.loadLanguage(I18n.getPreferredLanguage());
      UI.cacheDom();
      UI.bindUIEvents(handleApplySettings, handleLanguageChange);
      UI.bindChoiceButtons();
      Input.bindInputEvents();
      Minimap.bindMinimapEvents();
      registerGlobalErrorHandlers();
      UI.applyCurrentLanguageToUI();
      await ensureTerrainTexturesLoaded();

      resizeAll();
      UI.addLog(I18n.t("logs.appStarted"));
      await rebuildWorld(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS, { preferFixedStartupMap: true });

      // Remove any leftover TEST ELIPSE named-features; we draw the player circle
      // directly in the renderer after the terrain painting finishes.
      try {
        if (State.world && Array.isArray(State.world.namedFeatures)) {
          State.world.namedFeatures = State.world.namedFeatures.filter(f => !(f && f.name === 'TEST ELIPSE'));
        }
      } catch (e) {
        console.warn('Failed to remove TEST ELIPSE overlay', e);
      }

      updateWorldSummary(State.world.seed, State.world.cols, State.world.rows);

      window.addEventListener("resize", () => {
        resizeAll();
        UI.addLog(I18n.t("logs.windowResized"));
      });

      loop();
    } catch (error) {
      console.error(error);
      alert(error.message || String(error));
    }
  }

  window.Game.App = {
    registerLocalMapFiles,
    promptLocalMapFolderSelection
  };

  window.addEventListener("DOMContentLoaded", init);
})();
