/**
 * Blender-made 3D assets (src/models/*.glb, built by tools/blender/build_yard_assets.py).
 *
 * A tiny binary-glTF reader turns each asset into flat triangles with one colour per material, in
 * asset-local metres (+Y up, front = +Z, origin = footprint centre on the ground). Tile builders copy
 * those triangles into their close-up layer exactly like the procedural kits. Assets are loaded once
 * per worker before it reports ready; a tile built without an asset falls back to the procedural kit.
 */
export type AssetMesh = {
  /** x, y, z per vertex, metres. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** One 0-255 RGB colour per triangle. */
  colors: Uint8Array;
  triangles: number;
};

/** Asset name → source file (resolved by the bundler, so it also works under the Pages base path). */
export const ASSET_URLS: Record<string, string> = {
  cart: new URL("./models/cart.glb", import.meta.url).href,
  woodpile: new URL("./models/woodpile.glb", import.meta.url).href,
  barrels: new URL("./models/barrels.glb", import.meta.url).href,
  barrels_v2: new URL("./models/barrels_v2.glb", import.meta.url).href,
};

const registry = new Map<string, AssetMesh>();
const variantCache = new Map<string, AssetMesh[]>();
export const assetMesh = (name: string) => registry.get(name);
export const registerAssetMesh = (name: string, mesh: AssetMesh) => { registry.set(name, mesh); variantCache.clear(); };
/** Base name of an asset: "barrels_v2" → "barrels". */
export const assetBaseName = (name: string) => name.replace(/_v\d+$/, "");
/** Every loaded model of one kind ("barrels", "barrels_v2", …) in a fixed (name) order. */
export function assetVariants(kind: string): AssetMesh[] {
  let list = variantCache.get(kind);
  if (!list) {
    list = [...registry.keys()].filter((name) => assetBaseName(name) === kind).sort().map((name) => registry.get(name)!);
    variantCache.set(kind, list);
  }
  return list;
}
/** The model a SEED variant picks for this kind, or undefined when none is loaded. */
export function assetFor(kind: string, variant: number): AssetMesh | undefined {
  const list = assetVariants(kind);
  return list.length ? list[(variant >>> 0) % list.length] : undefined;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Parse a .glb (glTF 2.0 binary) into one merged, flat-coloured triangle mesh. */
export function parseGlb(buffer: ArrayBuffer): AssetMesh {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a glb file");
  let offset = 12, json: any, bin: ArrayBuffer | undefined;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === 0x004e4942) bin = buffer.slice(start, start + length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error("glb without JSON or BIN chunk");
  const read = (index: number) => {
    const accessor = json.accessors[index], bufferView = json.bufferViews[accessor.bufferView],
      count = accessor.count * COMPONENTS[accessor.type], byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    switch (accessor.componentType) {
      case 5126: return new Float32Array(bin!, byteOffset, count);
      case 5125: return new Uint32Array(bin!, byteOffset, count);
      case 5123: return new Uint16Array(bin!, byteOffset, count);
      case 5121: return new Uint8Array(bin!, byteOffset, count);
      default: throw new Error(`Unsupported accessor component type ${accessor.componentType}`);
    }
  };
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4) continue;
    const base = positions.length / 3, position = read(primitive.attributes.POSITION),
      list = primitive.indices === undefined ? Array.from({ length: position.length / 3 }, (_, i) => i) : read(primitive.indices),
      factor = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor ?? [.8, .8, .8, 1],
      rgb = [0, 1, 2].map((k) => Math.round(Math.max(0, Math.min(1, factor[k])) * 255));
    for (let i = 0; i < position.length; i++) positions.push(position[i]);
    for (let i = 0; i < list.length; i += 3) { indices.push(base + list[i], base + list[i + 1], base + list[i + 2]); colors.push(...rgb); }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Uint8Array(colors), triangles: indices.length / 3 };
}

/** Load every asset once; failures are reported and leave the procedural fallback in place. */
export async function loadAssetMeshes(readBytes: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url).then((response) => {
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.arrayBuffer();
})) {
  const failed: string[] = [];
  await Promise.all(Object.entries(ASSET_URLS).map(async ([name, url]) => {
    try { registerAssetMesh(name, parseGlb(await readBytes(url))); } catch (error) { failed.push(`${name}: ${String(error)}`); }
  }));
  if (failed.length && typeof console !== "undefined") console.warn(`3D assets not loaded (procedural fallback): ${failed.join("; ")}`);
  return { loaded: registry.size, failed };
}
