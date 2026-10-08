import { readFileSync, writeFileSync } from "node:fs";

const path = "src/main.ts";
let source = readFileSync(path, "utf8");
const sentinel = "WP-S002-003-003 runtime streaming budgets";
if (source.includes(sentinel)) process.exit(0);

function replaceRequired(search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Patch target not found: ${label}`);
  source = next;
}

replaceRequired(
  '} from "./navigation.ts";\n\n/** Canonical 1/2500 globe-dominant anchor, converted through the temporary S001 presentation adapter. */',
  `} from "./navigation.ts";\nimport {\n  estimateGeometryBytes,\n  streamingBudgetForViewport,\n  withinStreamingBudget,\n  type StreamingBudget,\n} from "./streaming.ts";\n\n/** ${sentinel}. */\n/** Canonical 1/2500 globe-dominant anchor, converted through the temporary S001 presentation adapter. */`,
  "streaming import",
);

replaceRequired(
  `const tileCache = new Map<\n  string,\n  { tile: Tile; entity: pc.Entity; meshes: pc.Mesh[]; used: number }\n>();\nlet revision = 0,\n  inFlight = 0,\n  residentLimit = 200,\n  selectionDirty = true;\nconst pending = new Set<string>();`,
  `type CachedTile = {\n  tile: Tile;\n  entity: pc.Entity;\n  meshes: pc.Mesh[];\n  used: number;\n  bytes: number;\n};\nconst tileCache = new Map<string, CachedTile>();\nlet revision = 0,\n  inFlight = 0,\n  selectionDirty = true,\n  cacheHits = 0,\n  cacheMisses = 0,\n  evictions = 0,\n  cachedGeometryBytes = 0,\n  uploadsThisFrame = 0,\n  maxUploadsPerFrame = 0,\n  poleStopCount = 0;\nlet streamingBudget: StreamingBudget = streamingBudgetForViewport(\n  innerWidth,\n  innerHeight,\n);\nlet poleLimit: "north" | "south" | null = null,\n  poleLimitUntil = 0;\nconst previousWantedKeys = new Set<string>();\nconst pending = new Set<string>();`,
  "cache state",
);

replaceRequired(
  `  selectionDirty = true;\n}\nfunction updateCamera() {\n  desiredProjectionTransition = projectionTransitionForHalfHeight(`,
  `}\nfunction updateCamera() {\n  selectionDirty = true;\n  desiredProjectionTransition = projectionTransitionForHalfHeight(`,
  "selection invalidation",
);

replaceRequired(
  `    if (!parallel && Math.abs(latitude) > Math.PI / 2)\n      flat.z = latitude > 0 ? -POLE_DISTANCE : POLE_DISTANCE;\n    navigate(flat.x, flat.z);`,
  `    if (!parallel && Math.abs(latitude) > Math.PI / 2) {\n      notePoleLimit(latitude > 0 ? "north" : "south");\n      flat.z = latitude > 0 ? -POLE_DISTANCE : POLE_DISTANCE;\n    }\n    navigate(flat.x, flat.z);`,
  "pan pole feedback",
);

replaceRequired(
  `function navigate(x: number, z: number, height = view.halfHeight) {\n  view.halfHeight = Math.max(`,
  `function notePoleLimit(side: "north" | "south") {\n  poleLimit = side;\n  poleLimitUntil = performance.now() + 1600;\n  poleStopCount++;\n}\nfunction navigate(x: number, z: number, height = view.halfHeight) {\n  view.halfHeight = Math.max(`,
  "pole helper",
);

replaceRequired(
  `  view.x = wrapX(x);\n  view.z = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));\n  rebaseRenderFrame();`,
  `  const boundedZ = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));\n  if (boundedZ !== z) notePoleLimit(z < -POLE_DISTANCE ? "north" : "south");\n  view.x = wrapX(x);\n  view.z = boundedZ;\n  rebaseRenderFrame();`,
  "navigate bounds",
);

replaceRequired(
  `function request(tile: Tile) {\n  if (tileCache.has(tile.key) || pending.has(tile.key)) return;\n  pending.add(tile.key);\n  inFlight++;\n  worker.postMessage(tile);\n}`,
  `function request(tile: Tile) {\n  if (tileCache.has(tile.key) || pending.has(tile.key)) return;\n  if (inFlight + uploads.length >= streamingBudget.generationReady) return;\n  pending.add(tile.key);\n  inFlight++;\n  worker.postMessage(tile);\n}`,
  "bounded request queue",
);

replaceRequired(
  `function refreshSelection() {\n  wanted = selectTiles(view);\n  revision++;`,
  `function refreshSelection() {\n  wanted = selectTiles(view, 190, streamingBudget.activePatches);\n  const nextWantedKeys = new Set(wanted.map((tile) => tile.key));\n  for (const tile of wanted)\n    if (!previousWantedKeys.has(tile.key)) {\n      if (tileCache.has(tile.key)) cacheHits++;\n      else cacheMisses++;\n    }\n  previousWantedKeys.clear();\n  for (const key of nextWantedKeys) previousWantedKeys.add(key);\n  revision++;`,
  "selection budget and cache counters",
);

replaceRequired(
  `function processStreaming(material: pc.StandardMaterial) {\n  if (selectionDirty) refreshSelection();\n  // At most one GPU mesh group per frame. Generation is isolated in a worker.\n  const next = uploads.shift();\n  if (next) {\n    const entity = new pc.Entity(next.tile.key),`,
  `function processStreaming(material: pc.StandardMaterial) {\n  uploadsThisFrame = 0;\n  if (selectionDirty) refreshSelection();\n  // At most one GPU mesh group per frame. Generation is isolated in a worker.\n  const next = uploads.shift();\n  if (next) {\n    const bytes = estimateGeometryBytes(next.data);\n    const entity = new pc.Entity(next.tile.key),`,
  "upload accounting start",
);

replaceRequired(
  `    tileCache.set(next.tile.key, {\n      tile: next.tile,\n      entity,\n      meshes,\n      used: revision,\n    });`,
  `    tileCache.set(next.tile.key, {\n      tile: next.tile,\n      entity,\n      meshes,\n      used: revision,\n      bytes,\n    });\n    cachedGeometryBytes += bytes;\n    uploadsThisFrame = 1;\n    maxUploadsPerFrame = Math.max(maxUploadsPerFrame, uploadsThisFrame);`,
  "cache byte accounting",
);

source = source.replaceAll(
  "if (inFlight + uploads.length < 3) request(root);",
  "if (inFlight + uploads.length < streamingBudget.generationReady) request(root);",
);
source = source.replaceAll(
  "if (inFlight + uploads.length >= 3) break;",
  "if (inFlight + uploads.length >= streamingBudget.generationReady) break;",
);

replaceRequired(
  `    if (tileCache.size > residentLimit) {\n      const protect = new Set([\n        ...activeKeys,\n        ...wanted.map((t) => t.key),\n        root.key,\n      ]);\n      const obsolete = [...tileCache.entries()]\n        .filter(([key]) => !protect.has(key))\n        .sort((a, b) => a[1].used - b[1].used);\n      for (const [key, record] of obsolete) {\n        if (tileCache.size <= residentLimit) break;\n        // MeshInstance destruction releases its mesh reference and GPU buffers.\n        record.entity.destroy();\n        tileCache.delete(key);\n      }\n    }`,
  `    const overCacheBudget = () =>\n      tileCache.size > streamingBudget.cachedPatches ||\n      cachedGeometryBytes > streamingBudget.cpuBytes ||\n      cachedGeometryBytes > streamingBudget.gpuBytes;\n    if (overCacheBudget()) {\n      const protect = new Set([\n        ...activeKeys,\n        ...wanted.map((t) => t.key),\n        root.key,\n      ]);\n      const obsolete = [...tileCache.entries()]\n        .filter(([key]) => !protect.has(key))\n        .sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]));\n      for (const [key, record] of obsolete) {\n        if (!overCacheBudget()) break;\n        // MeshInstance destruction releases its mesh reference and GPU buffers.\n        record.entity.destroy();\n        tileCache.delete(key);\n        cachedGeometryBytes = Math.max(0, cachedGeometryBytes - record.bytes);\n        evictions++;\n      }\n    }`,
  "eviction budget",
);

replaceRequired(
  `  $("tile-status").textContent =\n    projectionTransition >= 0.999\n      ? \`Globe · \${globePass < GLOBE_PASSES.length ? "refining" : "ready"}\`\n      : projectionTransition > 0.001\n        ? \`Handoff · \${Math.round(projectionTransition * 100)}% · \${pending.size ? "preparing terrain" : "ready"}\`\n        : \`\${activeKeys.length || 1} tiles · \${pending.size ? "refining" : "ready"}\`;`,
  `  const poleFeedback =\n    poleLimit && performance.now() < poleLimitUntil\n      ? \` · \${poleLimit === "north" ? "North" : "South"} pole limit\`\n      : "";\n  $("tile-status").textContent =\n    (projectionTransition >= 0.999\n      ? \`Globe · \${globePass < GLOBE_PASSES.length ? "refining" : "ready"}\`\n      : projectionTransition > 0.001\n        ? \`Handoff · \${Math.round(projectionTransition * 100)}% · \${pending.size ? "preparing terrain" : "ready"}\`\n        : \`\${activeKeys.length || 1} tiles · \${pending.size ? "refining" : "ready"}\`) +\n    poleFeedback;`,
  "pole status",
);

replaceRequired(
  `    view.pixels = Math.min(innerHeight, 1000);\n    if (projectionTransition > 0.001)`,
  `    view.pixels = Math.min(innerHeight, 1000);\n    streamingBudget = streamingBudgetForViewport(innerWidth, innerHeight);\n    if (projectionTransition > 0.001)`,
  "resize budget",
);

replaceRequired(
  `        setFocus(lon: number, lat: number) {\n          const p = lonLatToFlat(lon, lat);\n          navigate(p.x, p.z);\n        },`,
  `        setFocus(lon: number, lat: number) {\n          if (lat > Math.PI / 2) notePoleLimit("north");\n          else if (lat < -Math.PI / 2) notePoleLimit("south");\n          const p = lonLatToFlat(lon, lat);\n          navigate(p.x, p.z);\n        },`,
  "diagnostic pole setFocus",
);

replaceRequired(
  `            selectedCanonicalId: selectedCode || null,\n          },`,
  `            selectedCanonicalId: selectedCode || null,\n            poleLimit: {\n              side: poleLimit,\n              active: Boolean(poleLimit && performance.now() < poleLimitUntil),\n              stops: poleStopCount,\n            },\n          },`,
  "pole telemetry",
);

replaceRequired(
  `              : handoffPreparationWaitMs;\n        return {`,
  `              : handoffPreparationWaitMs,\n          readyGeometryBytes = uploads.reduce(\n            (sum, upload) => sum + estimateGeometryBytes(upload.data),\n            0,\n          );\n        return {`,
  "ready byte telemetry",
);

replaceRequired(
  `            outstandingGeneration: pending.size + uploads.length + inFlight,`,
  `            outstandingGeneration: inFlight + uploads.length,`,
  "handoff queue accounting",
);

replaceRequired(
  `          view: { ...view },\n          fps,`,
  `          performance: {\n            backend: device.deviceType,\n            deviceClass: streamingBudget.deviceClass,\n            budget: { ...streamingBudget },\n            activePatches: activeKeys.length,\n            preparedPatches: uploads.length,\n            cachedPatches: tileCache.size,\n            pendingGeneration: inFlight,\n            readyUploads: uploads.length,\n            generationReady: inFlight + uploads.length,\n            cacheHits,\n            cacheMisses,\n            evictions,\n            cpuResourceBytesEstimated: cachedGeometryBytes + readyGeometryBytes,\n            gpuResourceBytesEstimated: cachedGeometryBytes,\n            uploadsThisFrame,\n            maxUploadsPerFrame,\n            canonicalKeysUnique: new Set(activeKeys).size === activeKeys.length,\n            activeCanonicalKeys: [...activeKeys],\n            wantedCanonicalKeys: wanted.map((tile) => tile.key),\n            poleStops: poleStopCount,\n            withinBudget: withinStreamingBudget(\n              {\n                generationReady: inFlight + uploads.length,\n                activePatches: activeKeys.length,\n                cachedPatches: tileCache.size,\n                cpuBytes: cachedGeometryBytes + readyGeometryBytes,\n                gpuBytes: cachedGeometryBytes,\n              },\n              streamingBudget,\n            ),\n          },\n          view: { ...view },\n          fps,`,
  "streaming performance telemetry",
);

writeFileSync(path, source);
