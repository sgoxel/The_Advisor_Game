/**
 * Canonical final-surface composition contract (WP-S003-001-001).
 *
 * The composer is intentionally independent from streaming/rendering. Callers
 * provide canonical base channels and bounded modifiers; this module applies the
 * owner 0-9 priority order with stable same-priority identity ordering.
 */
export const WORLD_BUILDING_PRIORITIES = {
  ocean: 0,
  continent: 1,
  island: 2,
  naturalTerrain: 3,
  hydrology: 4,
  country: 5,
  city: 6,
  village: 7,
  road: 8,
  site: 9,
} as const;

export type SurfacePriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SurfaceMaterial =
  | "Ocean"
  | "Lake"
  | "River"
  | "Riverbank"
  | "Sandy beach"
  | "Volcanic highlands"
  | "Highlands"
  | "Island meadow"
  | "Woodland"
  | "Meadow"
  | "Settlement"
  | "Road"
  | "Bridge";
export type SurfaceTraversal = "blocked" | "bridge" | "road" | "difficult" | "open";

export type SurfaceWater = {
  kind: "none" | "ocean" | "lake" | "river";
  level: number;
  flowX: number;
  flowZ: number;
};

export type SurfaceBase = {
  groundHeight: number;
  material: SurfaceMaterial;
  water: SurfaceWater;
  walkable: boolean;
  vegetationDensityScale: number;
  reservedUse: string | null;
};

export type SurfaceModifier = {
  id: string;
  priority: SurfacePriority;
  weight?: number;
  targetGroundHeight?: number;
  material?: SurfaceMaterial;
  walkable?: boolean;
  /** Compatibility mask: intersecting exclusions union by taking the minimum. */
  vegetationDensityScale?: number;
  reservedUse?: string | null;
  /** A deck is traversal/render surface above preserved water/ground. */
  deckHeight?: number;
};

export type FinalSurface = SurfaceBase & {
  surfaceHeight: number;
  /** Ground material remains inspectable even when a bridge deck is the top surface. */
  groundMaterial: SurfaceMaterial;
  /** Highest-priority modifier that actually chose exposed ground material. */
  groundMaterialOwnerId: string | null;
  deckHeight: number | null;
  /** Only canonical modifiers providing the highest actual traversed deck. */
  deckOwnerIds: readonly string[];
  deckMaterial: "Bridge" | null;
  traversal: SurfaceTraversal;
  contributingModifierIds: readonly string[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function compareSurfaceModifiers(a: SurfaceModifier, b: SurfaceModifier) {
  return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * A canonical modifier identity may be returned by more than one bounded query
 * bucket (for example at a wrapped/support boundary), but it must never apply
 * twice. Exact semantic duplicates collapse to one record. Conflicting records
 * with the same canonical ID are an authority error and fail deterministically
 * instead of making insertion/query order decide the world.
 */
function surfaceModifierSignature(modifier: SurfaceModifier) {
  return JSON.stringify({
    priority: modifier.priority,
    weight: clamp01(modifier.weight ?? 1),
    hasTargetGroundHeight: modifier.targetGroundHeight !== undefined,
    targetGroundHeight: modifier.targetGroundHeight ?? null,
    hasMaterial: modifier.material !== undefined,
    material: modifier.material ?? null,
    hasWalkable: modifier.walkable !== undefined,
    walkable: modifier.walkable ?? null,
    hasVegetationDensityScale: modifier.vegetationDensityScale !== undefined,
    vegetationDensityScale:
      modifier.vegetationDensityScale === undefined
        ? null
        : clamp01(modifier.vegetationDensityScale),
    hasReservedUse: modifier.reservedUse !== undefined,
    reservedUse: modifier.reservedUse ?? null,
    hasDeckHeight: modifier.deckHeight !== undefined,
    deckHeight: modifier.deckHeight ?? null,
  });
}

function canonicalSurfaceModifiers(modifiers: readonly SurfaceModifier[]) {
  // With zero or one owner there is no duplicate identity to reconcile and
  // no priority/tie order to determine. The original JSON signatures,
  // Map and sort change no output in these frequent first-use metre probes.
  // Keep the full canonical-conflict check for every multi-owner point.
  if (modifiers.length <= 1) return modifiers;
  const unique = new Map<string, { modifier: SurfaceModifier; signature: string }>();
  for (const modifier of modifiers) {
    const signature = surfaceModifierSignature(modifier),
      existing = unique.get(modifier.id);
    if (!existing) {
      unique.set(modifier.id, { modifier, signature });
      continue;
    }
    if (existing.signature !== signature)
      throw new Error(`Conflicting canonical surface modifier identity: ${modifier.id}`);
  }
  return [...unique.values()].map(({ modifier }) => modifier).sort(compareSurfaceModifiers);
}

/**
 * Compose one canonical coordinate. Water is never erased by later earthworks;
 * a legal crossing uses an explicit deck channel instead. This prevents a road
 * or settlement pad from silently painting dry terrain over hydrology.
 */
export function composeFinalSurface(
  base: SurfaceBase,
  modifiers: readonly SurfaceModifier[],
): FinalSurface {
  let groundHeight = base.groundHeight,
    groundMaterial = base.material,
    groundMaterialOwnerId: string | null = null,
    walkable = base.walkable,
    vegetationDensityScale = clamp01(base.vegetationDensityScale),
    reservedUse = base.reservedUse,
    deckHeight: number | null = null,
    deckOwnerIds: string[] = [];
  const contributingModifierIds: string[] = [];

  for (const modifier of canonicalSurfaceModifiers(modifiers)) {
    const weight = clamp01(modifier.weight ?? 1);
    if (weight <= 0) continue;
    contributingModifierIds.push(modifier.id);

    // Natural water is priority 4 and remains authoritative. Priority 6-9
    // earthworks can grade exposed ground, but may cross water only by deck.
    if (modifier.targetGroundHeight !== undefined && base.water.kind === "none")
      groundHeight = lerp(groundHeight, modifier.targetGroundHeight, weight);

    if (modifier.deckHeight !== undefined) {
      if (deckHeight === null || modifier.deckHeight > deckHeight) {
        deckHeight = modifier.deckHeight;
        deckOwnerIds = [modifier.id];
      } else if (modifier.deckHeight === deckHeight) deckOwnerIds.push(modifier.id);
    }

    if (modifier.material && weight >= 0.5 && base.water.kind === "none") {
      groundMaterial = modifier.material;
      groundMaterialOwnerId = modifier.id;
    }
    if (modifier.walkable !== undefined && weight >= 0.5) walkable = modifier.walkable;
    if (modifier.vegetationDensityScale !== undefined)
      vegetationDensityScale = Math.min(
        vegetationDensityScale,
        clamp01(modifier.vegetationDensityScale),
      );
    if (modifier.reservedUse !== undefined && weight >= 0.5)
      reservedUse = modifier.reservedUse;
  }

  if (base.water.kind !== "none" && deckHeight === null) walkable = false;
  if (deckHeight !== null) {
    walkable = true;
    vegetationDensityScale = 0;
  }

  const material: SurfaceMaterial = deckHeight !== null ? "Bridge" : groundMaterial,
    traversal: SurfaceTraversal = !walkable
      ? "blocked"
      : deckHeight !== null
        ? "bridge"
        : groundMaterial === "Road"
          ? "road"
          : groundMaterial === "Highlands" || groundMaterial === "Volcanic highlands"
            ? "difficult"
            : "open";

  return {
    groundHeight,
    surfaceHeight: deckHeight ?? groundHeight,
    material,
    groundMaterial,
    groundMaterialOwnerId,
    deckHeight,
    deckOwnerIds: Object.freeze(deckOwnerIds),
    deckMaterial: deckHeight === null ? null : "Bridge",
    water: base.water,
    walkable,
    traversal,
    vegetationDensityScale,
    reservedUse,
    contributingModifierIds,
  };
}
