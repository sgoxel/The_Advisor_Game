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
  vegetationDensityScale?: number;
  reservedUse?: string | null;
  /** A deck is traversal/render surface above preserved water/ground. */
  deckHeight?: number;
};

export type FinalSurface = SurfaceBase & {
  surfaceHeight: number;
  deckHeight: number | null;
  contributingModifierIds: readonly string[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function compareSurfaceModifiers(a: SurfaceModifier, b: SurfaceModifier) {
  return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
    material = base.material,
    walkable = base.walkable,
    vegetationDensityScale = clamp01(base.vegetationDensityScale),
    reservedUse = base.reservedUse,
    deckHeight: number | null = null;
  const contributingModifierIds: string[] = [];

  for (const modifier of [...modifiers].sort(compareSurfaceModifiers)) {
    const weight = clamp01(modifier.weight ?? 1);
    if (weight <= 0) continue;
    contributingModifierIds.push(modifier.id);

    // Natural water is priority 4 and remains authoritative. Priority 6-9
    // earthworks can grade exposed ground, but may cross water only by deck.
    if (modifier.targetGroundHeight !== undefined && base.water.kind === "none")
      groundHeight = lerp(groundHeight, modifier.targetGroundHeight, weight);

    if (modifier.deckHeight !== undefined)
      deckHeight = deckHeight === null ? modifier.deckHeight : Math.max(deckHeight, modifier.deckHeight);

    if (modifier.material && weight >= 0.5) material = modifier.material;
    if (modifier.walkable !== undefined && weight >= 0.5) walkable = modifier.walkable;
    if (modifier.vegetationDensityScale !== undefined)
      vegetationDensityScale = Math.min(
        vegetationDensityScale,
        lerp(1, clamp01(modifier.vegetationDensityScale), weight),
      );
    if (modifier.reservedUse !== undefined && weight >= 0.5)
      reservedUse = modifier.reservedUse;
  }

  if (base.water.kind !== "none" && deckHeight === null) walkable = false;
  if (deckHeight !== null) {
    walkable = true;
    material = "Bridge";
    vegetationDensityScale = 0;
  }

  return {
    groundHeight,
    surfaceHeight: deckHeight ?? groundHeight,
    deckHeight,
    material,
    water: base.water,
    walkable,
    vegetationDensityScale,
    reservedUse,
    contributingModifierIds,
  };
}
