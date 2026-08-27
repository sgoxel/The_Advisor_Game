/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;

  function buildSquareMapCanvas() {
    const world = State.world;
    const render = State.render;
    const renderer = window.Game && window.Game.Renderer;

    if (renderer && typeof renderer.renderWorld === "function") {
      renderer.renderWorld(true);
    }

    const sourceCanvas = render && render.worldBackgroundCanvas;
    if (!sourceCanvas) return null;

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = sourceCanvas.width;
    baseCanvas.height = sourceCanvas.height;

    const baseCtx = baseCanvas.getContext("2d", { alpha: false });
    baseCtx.drawImage(sourceCanvas, 0, 0);

    const cellWidth = baseCanvas.width / Math.max(1, world.cols || 1);
    const cellHeight = baseCanvas.height / Math.max(1, world.rows || 1);

    if (State.camera && State.camera.showGrid) {
      baseCtx.save();
      baseCtx.strokeStyle = "rgba(31, 43, 54, 0.45)";
      baseCtx.lineWidth = 1;
      baseCtx.beginPath();
      for (let col = 0; col <= world.cols; col++) {
        const x = Math.round(col * cellWidth) + 0.5;
        baseCtx.moveTo(x, 0);
        baseCtx.lineTo(x, baseCanvas.height);
      }
      for (let row = 0; row <= world.rows; row++) {
        const y = Math.round(row * cellHeight) + 0.5;
        baseCtx.moveTo(0, y);
        baseCtx.lineTo(baseCanvas.width, y);
      }
      baseCtx.stroke();
      baseCtx.restore();
    }

    return baseCanvas;
  }

  function buildDiamondMapExportCanvas() {
    const baseCanvas = buildSquareMapCanvas();
    if (!baseCanvas) return null;

    const padding = 2;
    const bboxWidth = Math.ceil((baseCanvas.width + baseCanvas.height) / Math.SQRT2) + padding * 2;
    const bboxHeight = bboxWidth;

    const diamondCanvas = document.createElement("canvas");
    diamondCanvas.width = bboxWidth;
    diamondCanvas.height = bboxHeight;

    const ctx = diamondCanvas.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, diamondCanvas.width, diamondCanvas.height);
    ctx.translate(diamondCanvas.width / 2, diamondCanvas.height / 2);
    ctx.rotate(Math.PI / 4);
    ctx.drawImage(baseCanvas, -baseCanvas.width / 2, -baseCanvas.height / 2);

    return diamondCanvas;
  }

  function buildFullMapExportCanvas() {
    return buildDiamondMapExportCanvas();
  }

  function buildSafeBaseFilename() {
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const seed = (State.world && State.world.seed ? String(State.world.seed) : "map").replace(/[^a-z0-9_-]+/gi, "_");
    return `${seed || "map"}-${timestamp}`;
  }

  function triggerDownload(url, filename, logKey) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof url === "string" && url.startsWith("blob:")) {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    addLog(I18n && I18n.t ? I18n.t(logKey || "logs.exportCompleted", { filename }) : `Export completed: ${filename}`);
  }


  const TILE_EXPORT_CODES = {
    grass: "gr",
    dirt: "di",
    forest: "fo",
    lake: "la",
    river: "ri",
    road: "ro",
    mountain: "mo",
    settlement: "se"
  };

  function encodeTileType(tileType) {
    return TILE_EXPORT_CODES[tileType] || String(tileType || "gr").slice(0, 2).toLowerCase();
  }

  function buildCompactTileRecord(tile, x, y) {
    const record = {
      cr: `${x},${y}`,
      t: encodeTileType(tile && tile.type)
    };
    const elevation = Number(tile && tile.elevation);
    if (Number.isFinite(elevation) && elevation !== 0) {
      record.e = elevation;
    }
    return record;
  }

  function buildMapDataExportObject(options = {}) {
    const world = State.world || {};
    const camera = State.camera || {};
    const exportCanvas = buildFullMapExportCanvas();
    if (!exportCanvas) return null;

    const payload = {
      format: "simsoft-map-data",
      version: 5,
      seed: world.seed || "",
      map: {
        cols: world.cols || 0,
        rows: world.rows || 0,
        tileWidth: world.tileWidth || 0,
        tileHeight: world.tileHeight || 0
      },
      camera: {
        pitchAngle: camera.pitchAngle,
        depthStrength: camera.depthStrength,
        blendPixelSize: camera.blendPixelSize,
        blendStrength: camera.blendStrength,
        noiseGridDivisions: camera.noiseGridDivisions,
        showGrid: !!camera.showGrid,
        reliefEnabled: !!camera.reliefEnabled,
        sunAzimuth: camera.sunAzimuth,
        sunElevation: camera.sunElevation,
        shadowStrength: camera.shadowStrength,
        highlightStrength: camera.highlightStrength,
        shadowLength: camera.shadowLength,
        zoom: camera.zoom
      },
      player: world.player ? {
        row: world.player.row,
        col: world.player.col,
        direction: world.player.direction
      } : null,
      params: world.params || null,
      tiles: (world.terrain || []).flatMap((rowTiles, y) =>
        rowTiles.map((tile, x) => buildCompactTileRecord(tile, x, y))
      )
    };

    if (!options.excludeMapImage) {
      payload.mapImage = {
        mimeType: "image/png",
        width: exportCanvas.width,
        height: exportCanvas.height,
        shape: "diamond",
        dataUrl: exportCanvas.toDataURL("image/png")
      };
    }

    return payload;
  }

  function exportMapData() {
    const filename = `map.js`;

    try {
      const payload = buildMapDataExportObject();
      if (!payload) {
        addLog(I18n && I18n.t ? I18n.t("logs.mapDataExportFailed") : "Map data export failed.", "Full map canvas not available.");
        return;
      }

      const scriptText = [
        "window.__SIMSOFT_IMPORTED_MAP_DATA__ = ",
        JSON.stringify(payload, null, 2),
        ";\n"
      ].join("");
      const blob = new Blob([scriptText], { type: "application/javascript;charset=utf-8" });
      triggerDownload(URL.createObjectURL(blob), filename, "logs.exportCompleted");
    } catch (error) {
      addLog(
        I18n && I18n.t ? I18n.t("logs.mapDataExportFailed") : "Map data export failed.",
        error && error.message ? error.message : String(error)
      );
    }
  }

  function getTileTypeMaskList() {
    const world = State.world || {};
    const known = ["grass", "dirt", "mountain", "lake", "river", "road", "forest", "settlement"];
    const found = new Set();
    for (const row of (world.terrain || [])) {
      for (const tile of (row || [])) {
        if (tile && typeof tile.type === "string" && tile.type) found.add(tile.type);
      }
    }
    return known.filter((type) => found.has(type) || known.includes(type));
  }

  function renderTileMaskCanvas(tileType) {
    const world = State.world || {};
    const sourceCanvas = buildSquareMapCanvas();
    if (!sourceCanvas) return null;
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const ctx = maskCanvas.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    const cellWidth = maskCanvas.width / Math.max(1, world.cols || 1);
    const cellHeight = maskCanvas.height / Math.max(1, world.rows || 1);
    ctx.fillStyle = "rgba(255,255,255,1)";
    for (let row = 0; row < (world.rows || 0); row++) {
      for (let col = 0; col < (world.cols || 0); col++) {
        const tile = world.terrain && world.terrain[row] ? world.terrain[row][col] : null;
        if (!tile || tile.type !== tileType) continue;
        ctx.fillRect(Math.round(col * cellWidth), Math.round(row * cellHeight), Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }

    const diamondCanvas = document.createElement("canvas");
    const padding = 2;
    const bboxWidth = Math.ceil((maskCanvas.width + maskCanvas.height) / Math.SQRT2) + padding * 2;
    diamondCanvas.width = bboxWidth;
    diamondCanvas.height = bboxWidth;
    const dctx = diamondCanvas.getContext("2d", { alpha: true });
    dctx.clearRect(0, 0, diamondCanvas.width, diamondCanvas.height);
    dctx.translate(diamondCanvas.width / 2, diamondCanvas.height / 2);
    dctx.rotate(Math.PI / 4);
    dctx.drawImage(maskCanvas, -maskCanvas.width / 2, -maskCanvas.height / 2);
    return diamondCanvas;
  }

  function crc32(bytes) {
    let crc = -1;
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crc32.table[i] = c >>> 0;
      }
    }
    for (let i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  function makeZip(entries) {
    const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
    const files = [];
    let localSize = 0;
    let centralSize = 0;
    for (const entry of entries) {
      const nameBytes = encoder ? encoder.encode(entry.name) : Uint8Array.from(Array.from(entry.name).map(ch => ch.charCodeAt(0) & 255));
      const data = entry.data;
      const crc = crc32(data);
      files.push({ nameBytes, data, crc, offset: localSize });
      localSize += 30 + nameBytes.length + data.length;
      centralSize += 46 + nameBytes.length;
    }
    const out = new Uint8Array(localSize + centralSize + 22);
    let ptr = 0;
    const w16 = v => { out[ptr++] = v & 255; out[ptr++] = (v >>> 8) & 255; };
    const w32 = v => { out[ptr++] = v & 255; out[ptr++] = (v >>> 8) & 255; out[ptr++] = (v >>> 16) & 255; out[ptr++] = (v >>> 24) & 255; };
    for (const f of files) {
      w32(0x04034b50); w16(20); w16(0); w16(0); w16(0); w16(0); w32(f.crc); w32(f.data.length); w32(f.data.length); w16(f.nameBytes.length); w16(0);
      out.set(f.nameBytes, ptr); ptr += f.nameBytes.length;
      out.set(f.data, ptr); ptr += f.data.length;
    }
    const centralOffset = ptr;
    for (const f of files) {
      w32(0x02014b50); w16(20); w16(20); w16(0); w16(0); w16(0); w16(0); w32(f.crc); w32(f.data.length); w32(f.data.length); w16(f.nameBytes.length); w16(0); w16(0); w16(0); w16(0); w32(0); w32(f.offset);
      out.set(f.nameBytes, ptr); ptr += f.nameBytes.length;
    }
    const centralLength = ptr - centralOffset;
    w32(0x06054b50); w16(0); w16(0); w16(files.length); w16(files.length); w32(centralLength); w32(centralOffset); w16(0);
    return new Blob([out], { type: "application/zip" });
  }

  function blobToUint8Array(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Blob could not be read."));
      reader.readAsArrayBuffer(blob);
    });
  }

  async function exportTileMasks() {
    try {
      const tileTypes = getTileTypeMaskList();
      const entries = [];
      for (const tileType of tileTypes) {
        const canvas = renderTileMaskCanvas(tileType);
        if (!canvas) continue;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) continue;
        const bytes = await blobToUint8Array(blob);
        entries.push({ name: `${tileType}.png`, data: bytes });
      }
      if (!entries.length) {
        addLog("Tile mask export failed.", "No tile masks could be generated.");
        return;
      }
      const zipBlob = makeZip(entries);
      triggerDownload(URL.createObjectURL(zipBlob), "tile-masks.zip", "logs.exportCompleted");
    } catch (error) {
      addLog("Tile mask export failed.", error && error.message ? error.message : String(error));
    }
  }
  const I18n = window.Game.I18n;

  function cacheDom() {
    const dom = State.dom;

    dom.canvas = document.getElementById("gameCanvas");
    dom.gl = dom.canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!dom.gl) throw new Error(I18n.t("webgl.notSupported"));

    dom.terrainShapeOverlay = document.getElementById("terrainShapeOverlay");
    if (!dom.terrainShapeOverlay) {
      const overlay = document.createElement("canvas");
      overlay.id = "terrainShapeOverlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2";
      overlay.style.display = "block";
      overlay.style.background = "transparent";
      const parent = dom.canvas.parentElement;
      if (parent) {
        parent.insertBefore(overlay, dom.canvas.nextSibling);
        dom.terrainShapeOverlay = overlay;
      }
    }
    dom.terrainShapeOverlayCtx = dom.terrainShapeOverlay
      ? dom.terrainShapeOverlay.getContext("2d", { alpha: true })
      : null;

    dom.minimap = document.getElementById("minimap");
    dom.miniCtx = dom.minimap.getContext("2d");

    dom.settingsModal = document.getElementById("settingsModal");
    dom.mainMenuBtn = document.getElementById("mainMenuBtn");
    dom.mainMenuDropdown = document.getElementById("mainMenuDropdown");
    dom.menuGithubBtn = document.getElementById("menuGithubBtn");
    dom.menuSaveBtn = document.getElementById("menuSaveBtn");
    dom.menuLoadBtn = document.getElementById("menuLoadBtn");
    dom.menuExportMasksBtn = document.getElementById("menuExportMasksBtn");
    dom.localMapFolderInput = document.getElementById("localMapFolderInput");
    dom.settingsBtn = document.getElementById("settingsBtn");
    dom.applySettingsBtn = document.getElementById("applySettingsBtn");
    dom.cancelSettingsBtn = document.getElementById("cancelSettingsBtn");

    dom.logModal = document.getElementById("logModal");
    dom.logBtn = document.getElementById("logBtn");
    dom.closeLogBtn = document.getElementById("closeLogBtn");
    dom.logText = document.getElementById("logText");

    dom.seedInput = document.getElementById("seedInput");
    dom.mapWidthInput = document.getElementById("mapWidthInput");
    dom.mapHeightInput = document.getElementById("mapHeightInput");
    dom.cameraPitchInput = document.getElementById("cameraPitchInput");
    dom.depthStrengthInput = document.getElementById("depthStrengthInput");
    dom.blendPixelSizeInput = document.getElementById("blendPixelSizeInput");
    dom.blendStrengthInput = document.getElementById("blendStrengthInput");
    dom.noiseGridDivisionsInput = document.getElementById("noiseGridDivisionsInput");
    dom.showGridInput = document.getElementById("showGridInput");
    dom.showTerrainWallsInput = document.getElementById("showTerrainWallsInput");
    dom.reliefEnabledInput = document.getElementById("reliefEnabledInput");
    dom.sunAzimuthInput = document.getElementById("sunAzimuthInput");
    dom.sunElevationInput = document.getElementById("sunElevationInput");
    dom.shadowStrengthInput = document.getElementById("shadowStrengthInput");
    dom.highlightStrengthInput = document.getElementById("highlightStrengthInput");
    dom.shadowLengthInput = document.getElementById("shadowLengthInput");

    dom.dialogText = document.getElementById("dialogText");
    dom.languageSelect = document.getElementById("languageSelect");
    dom.topLeftScroll = document.getElementById("topLeftScroll");
    dom.topMenuScrollLeft = document.getElementById("topMenuScrollLeft");
    dom.topMenuScrollRight = document.getElementById("topMenuScrollRight");
    dom.mobilePanelsToggle = document.getElementById("mobilePanelsToggle");
    dom.mobilePanelTabs = document.getElementById("mobilePanelTabs");

    dom.top.goldValue = document.getElementById("goldValue");
    dom.top.healthText = document.getElementById("healthText");
    dom.top.staminaText = document.getElementById("staminaText");
    dom.top.manaText = document.getElementById("manaText");
    dom.top.healthBar = document.getElementById("healthBar");
    dom.top.staminaBar = document.getElementById("staminaBar");
    dom.top.manaBar = document.getElementById("manaBar");

    dom.params.streams = document.getElementById("paramStreams");
    dom.params.lake = document.getElementById("paramLake");
    dom.params.hills = document.getElementById("paramHills");
    dom.params.hillArea = document.getElementById("paramHillArea");
    dom.params.roads = document.getElementById("paramRoads");
    dom.params.forest = document.getElementById("paramForest");
    dom.params.forestArea = document.getElementById("paramForestArea");
    dom.params.settlement = document.getElementById("paramSettlement");
    dom.params.grassArea = document.getElementById("paramGrassArea");
    dom.params.dirtArea = document.getElementById("paramDirtArea");
    dom.params.waterArea = document.getElementById("paramWaterArea");
    dom.params.stoneArea = document.getElementById("paramStoneArea");

    dom.textureInfo.directory = document.getElementById("textureDirectoryInput");
    dom.textureInfo.grass = document.getElementById("textureGrassInput");
    dom.textureInfo.dirt = document.getElementById("textureDirtInput");
    dom.textureInfo.forest = document.getElementById("textureForestInput");
    dom.textureInfo.lake = document.getElementById("textureLakeInput");
    dom.textureInfo.river = document.getElementById("textureRiverInput");
    dom.textureInfo.road = document.getElementById("textureRoadInput");
    dom.textureInfo.mountain = document.getElementById("textureMountainInput");
    dom.textureInfo.settlement = document.getElementById("textureSettlementInput");
    dom.loadingOverlay = document.getElementById("loadingOverlay");
  }

  function syncSettingsInputs() {
    const dom = State.dom;
    dom.seedInput.value = State.world.seed;
    dom.mapWidthInput.value = State.world.cols;
    dom.mapHeightInput.value = State.world.rows;
    dom.cameraPitchInput.value = State.camera.pitchAngle;
    dom.depthStrengthInput.value = State.camera.depthStrength;
    if (dom.blendPixelSizeInput) dom.blendPixelSizeInput.value = State.camera.blendPixelSize;
    if (dom.blendStrengthInput) dom.blendStrengthInput.value = State.camera.blendStrength;
    if (dom.noiseGridDivisionsInput) dom.noiseGridDivisionsInput.value = State.camera.noiseGridDivisions;
    if (dom.showGridInput) dom.showGridInput.checked = !!State.camera.showGrid;
    if (dom.showTerrainWallsInput) dom.showTerrainWallsInput.checked = !!State.camera.showTerrainWalls;
    if (dom.reliefEnabledInput) dom.reliefEnabledInput.checked = !!State.camera.reliefEnabled;
    if (dom.sunAzimuthInput) dom.sunAzimuthInput.value = State.camera.sunAzimuth;
    if (dom.sunElevationInput) dom.sunElevationInput.value = State.camera.sunElevation;
    if (dom.shadowStrengthInput) dom.shadowStrengthInput.value = State.camera.shadowStrength;
    if (dom.highlightStrengthInput) dom.highlightStrengthInput.value = State.camera.highlightStrength;
    if (dom.shadowLengthInput) dom.shadowLengthInput.value = State.camera.shadowLength;

    if (dom.textureInfo && window.Game && window.Game.Config) {
      const textureFiles = window.Game.Config.TEXTURE_FILES || {};
      if (dom.textureInfo.directory) dom.textureInfo.directory.value = window.Game.Config.TEXTURE_DIRECTORY || "textures";
      if (dom.textureInfo.grass) dom.textureInfo.grass.value = textureFiles.grass || "";
      if (dom.textureInfo.dirt) dom.textureInfo.dirt.value = textureFiles.dirt || "";
      if (dom.textureInfo.forest) dom.textureInfo.forest.value = textureFiles.forest || "";
      if (dom.textureInfo.lake) dom.textureInfo.lake.value = textureFiles.lake || "";
      if (dom.textureInfo.river) dom.textureInfo.river.value = textureFiles.river || "";
      if (dom.textureInfo.road) dom.textureInfo.road.value = textureFiles.road || "";
      if (dom.textureInfo.mountain) dom.textureInfo.mountain.value = textureFiles.mountain || "";
      if (dom.textureInfo.settlement) dom.textureInfo.settlement.value = textureFiles.settlement || "";
    }
  }

  function percent(value) { return I18n.t("paramValues.percent", { value }); }
  function exists(flag) { return flag ? I18n.t("paramValues.exists") : I18n.t("paramValues.notExists"); }

  function updateParamUI() {
    const p = State.world.params;
    if (!p) return;
    const params = State.dom.params;
    params.streams.value = String(p.streamCount);
    params.lake.value = exists(p.hasLake);
    params.hills.value = String(p.hillCount);
    params.hillArea.value = percent(p.actualHillCoverage);
    params.roads.value = String(p.roadCount);
    params.forest.value = exists(p.hasForest);
    params.forestArea.value = percent(p.actualForestCoverage);
    params.settlement.value = p.hasSettlement ? percent(p.actualSettlementCoverage) : I18n.t("paramValues.notExists");
    params.grassArea.value = percent(p.actualGrassCoverage);
    params.dirtArea.value = percent(p.actualDirtCoverage);
    params.waterArea.value = percent(p.actualWaterCoverage);
    params.stoneArea.value = percent(p.actualStoneCoverage);
  }

  function formatTime() {
    const now = new Date();
    const locale = State.i18n.current === "tr" ? "tr-TR" : "en-GB";
    return now.toLocaleTimeString(locale, { hour12: false });
  }

  function stringifyDetails(details) {
    if (details === undefined || details === null || details === "") return "";
    if (typeof details === "string") return details;
    try { return JSON.stringify(details, null, 2); } catch { return String(details); }
  }

  function renderLogs() {
    if (!State.dom.logText) return;
    State.dom.logText.value = State.log.lines.join("\n\n");
    State.dom.logText.scrollTop = State.dom.logText.scrollHeight;
  }

  function addLog(message, details) {
    const detailText = stringifyDetails(details);
    const line = detailText ? `[${formatTime()}] ${message}\n${detailText}` : `[${formatTime()}] ${message}`;
    State.log.lines.push(line);
    if (State.log.lines.length > State.log.maxLines) State.log.lines.shift();
    renderLogs();
  }

  function showLoading() {
    try {
      if (State.dom && State.dom.loadingOverlay) State.dom.loadingOverlay.classList.remove("hidden");
    } catch (e) {}
  }

  function hideLoading() {
    try {
      if (State.dom && State.dom.loadingOverlay) State.dom.loadingOverlay.classList.add("hidden");
    } catch (e) {}
  }


  function isMenuOpen() {
    return State.dom.mainMenuDropdown && !State.dom.mainMenuDropdown.classList.contains("hidden");
  }

  function positionMainMenuDropdown() {
    const dropdown = State.dom.mainMenuDropdown;
    const button = State.dom.mainMenuBtn;
    if (!dropdown || !button) return;

    const compactPortrait = window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
    if (!compactPortrait) {
      dropdown.classList.remove("dropdown-fixed");
      dropdown.style.top = "";
      dropdown.style.left = "";
      dropdown.style.width = "";
      dropdown.style.minWidth = "";
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const preferredWidth = Math.max(rect.width, 180);
    const maxAllowedWidth = Math.max(180, viewportWidth - 16);
    const width = Math.min(preferredWidth, maxAllowedWidth);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 8);

    dropdown.classList.add("dropdown-fixed");
    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.top = `${Math.round(top)}px`;
    dropdown.style.width = `${Math.round(width)}px`;
    dropdown.style.minWidth = `${Math.round(width)}px`;
  }

  function openMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    positionMainMenuDropdown();
    State.dom.mainMenuDropdown.classList.remove("hidden");
    if (State.dom.mainMenuBtn) State.dom.mainMenuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    State.dom.mainMenuDropdown.classList.add("hidden");
    State.dom.mainMenuDropdown.classList.remove("dropdown-fixed");
    State.dom.mainMenuDropdown.style.top = "";
    State.dom.mainMenuDropdown.style.left = "";
    State.dom.mainMenuDropdown.style.width = "";
    State.dom.mainMenuDropdown.style.minWidth = "";
    if (State.dom.mainMenuBtn) State.dom.mainMenuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMainMenu(forceState) {
    const shouldOpen = typeof forceState === "boolean" ? forceState : !isMenuOpen();
    if (shouldOpen) openMainMenu();
    else closeMainMenu();
  }

  function openSettingsModal() { syncSettingsInputs(); updateParamUI(); State.dom.settingsModal.classList.remove("hidden"); addLog(I18n.t("logs.settingsOpened")); }
  function closeSettingsModal() { State.dom.settingsModal.classList.add("hidden"); addLog(I18n.t("logs.settingsClosed")); }
  function openLogModal() { State.dom.logModal.classList.remove("hidden"); addLog(I18n.t("logs.logOpened")); }
  function closeLogModal() { State.dom.logModal.classList.add("hidden"); addLog(I18n.t("logs.logClosed")); }
  function updateDialogText(text) { State.dom.dialogText.textContent = text; syncDialogTextHeight(); }
  function applyCurrentLanguageToUI() { I18n.applyTranslations(); updateParamUI(); renderLogs(); syncDialogTextHeight(); updateMobilePanelsToggle(); }

  function bindChoiceButtons() {
    document.querySelectorAll(".choice-btn").forEach((btn, index) => {
      btn.addEventListener("click", () => {
        updateDialogText(I18n.t(btn.dataset.dialogKey));
        addLog(I18n.t("logs.dialogChoice", { choice: btn.textContent.trim() }));
        const top = State.dom.top;
        const stateChanges = [
          { gold: 12, health: 82, stamina: 64, mana: 54 },
          { gold: 5, health: 78, stamina: 70, mana: 49 },
          { gold: 3, health: 74, stamina: 60, mana: 58 },
          { gold: 0, health: 82, stamina: 75, mana: 57 }
        ][index];
        top.goldValue.textContent = Number(top.goldValue.textContent) + stateChanges.gold;
        top.healthText.textContent = stateChanges.health;
        top.staminaText.textContent = stateChanges.stamina;
        top.manaText.textContent = stateChanges.mana;
        top.healthBar.style.width = `${stateChanges.health}%`;
        top.staminaBar.style.width = `${stateChanges.stamina}%`;
        top.manaBar.style.width = `${stateChanges.mana}%`;
      });
    });
  }


  function updateTopMenuScrollButtons() {
    const scroller = State.dom.topLeftScroll;
    const left = State.dom.topMenuScrollLeft;
    const right = State.dom.topMenuScrollRight;
    if (!scroller || !left || !right) return;
    const compact = window.innerWidth <= 960;
    const hasOverflow = compact && scroller.scrollWidth > scroller.clientWidth + 8;
    left.classList.toggle("hidden", !hasOverflow || scroller.scrollLeft <= 6);
    right.classList.toggle("hidden", !hasOverflow || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 6);
  }

  function scrollTopMenu(direction) {
    const scroller = State.dom.topLeftScroll;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(120, scroller.clientWidth * 0.55), behavior: "smooth" });
    window.setTimeout(updateTopMenuScrollButtons, 220);
  }

  function bindTopMenuScroller() {
    const scroller = State.dom.topLeftScroll;
    if (!scroller) return;
    let dragging = false;
    let startX = 0;
    let startScroll = 0;

    const stopDragging = () => {
      dragging = false;
      scroller.classList.remove("dragging-scroll");
    };

    scroller.addEventListener("pointerdown", (event) => {
      if (window.innerWidth > 960) return;
      dragging = true;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.classList.add("dragging-scroll");
    });

    scroller.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      scroller.scrollLeft = startScroll - delta;
      updateTopMenuScrollButtons();
    });

    scroller.addEventListener("pointerup", stopDragging);
    scroller.addEventListener("pointercancel", stopDragging);
    scroller.addEventListener("pointerleave", stopDragging);
    scroller.addEventListener("scroll", updateTopMenuScrollButtons, { passive: true });

    if (State.dom.topMenuScrollLeft) State.dom.topMenuScrollLeft.addEventListener("click", () => scrollTopMenu(-1));
    if (State.dom.topMenuScrollRight) State.dom.topMenuScrollRight.addEventListener("click", () => scrollTopMenu(1));

    window.addEventListener("resize", updateTopMenuScrollButtons);
    window.setTimeout(updateTopMenuScrollButtons, 0);
  }

  function scrollToMobilePanels() {
    const tabs = State.dom.mobilePanelTabs;
    if (!tabs) return;
    tabs.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function isCompactPortraitLayout() {
    return window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
  }

  function syncDialogTextHeight() {
    const dialogText = State.dom.dialogText;
    if (!dialogText) return;

    if (!isCompactPortraitLayout()) {
      dialogText.style.height = "";
      dialogText.style.minHeight = "";
      return;
    }

    dialogText.style.height = "auto";
    dialogText.style.minHeight = "0px";
    const fullHeight = Math.ceil(dialogText.scrollHeight);
    dialogText.style.height = `${fullHeight}px`;
    dialogText.style.minHeight = `${fullHeight}px`;
  }

  function updateMobilePanelsToggle() {
    const toggle = State.dom.mobilePanelsToggle;
    const centerArea = document.getElementById("center-area");
    const tabs = State.dom.mobilePanelTabs;
    if (!toggle || !centerArea || !tabs) return;

    if (!isCompactPortraitLayout()) {
      toggle.textContent = "⌄";
      toggle.setAttribute("aria-label", "Open bottom panels");
      centerArea.classList.remove("panel-toggle-up");
      return;
    }

    const tabsRect = tabs.getBoundingClientRect();
    const hasScrolledDown = window.scrollY > 24;
    const tabsReachedViewport = tabsRect.top <= window.innerHeight - 120;
    const shouldPointUp = hasScrolledDown || tabsReachedViewport;
    toggle.textContent = shouldPointUp ? "⌃" : "⌄";
    toggle.setAttribute("aria-label", shouldPointUp ? "Scroll to top" : "Open bottom panels");
    centerArea.classList.toggle("panel-toggle-up", shouldPointUp);
  }

  function handleMobilePanelsToggle() {
    const shouldScrollUp = isCompactPortraitLayout() && window.scrollY > 24;
    if (shouldScrollUp) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollToMobilePanels();
  }

  function updateResponsiveLayout() {
    const app = document.getElementById("app");
    if (!app) return;
    const isCompact = window.innerWidth <= 960;
    const orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    app.dataset.viewport = isCompact ? "compact" : "desktop";
    app.dataset.orientation = orientation;
    app.dataset.mobilePanels = isCompact && orientation === "portrait" ? "below-fold" : "inline";
    updateTopMenuScrollButtons();
    syncDialogTextHeight();
    updateMobilePanelsToggle();
  }

  function setActiveMobilePanel(panelName) {
    const panels = document.querySelectorAll(".bottom-ribbon .panel[data-panel-name]");
    const tabs = document.querySelectorAll(".mobile-tab-btn[data-panel-target]");
    panels.forEach((panel) => panel.classList.toggle("active-panel", panel.dataset.panelName === panelName));
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panelTarget === panelName));
    if (window.Game.Minimap && panelName === "minimap-panel") {
      window.Game.Minimap.resizeMinimap();
      window.Game.Minimap.renderMinimap();
    }
    window.setTimeout(syncDialogTextHeight, 0);
  }

  function bindResponsivePanels() {
    document.querySelectorAll(".mobile-tab-btn[data-panel-target]").forEach((btn) => {
      btn.addEventListener("click", () => setActiveMobilePanel(btn.dataset.panelTarget));
    });
    if (State.dom.mobilePanelsToggle) {
      State.dom.mobilePanelsToggle.addEventListener("click", handleMobilePanelsToggle);
    }
    window.addEventListener("scroll", updateMobilePanelsToggle, { passive: true });
    bindTopMenuScroller();
    updateResponsiveLayout();
    window.setTimeout(syncDialogTextHeight, 0);
  }

  function bindUIEvents(onApplySettings, onLanguageChange) {
    const dom = State.dom;
    const handleMainMenuToggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMainMenu();
    };
    dom.mainMenuBtn.addEventListener("click", handleMainMenuToggle);
    dom.mainMenuBtn.addEventListener("mousedown", (event) => event.stopPropagation());
    dom.mainMenuBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    dom.mainMenuBtn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") handleMainMenuToggle(event);
    });
    dom.menuGithubBtn.addEventListener("click", () => {
      window.open("https://github.com/sgoxel/The-Advisor-Game", "_blank", "noopener,noreferrer");
      closeMainMenu();
    });
    dom.menuSaveBtn.addEventListener("click", () => {
      exportMapData();
      closeMainMenu();
    });
    dom.menuLoadBtn.addEventListener("click", () => {
      if (window.Game.App && typeof window.Game.App.promptLocalMapFolderSelection === "function") {
        window.Game.App.promptLocalMapFolderSelection();
      } else {
        addLog("Load action selected, but local folder loading is not ready.");
      }
      closeMainMenu();
    });
    if (dom.menuExportMasksBtn) {
      dom.menuExportMasksBtn.addEventListener("click", () => {
        exportTileMasks();
        closeMainMenu();
      });
    }

    const characterPanel = document.querySelector('.character-panel');
    const characterHeader = document.querySelector('.character-panel .panel-header');
    const recenterCharacter = (event) => {
      if (event) event.preventDefault();
      if (window.Game.Renderer) {
        window.Game.Renderer.centerCamera();
        window.Game.Renderer.markDirty();
      }
      addLog('Character panel selected. Camera centered on player.');
    };
    if (characterPanel) {
      characterPanel.style.cursor = 'pointer';
      characterPanel.addEventListener('click', recenterCharacter);
    }
    if (characterHeader) {
      characterHeader.addEventListener('click', (event) => {
        event.stopPropagation();
        recenterCharacter(event);
      });
    }
    document.addEventListener("click", (event) => {
      if (!dom.mainMenuDropdown || dom.mainMenuDropdown.classList.contains("hidden")) return;
      if (dom.mainMenuDropdown.contains(event.target) || dom.mainMenuBtn.contains(event.target)) return;
      closeMainMenu();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!dom.mainMenuDropdown || dom.mainMenuDropdown.classList.contains("hidden")) return;
      if (dom.mainMenuDropdown.contains(event.target) || dom.mainMenuBtn.contains(event.target)) return;
      closeMainMenu();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMainMenu();
    });
    window.addEventListener("resize", () => {
      if (isMenuOpen()) positionMainMenuDropdown();
    });
    window.addEventListener("orientationchange", () => {
      window.setTimeout(() => {
        if (isMenuOpen()) positionMainMenuDropdown();
      }, 30);
    });
    window.addEventListener("scroll", () => {
      if (isMenuOpen()) positionMainMenuDropdown();
    }, { passive: true });
    dom.settingsBtn.addEventListener("click", openSettingsModal);
    dom.cancelSettingsBtn.addEventListener("click", closeSettingsModal);
    dom.logBtn.addEventListener("click", openLogModal);
    dom.closeLogBtn.addEventListener("click", closeLogModal);
    dom.languageSelect.addEventListener("change", (event) => onLanguageChange(event.target.value));
    dom.settingsModal.addEventListener("click", (event) => { if (event.target === dom.settingsModal) closeSettingsModal(); });
    dom.logModal.addEventListener("click", (event) => { if (event.target === dom.logModal) closeLogModal(); });
    dom.applySettingsBtn.addEventListener("click", onApplySettings);
    if (dom.localMapFolderInput) {
      dom.localMapFolderInput.addEventListener("change", async (event) => {
        const files = event.target && event.target.files ? event.target.files : [];
        if (window.Game.App && typeof window.Game.App.registerLocalMapFiles === "function") {
          await window.Game.App.registerLocalMapFiles(files);
        }
      });
    }
    bindResponsivePanels();
  }

  window.Game.UI = {
    cacheDom,
    syncSettingsInputs,
    updateParamUI,
    openSettingsModal,
    closeSettingsModal,
    openLogModal,
    closeLogModal,
    addLog,
    bindUIEvents,
    updateDialogText,
    bindChoiceButtons,
    applyCurrentLanguageToUI,
    openMainMenu,
    closeMainMenu,
    toggleMainMenu,
    updateResponsiveLayout,
    setActiveMobilePanel,
    updateTopMenuScrollButtons,
    scrollToMobilePanels,
    syncDialogTextHeight,
    updateMobilePanelsToggle,
    showLoading,
    hideLoading
  };
})();
