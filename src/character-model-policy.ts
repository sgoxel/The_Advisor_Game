import { CHARACTER_TYPES } from "./characters.ts";

/** Optional owner-supplied GLB models; 2D artwork is always the fallback. */
const GLB_FILENAME = /^[a-z][a-z0-9_-]*\.glb$/;
export type CharacterModelManifest = Readonly<Record<string, string>>;

export function characterModelManifest(value: unknown): CharacterModelManifest {
  const names: Record<string, string> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return names;
  for (const [type, file] of Object.entries(value)) {
    if (Object.hasOwn(CHARACTER_TYPES, type) &&
        typeof file === "string" && GLB_FILENAME.test(file))
      names[type] = file;
  }
  return names;
}

/** An absent model cannot suppress an existing 2D character. */
export function characterModelFile(key: string, manifest: CharacterModelManifest): string | null {
  return Object.hasOwn(CHARACTER_TYPES, key) && Object.hasOwn(manifest, key)
    ? manifest[key] : null;
}

export type CharacterVisualFormat = "2d-cutout" | "3d-model";

export function characterVisualFormat(usableModel: boolean): CharacterVisualFormat {
  return usableModel ? "3d-model" : "2d-cutout";
}

/** A pooled visual belongs to one SEED resident, not merely one image type.
 * Reassignment of a same-type resident must restart stale asynchronous art or
 * optional model work, while repeated frames of the SAME resident do not. */
export function sameCharacterAssignment(
  previous: { name: string; residentCode: string } | undefined,
  name: string,
  residentCode: string,
): boolean {
  return previous?.name === name && previous.residentCode === residentCode;
}

/** Line/point-only owner GLBs cannot displace a person's original 2D art.
 * PlayCanvas 2.23 topology: 0–3 points/lines, 4 triangles, 5 triangle strip,
 * 6 triangle fan. Missing type retains the triangle default of test meshes.
 * This is presentation eligibility, never authoritative Simulation collision. */
export function characterMeshHasGeometry(parts: readonly { mesh?: {
  primitive?: readonly { count: number; type?: number }[]
} | null }[]): boolean {
  return parts.some(part => part.mesh?.primitive?.some(primitive =>
    Number.isInteger(primitive.count) && primitive.count >= 3 &&
    (primitive.type === undefined || primitive.type === 4 ||
      primitive.type === 5 || primitive.type === 6)));
}

/** A child with enabled=true is still hidden if an authored GLB parent is
 * disabled. PlayCanvas GraphNode.enabled is local, not hierarchy-effective. */
type CharacterHierarchyNode = { enabled: boolean; parent?: CharacterHierarchyNode | null };
function characterNodeEnabled(node: CharacterHierarchyNode): boolean {
  for (let current: CharacterHierarchyNode | null = node; current; current = current.parent ?? null)
    if (!current.enabled) return false;
  return true;
}

/** Only genuinely renderable, visible owner meshes may replace an actor's 2D art.
 * A valid GLB can contain disabled nodes, render components, mesh instances
 * or authored materials with no visible opacity. Never hide the 2D resident
 * for an entirely transparent model. Rendering is presentation-only. */
export function characterDrawableMeshes<T extends {
  visible?: boolean;
  material?: unknown;
  mesh?: { primitive?: readonly { count: number; type?: number }[] } | null;
}>(components: readonly {
  enabled: boolean;
  entity: CharacterHierarchyNode;
  meshInstances: readonly T[];
}[], opaqueBlendType?: number): T[] {
  const drawable: T[] = [];
  for (const component of components) {
    if (!component.enabled || !characterNodeEnabled(component.entity)) continue;
    for (const part of component.meshInstances) {
      // Imported glTF standard materials express full transparency with
      // opacity=0. A hidden mesh still has primitives and positive bounds,
      // but must never displace the original illustrated resident.
      const material = part.material;
      const opacity = material && typeof material === "object" && "opacity" in material
        ? material.opacity : undefined;
      // glTF alphaMode=OPAQUE ignores authored alpha even if its base color
      // contains zero. Only reject fully transparent *blended or masked*
      // materials; an otherwise opaque GLB must still be allowed.
      const alphaMat = material && typeof material === "object" ? material as {
        transparent?: boolean; alphaTest?: number; blendType?: number;
      } : null;
      // Imported PlayCanvas glTF StandardMaterials expose blendType, not a
      // public transparent flag. Use runtime's actual BLEND_NONE enum value.
      const usesAlpha = alphaMat?.transparent === true || (alphaMat?.alphaTest ?? 0) > 0 ||
        (opaqueBlendType !== undefined && typeof alphaMat?.blendType === "number" &&
          alphaMat.blendType !== opaqueBlendType);
      if (usesAlpha && typeof opacity === "number" &&
          (!Number.isFinite(opacity) || opacity <= 0)) continue;
      if (part.visible !== false && characterMeshHasGeometry([part]))
        drawable.push(part);
    }
  }
  return drawable;
}

/** Compute the neutral parent's foot alignment from staged world-space
 * AABBs, which already include every authored GLB node/root transform.
 * Apply this to a NEW parent, never overwrite the imported GLB's own scale.
 * Returns null for corrupt/nonfinite/flat geometry so 2D art stays visible. */
export function characterModelFootPlacement(
  parts: readonly { aabb: { center: { x: number; y: number; z: number };
    halfExtents: { x: number; y: number; z: number } } }[],
  nominalHeightM: number,
): { scale: number; x: number; y: number; z: number } | null {
  if (!parts.length || !Number.isFinite(nominalHeightM) || nominalHeightM <= 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const { center: c, halfExtents: h } = part.aabb;
    if (![c.x, c.y, c.z, h.x, h.y, h.z].every(Number.isFinite) ||
        h.x < 0 || h.y < 0 || h.z < 0) return null;
    minX = Math.min(minX, c.x - h.x); maxX = Math.max(maxX, c.x + h.x);
    minY = Math.min(minY, c.y - h.y); maxY = Math.max(maxY, c.y + h.y);
    minZ = Math.min(minZ, c.z - h.z); maxZ = Math.max(maxZ, c.z + h.z);
  }
  const height = maxY - minY;
  // Imported triangle records can describe a zero-area vertical line.
  // It has height but no visible face and must never hide the original 2D
  // resident. Allow planar GLB silhouettes (one horizontal axis can be flat).
  if (!Number.isFinite(height) || height <= 0 ||
      (maxX <= minX && maxZ <= minZ)) return null;
  const scale = nominalHeightM / height;
  const x = -(minX + maxX) * scale / 2;
  const y = -minY * scale;
  const z = -(minZ + maxZ) * scale / 2;
  return [scale, x, y, z].every(Number.isFinite) && scale > 0
    ? { scale, x, y, z } : null;
}

/** Re-check an already attached optional GLB: renderer/scene changes can
 * disable its root or all drawable components after initial validation.
 * A resident must immediately revert to their original 2D presentation. */
export function characterModelRenderable<T extends {
  visible?: boolean;
  material?: unknown;
  mesh?: { primitive?: readonly { count: number; type?: number }[] } | null;
}>(root: CharacterHierarchyNode, components: readonly {
  enabled: boolean;
  entity: CharacterHierarchyNode;
  meshInstances: readonly T[];
}[], opaqueBlendType?: number): boolean {
  return characterNodeEnabled(root) && characterDrawableMeshes(components, opaqueBlendType).length > 0;
}

/** A once-validated optional model may cease to render after device/scene
 * changes. Restore 2D now, and let the next normal resident assignment retry
 * the already-shared owner asset instead of permanently pinning this actor to
 * the failed model. Do not retry from the render loop: invalidating the
 * assignment only on actual loss prevents unbounded per-frame reloads. */
export function characterModelVisibleOrInvalidate<T extends object, M extends {
  visible?: boolean;
  material?: unknown;
  mesh?: { primitive?: readonly { count: number; type?: number }[] } | null;
}>(
  actor: T,
  root: CharacterHierarchyNode,
  components: readonly {
    enabled: boolean;
    entity: CharacterHierarchyNode;
    meshInstances: readonly M[];
  }[],
  assigned: WeakMap<T, { name: string; residentCode: string }>,
  opaqueBlendType?: number,
): boolean {
  if (characterModelRenderable(root, components, opaqueBlendType)) return true;
  assigned.delete(actor);
  return false;
}

/** Reuse one texture/material promise per authored NPC illustration.
 * Missing specialist art resolves to the original shared default image,
 * including the default image's own proportions, without retrying every actor.
 * Only the fatal absence of the default itself remains retryable. */
export type SharedCharacterArtwork<T> = { name: string; value: T };
export function loadSharedCharacterArtwork<T>(
  name: string,
  cache: Map<string, Promise<SharedCharacterArtwork<T>>>,
  load: (name: string) => Promise<T>,
  defaultName = "default",
): Promise<SharedCharacterArtwork<T>> {
  const existing = cache.get(name);
  if (existing) return existing;
  const pending = load(name).then(value => ({ name, value })).catch(error => {
    if (name === defaultName) {
      cache.delete(name);
      throw error;
    }
    // A temporary failure of the shared default must not permanently poison
    // a specialist's cached promise. A future character request can recover.
    return loadSharedCharacterArtwork(defaultName, cache, load, defaultName).catch(fallbackError => {
      cache.delete(name);
      throw fallbackError;
    });
  });
  cache.set(name, pending);
  return pending;
}

/** Successful owner GLBs are shared across residents, while a transient
 * missing/corrupt/offline result is never retained as a permanent no-model
 * decision. All residents sharing one in-flight request still receive 2D
 * fallback on failure; a later resident may try again after recovery. */
export function loadSharedOwnerModel<T>(
  file: string,
  cache: Map<string, Promise<T | null>>,
  load: (file: string) => Promise<T | null>,
): Promise<T | null> {
  const existing = cache.get(file);
  if (existing) return existing;
  const pending = Promise.resolve().then(() => load(file));
  cache.set(file, pending);
  void pending.then(
    resource => {
      if (resource === null && cache.get(file) === pending) cache.delete(file);
    },
    () => {
      if (cache.get(file) === pending) cache.delete(file);
    },
  );
  return pending;
}

/** An optional model load is never allowed to fail resident presentation. */
export async function usableOwnerModel<T>(
  file: string | null,
  load: (filename: string) => Promise<T | null>,
): Promise<T | null> {
  if (!file) return null;
  try {
    return await load(file);
  } catch {
    return null;
  }
}
