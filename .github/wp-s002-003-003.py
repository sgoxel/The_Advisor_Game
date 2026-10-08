from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"{path}: expected one match, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1))


Path("src/streaming.ts").write_text(r'''import type { TileGeometry } from "./geometry.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  canonicalCellId,
  sourceToLonLat,
} from "./planet.ts";
import type { Tile } from "./world.ts";

const MIB = 1024 * 1024;

export type StreamingDeviceClass = "phone" | "tablet" | "desktop";
export type StreamingBudget = {
  queue: number;
  active: number;
  cached: number;
  cpuBytes: number;
  gpuBytes: number;
};

/** Root-contract budgets from docs/PLANET_ARCHITECTURE.md §11.2. */
export const STREAMING_BUDGETS: Readonly<Record<StreamingDeviceClass, StreamingBudget>> =
  Object.freeze({
    phone: Object.freeze({
      queue: 4,
      active: 160,
      cached: 180,
      cpuBytes: 96 * MIB,
      gpuBytes: 96 * MIB,
    }),
    tablet: Object.freeze({
      queue: 6,
      active: 220,
      cached: 240,
      cpuBytes: 160 * MIB,
      gpuBytes: 160 * MIB,
    }),
    desktop: Object.freeze({
      queue: 8,
      active: 260,
      cached: 320,
      cpuBytes: 256 * MIB,
      gpuBytes: 256 * MIB,
    }),
  });

/** Presentation/device policy only; it never changes world identity or values. */
export function classifyStreamingDevice(width: number, height: number): StreamingDeviceClass {
  const shortSide = Math.min(width, height);
  if (shortSide <= 480) return "phone";
  if (shortSide <= 900) return "tablet";
  return "desktop";
}

/** Stable cube-sphere cache identity independent of longitude-wrap representation. */
export function canonicalStreamTileKey(tile: Tile): string {
  const legalMinZ = Math.max(tile.minZ, -SOURCE_PRESENTATION_POLE_DISTANCE),
    legalMaxZ = Math.min(tile.minZ + tile.size, SOURCE_PRESENTATION_POLE_DISTANCE),
    sampleZ = (legalMinZ + legalMaxZ) / 2,
    sampleX = tile.minX + tile.size / 2,
    { lon, lat } = sourceToLonLat(sampleX, sampleZ);
  return `${canonicalCellId(lon, lat, 24)}/STREAM/L${tile.level}`;
}

export type GeometryByteEstimate = { cpuBytes: number; gpuBytes: number };

/** Explicit conservative app-owned geometry estimate for both CPU and GPU residency. */
export function estimateTileGeometryBytes(data: TileGeometry): GeometryByteEstimate {
  let bytes = 0;
  for (const geometry of Object.values(data))
    bytes +=
      geometry.positions.byteLength +
      geometry.normals.byteLength +
      geometry.colors.byteLength +
      geometry.indices.byteLength;
  return { cpuBytes: bytes, gpuBytes: bytes };
}

export function withinStreamingBudget(
  budget: StreamingBudget,
  active: number,
  cached: number,
  queue: number,
  cpuBytes: number,
  gpuBytes: number,
): boolean {
  return (
    active <= budget.active &&
    cached <= budget.cached &&
    queue <= budget.queue &&
    cpuBytes <= budget.cpuBytes &&
    gpuBytes <= budget.gpuBytes
  );
}
''')

replace_once(
    "src/world.ts",
    '''import {
  continentalEnvelope,
  nearestPlace,
  places,
  roadAt,
} from "./geography.ts";
export { WORLD_SEED } from "./config.ts";''',
    '''import {
  continentalEnvelope,
  nearestPlace,
  places,
  roadAt,
} from "./geography.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_WIDTH,
} from "./planet.ts";
export { WORLD_SEED } from "./config.ts";''',
)

replace_once(
    "src/world.ts",
    '''export function selectTiles(view: View, threshold = 190): Tile[] {
  const { rx, rz } = viewBounds(view),
    selected: Tile[] = [];
  const visit = (t: Tile) => {
    if (
      t.minX > view.x + rx ||
      t.minX + t.size < view.x - rx ||
      t.minZ > view.z + rz ||
      t.minZ + t.size < view.z - rz
    )
      return;
    const projectedPixels = (t.size * view.pixels) / (view.halfHeight * 2);
    if (t.level < MAX_LEVEL && projectedPixels > threshold) {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++)
          visit(tileAt(t.level + 1, t.x * 2 + dx, t.z * 2 + dz));
    } else selected.push(t);
  };
  visit(tileAt(0, 0, 0));
  if (selected.length > 160) return selectTiles(view, threshold * 1.25);
  return selected.sort(
    (a, b) =>
      Math.hypot(a.minX + a.size / 2 - view.x, a.minZ + a.size / 2 - view.z) -
      Math.hypot(b.minX + b.size / 2 - view.x, b.minZ + b.size / 2 - view.z),
  );
}''',
    '''/** Signed shortest source-domain east/west delta on the canonical wrap. */
export function wrappedSourceDelta(fromX: number, toX: number): number {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  return (
    ((((toX - fromX + half) % SOURCE_PRESENTATION_WIDTH) +
      SOURCE_PRESENTATION_WIDTH) %
      SOURCE_PRESENTATION_WIDTH) -
    half
  );
}

export function selectTiles(view: View, threshold = 190, maxTiles = 160): Tile[] {
  const { rx, rz } = viewBounds(view),
    selected: Tile[] = [];
  const visit = (t: Tile) => {
    const maxZ = t.minZ + t.size;
    if (
      maxZ <= -SOURCE_PRESENTATION_POLE_DISTANCE ||
      t.minZ >= SOURCE_PRESENTATION_POLE_DISTANCE
    )
      return;
    const centreX = t.minX + t.size / 2,
      crossesPole =
        (t.minZ < -SOURCE_PRESENTATION_POLE_DISTANCE &&
          maxZ > -SOURCE_PRESENTATION_POLE_DISTANCE) ||
        (t.minZ < SOURCE_PRESENTATION_POLE_DISTANCE &&
          maxZ > SOURCE_PRESENTATION_POLE_DISTANCE);
    if (
      Math.abs(wrappedSourceDelta(view.x, centreX)) > rx + t.size / 2 ||
      t.minZ > view.z + rz ||
      maxZ < view.z - rz
    )
      return;
    const projectedPixels = (t.size * view.pixels) / (view.halfHeight * 2);
    if (t.level < MAX_LEVEL && (crossesPole || projectedPixels > threshold)) {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++)
          visit(tileAt(t.level + 1, t.x * 2 + dx, t.z * 2 + dz));
    } else selected.push(t);
  };
  visit(tileAt(0, 0, 0));
  if (selected.length > maxTiles)
    return selectTiles(view, threshold * 1.25, maxTiles);
  return selected.sort(
    (a, b) =>
      Math.hypot(
        wrappedSourceDelta(view.x, a.minX + a.size / 2),
        a.minZ + a.size / 2 - view.z,
      ) -
      Math.hypot(
        wrappedSourceDelta(view.x, b.minX + b.size / 2),
        b.minZ + b.size / 2 - view.z,
      ),
  );
}''',
)

replace_once(
    "src/main.ts",
    '''import {
  coordinateLabel,
  distanceLabel,
  draggedFocus,
  parallelDragFocus,
  surfaceDistance,
  placeLabels,
  type Rect,
} from "./navigation.ts";
''',
    '''import {
  coordinateLabel,
  distanceLabel,
  draggedFocus,
  parallelDragFocus,
  surfaceDistance,
  placeLabels,
  type Rect,
} from "./navigation.ts";
import {
  STREAMING_BUDGETS,
  canonicalStreamTileKey,
  classifyStreamingDevice,
  estimateTileGeometryBytes,
} from "./streaming.ts";
''',
)

replace_once(
    "src/main.ts",
    '''const tileCache = new Map<
  string,
  { tile: Tile; entity: pc.Entity; meshes: pc.Mesh[]; used: number }
>();
let revision = 0,
  inFlight = 0,
  residentLimit = 200,
  selectionDirty = true;
const pending = new Set<string>();
const uploads: {
  tile: Tile;
  data: TileGeometry;
  precision: PatchConversionStats;
}[] = [];''',
    '''const tileCache = new Map<
  string,
  {
    tile: Tile;
    entity: pc.Entity;
    meshes: pc.Mesh[];
    used: number;
    cpuBytes: number;
    gpuBytes: number;
  }
>();
let revision = 0,
  inFlight = 0,
  selectionDirty = true,
  cacheCpuBytes = 0,
  cacheGpuBytes = 0,
  cacheHits = 0,
  cacheMisses = 0,
  evictions = 0,
  uploadsTotal = 0,
  uploadsThisFrame = 0,
  maxUploadsPerFrameObserved = 0;
const streamingClass = classifyStreamingDevice(innerWidth, innerHeight),
  streamingBudget = STREAMING_BUDGETS[streamingClass];
let poleLimit: "north" | "south" | null = null;
const pending = new Set<string>();
const uploads: {
  tile: Tile;
  data: TileGeometry;
  precision: PatchConversionStats;
  bytes: { cpuBytes: number; gpuBytes: number };
}[] = [];''',
)

replace_once(
    "src/main.ts",
    '''    wanted.length > 0 &&
    wanted.every((tile) => tileCache.has(tile.key))''',
    '''    wanted.length > 0 &&
    wanted.every((tile) => tileCache.has(canonicalStreamTileKey(tile)))''',
)

replace_once(
    "src/main.ts",
    '''  view.x = wrapX(x);
  view.z = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));''',
    '''  poleLimit =
    z <= -POLE_DISTANCE
      ? "north"
      : z >= POLE_DISTANCE
        ? "south"
        : null;
  view.x = wrapX(x);
  view.z = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));''',
)

replace_once(
    "src/main.ts",
    '''function request(tile: Tile) {
  if (tileCache.has(tile.key) || pending.has(tile.key)) return;
  pending.add(tile.key);
  inFlight++;
  worker.postMessage(tile);
}
function refreshSelection() {
  wanted = selectTiles(view);''',
    '''function request(tile: Tile) {
  const key = canonicalStreamTileKey(tile);
  if (tileCache.has(key)) {
    cacheHits++;
    return;
  }
  if (pending.has(key) || pending.size >= streamingBudget.queue) return;
  cacheMisses++;
  pending.add(key);
  inFlight++;
  worker.postMessage(tile);
}
function refreshSelection() {
  wanted = selectTiles(view, 190, streamingBudget.active);''',
)

replace_once(
    "src/main.ts",
    '''function processStreaming(material: pc.StandardMaterial) {
  if (selectionDirty) refreshSelection();
  // At most one GPU mesh group per frame. Generation is isolated in a worker.
  const next = uploads.shift();
  if (next) {
    const entity = new pc.Entity(next.tile.key),
      meshes: pc.Mesh[] = [];
    for (const [name, g] of Object.entries(next.data)) {
      const mesh = uploadGeometry(g, entity, name, material);
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    applyTileRenderTransform(next.tile, entity);
    flatRoot.addChild(entity);
    tileCache.set(next.tile.key, {
      tile: next.tile,
      entity,
      meshes,
      used: revision,
    });
    if (next.tile.size <= 512) {
      detailedMaxHorizontalM = Math.max(
        detailedMaxHorizontalM,
        next.precision.maxHorizontalM,
      );
      detailedMaxFloat32ErrorM = Math.max(
        detailedMaxFloat32ErrorM,
        next.precision.maxFloat32ErrorM,
      );
    }
    pending.delete(next.tile.key);
  }
  const root = tileAt(0, 0, 0);
  if (!tileCache.has(root.key)) {
    if (inFlight + uploads.length < 3) request(root);
  } else {
    const complete = wanted.every((tile) => tileCache.has(tile.key));
    if (complete) {
      const newKeys = wanted.map((t) => t.key),
        active = new Set(newKeys);
      for (const [key, record] of tileCache) {
        record.entity.enabled = active.has(key);
        if (active.has(key)) record.used = revision;
      }
      activeKeys = newKeys;
      if (!ready) {
        ready = true;
        $("loading").classList.add("done");
      }
    } else {
      // Keep the previous coverage and coarse root until the replacement is complete.
      tileCache.get(root.key)!.entity.enabled = true;
      if (!ready && tileCache.size > 1) $("loading").classList.add("done");
      for (const tile of wanted) {
        if (inFlight + uploads.length >= 3) break;
        request(tile);
      }
    }
    if (tileCache.size > residentLimit) {
      const protect = new Set([
        ...activeKeys,
        ...wanted.map((t) => t.key),
        root.key,
      ]);
      const obsolete = [...tileCache.entries()]
        .filter(([key]) => !protect.has(key))
        .sort((a, b) => a[1].used - b[1].used);
      for (const [key, record] of obsolete) {
        if (tileCache.size <= residentLimit) break;
        // MeshInstance destruction releases its mesh reference and GPU buffers.
        record.entity.destroy();
        tileCache.delete(key);
      }
    }
  }
  $("tile-status").textContent =
    projectionTransition >= 0.999
      ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
      : projectionTransition > 0.001
        ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${pending.size ? "preparing terrain" : "ready"}`
        : `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`;
}''',
    '''function ensureCacheCapacity(
  protect: Set<string>,
  reserve: { cpuBytes: number; gpuBytes: number },
  reserveEntries: number,
): boolean {
  const overBudget = () =>
    tileCache.size + reserveEntries > streamingBudget.cached ||
    cacheCpuBytes + reserve.cpuBytes > streamingBudget.cpuBytes ||
    cacheGpuBytes + reserve.gpuBytes > streamingBudget.gpuBytes;
  if (!overBudget()) return true;
  const obsolete = [...tileCache.entries()]
    .filter(([key]) => !protect.has(key))
    .sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]));
  for (const [key, record] of obsolete) {
    if (!overBudget()) break;
    record.entity.destroy();
    tileCache.delete(key);
    cacheCpuBytes = Math.max(0, cacheCpuBytes - record.cpuBytes);
    cacheGpuBytes = Math.max(0, cacheGpuBytes - record.gpuBytes);
    evictions++;
  }
  return !overBudget();
}
function processStreaming(material: pc.StandardMaterial) {
  uploadsThisFrame = 0;
  if (selectionDirty) refreshSelection();
  const root = tileAt(0, 0, 0),
    rootKey = canonicalStreamTileKey(root),
    wantedKeys = wanted.map(canonicalStreamTileKey),
    protect = new Set([...activeKeys, ...wantedKeys, rootKey]),
    readyCpuBytes = uploads.reduce((sum, upload) => sum + upload.bytes.cpuBytes, 0);
  ensureCacheCapacity(protect, { cpuBytes: readyCpuBytes, gpuBytes: 0 }, 0);
  const next = uploads[0];
  if (
    next &&
    ensureCacheCapacity(
      new Set([...protect, canonicalStreamTileKey(next.tile)]),
      { cpuBytes: readyCpuBytes, gpuBytes: next.bytes.gpuBytes },
      1,
    )
  ) {
    uploads.shift();
    const key = canonicalStreamTileKey(next.tile),
      entity = new pc.Entity(key),
      meshes: pc.Mesh[] = [];
    for (const [name, g] of Object.entries(next.data)) {
      const mesh = uploadGeometry(g, entity, name, material);
      if (mesh) meshes.push(mesh);
    }
    entity.enabled = false;
    applyTileRenderTransform(next.tile, entity);
    flatRoot.addChild(entity);
    tileCache.set(key, {
      tile: next.tile,
      entity,
      meshes,
      used: revision,
      cpuBytes: next.bytes.cpuBytes,
      gpuBytes: next.bytes.gpuBytes,
    });
    cacheCpuBytes += next.bytes.cpuBytes;
    cacheGpuBytes += next.bytes.gpuBytes;
    uploadsThisFrame = 1;
    uploadsTotal++;
    maxUploadsPerFrameObserved = Math.max(maxUploadsPerFrameObserved, uploadsThisFrame);
    if (next.tile.size <= 512) {
      detailedMaxHorizontalM = Math.max(
        detailedMaxHorizontalM,
        next.precision.maxHorizontalM,
      );
      detailedMaxFloat32ErrorM = Math.max(
        detailedMaxFloat32ErrorM,
        next.precision.maxFloat32ErrorM,
      );
    }
    pending.delete(key);
  }
  if (!tileCache.has(rootKey)) {
    request(root);
  } else {
    const complete = wantedKeys.every((key) => tileCache.has(key));
    if (complete) {
      const newKeys = wantedKeys,
        active = new Set(newKeys);
      for (const [key, record] of tileCache) {
        record.entity.enabled = active.has(key);
        if (active.has(key)) record.used = revision;
      }
      activeKeys = newKeys;
      if (!ready) {
        ready = true;
        $("loading").classList.add("done");
      }
    } else {
      tileCache.get(rootKey)!.entity.enabled = true;
      if (!ready && tileCache.size > 1) $("loading").classList.add("done");
      for (const tile of wanted) request(tile);
    }
    ensureCacheCapacity(protect, { cpuBytes: readyCpuBytes, gpuBytes: 0 }, 0);
  }
  const baseStatus =
    projectionTransition >= 0.999
      ? `Globe · ${globePass < GLOBE_PASSES.length ? "refining" : "ready"}`
      : projectionTransition > 0.001
        ? `Handoff · ${Math.round(projectionTransition * 100)}% · ${pending.size ? "preparing terrain" : "ready"}`
        : `${activeKeys.length || 1} tiles · ${pending.size ? "refining" : "ready"}`;
  $("tile-status").textContent =
    baseStatus +
    (poleLimit
      ? ` · ${poleLimit === "north" ? "North" : "South"} pole limit`
      : "");
}''',
)

replace_once(
    "src/main.ts",
    '''  worker.onmessage = (event) => {
    inFlight--;
    if (event.data.error) {
      pending.delete(event.data.tile.key);
      fail(`Tile generation failed: ${event.data.error}`);
      return;
    }
    uploads.push(event.data);
  };''',
    '''  worker.onmessage = (event) => {
    inFlight--;
    const key = canonicalStreamTileKey(event.data.tile);
    if (event.data.error) {
      pending.delete(key);
      fail(`Tile generation failed: ${event.data.error}`);
      return;
    }
    uploads.push({
      ...event.data,
      bytes: estimateTileGeometryBytes(event.data.data),
    });
  };''',
)

replace_once(
    "src/main.ts",
    '''          navigation: {
            focus: flatToLonLat(view.x, view.z),
            heading: -view.yaw || 0,
            ruler: { ...rulerState },
            labels: labelState,
            selectedCanonicalId: selectedCode || null,
          },
          renderFrame: {''',
    '''          navigation: {
            focus: flatToLonLat(view.x, view.z),
            heading: -view.yaw || 0,
            ruler: { ...rulerState },
            labels: labelState,
            selectedCanonicalId: selectedCode || null,
            poleLimit,
          },
          streaming: {
            deviceClass: streamingClass,
            budget: { ...streamingBudget },
            activePatches: activeKeys.length,
            cachedPatches: tileCache.size,
            pendingGeneration: inFlight,
            readyUploads: uploads.length,
            generationReadyQueue: pending.size,
            cacheHits,
            cacheMisses,
            evictions,
            uploadsTotal,
            uploadsThisFrame,
            maxUploadsPerFrameObserved,
            cpuResourceBytesEstimated:
              cacheCpuBytes +
              uploads.reduce((sum, upload) => sum + upload.bytes.cpuBytes, 0),
            gpuResourceBytesEstimated: cacheGpuBytes,
            activeCanonicalKeys: [...activeKeys],
            wantedCanonicalKeys: wanted.map(canonicalStreamTileKey),
          },
          renderFrame: {''',
)

replace_once(
    "src/main.ts",
    '''            !selectionDirty &&
            pending.size === 0 &&
            activeKeys.length === wanted.length &&
            activeKeys.every((key) => wanted.some((t) => t.key === key)),''',
    '''            !selectionDirty &&
            pending.size === 0 &&
            uploads.length === 0 &&
            inFlight === 0 &&
            activeKeys.length === wanted.length &&
            activeKeys.every((key) =>
              wanted.some((t) => canonicalStreamTileKey(t) === key),
            ),''',
)
