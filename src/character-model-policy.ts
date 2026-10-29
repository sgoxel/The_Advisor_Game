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

/** A container can have render components but no drawable mesh primitives.
 * Never hide the resident's 2D illustration for a zero-geometry owner GLB.
 * This is a presentation-only check; it does not affect Simulation identity. */
export function characterMeshHasGeometry(parts: readonly { mesh?: { primitive?: readonly { count: number }[] } | null }[]): boolean {
  return parts.some(part => part.mesh?.primitive?.some(primitive =>
    Number.isFinite(primitive.count) && primitive.count > 0));
}

/** Only genuinely renderable, visible owner meshes may replace an actor's 2D art.
 * A valid GLB can contain disabled nodes, render components or mesh instances.
 * Nothing here may decide character identity or Simulation positions. */
export function characterDrawableMeshes<T extends {
  visible?: boolean;
  mesh?: { primitive?: readonly { count: number }[] } | null;
}>(components: readonly {
  enabled: boolean;
  entity: { enabled: boolean };
  meshInstances: readonly T[];
}[]): T[] {
  const drawable: T[] = [];
  for (const component of components) {
    if (!component.enabled || !component.entity.enabled) continue;
    for (const part of component.meshInstances) {
      if (part.visible !== false && characterMeshHasGeometry([part]))
        drawable.push(part);
    }
  }
  return drawable;
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
