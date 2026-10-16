import {
  nearbyCriticalSites,
  SITE_CORE_SOURCE_UNITS,
  SITE_FALLOFF_SOURCE_UNITS,
  SITE_SUPPORT_SOURCE_UNITS,
  type CriticalSite,
} from "./sites.ts";
import * as core from "./world-core.ts";
import { wrapSourceX } from "./planet.ts";
import { composeFinalSurface, WORLD_BUILDING_PRIORITIES, type FinalSurface, type SurfaceModifier } from "./final-surface.ts";

export * from "./world-core.ts";

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const boundedEarthwork = (desired: number, existing: number, maxCut: number, maxFill: number) =>
  Math.max(existing - maxCut, Math.min(existing + maxFill, desired));
const SITE_CACHE_LIMIT = 1024;
const siteSurfaceCache = new Map<string, FinalSurface>();
let siteSurfaceOverrides = 0;

function canonicalSiteModifiersAt(x: number, z: number, baseGroundHeight: number): SurfaceModifier[] {
  const modifiers: SurfaceModifier[] = [];
  for (const site of nearbyCriticalSites(x, z, SITE_SUPPORT_SOURCE_UNITS, 4)) {
    const distance = Math.hypot(wrapSourceX(x - site.x), z - site.z),
      weight = 1 - smooth(clamp01((distance - SITE_CORE_SOURCE_UNITS) / SITE_FALLOFF_SOURCE_UNITS));
    if (weight <= 0) continue;
    modifiers.push({
      id: site.code,
      priority: WORLD_BUILDING_PRIORITIES.site,
      weight,
      targetGroundHeight: boundedEarthwork(site.preparedGroundHeightM, baseGroundHeight, 3, 3),
      material: "Settlement",
      walkable: true,
      vegetationDensityScale: 0,
      reservedUse: site.code,
    });
  }
  return modifiers;
}

function siteCacheKey(x: number, z: number) {
  return `${core.GENERATOR_VERSION}/${x}/${z}`;
}

/**
 * Public final-surface authority. Priority-9 ownership is rebuilt from the
 * canonical site plan, while legacy representative site modifiers in the core
 * are discarded. Earlier priorities remain core behavior.
 */
export function finalSurfaceAt(x: number, z: number): FinalSurface {
  const key = siteCacheKey(x, z), cached = siteSurfaceCache.get(key);
  if (cached) return cached;
  const baseline = core.finalSurfaceAt(x, z),
    hasLegacySite = baseline.contributingModifierIds.some((id) => id.endsWith("/SITE/KEEP")),
    sites = nearbyCriticalSites(x, z, SITE_SUPPORT_SOURCE_UNITS, 4);
  if (!hasLegacySite && sites.length === 0) return baseline;

  const debug = core.finalSurfaceDebugAt(x, z),
    earlier = debug.modifiers.filter((modifier) => modifier.priority !== WORLD_BUILDING_PRIORITIES.site),
    canonical = canonicalSiteModifiersAt(x, z, debug.base.groundHeight),
    result = composeFinalSurface(debug.base, [...earlier, ...canonical]);
  siteSurfaceOverrides++;
  siteSurfaceCache.set(key, result);
  if (siteSurfaceCache.size > SITE_CACHE_LIMIT) siteSurfaceCache.delete(siteSurfaceCache.keys().next().value!);
  return result;
}

export function heightAt(x: number, z: number) {
  return finalSurfaceAt(x, z).groundHeight;
}
export function biomeAt(x: number, z: number) {
  return finalSurfaceAt(x, z).material;
}
export function cellAt(x: number, z: number): core.Cell {
  const base = core.cellAt(x, z),
    cx = Math.floor(x / core.CELL_SIZE), cz = Math.floor(z / core.CELL_SIZE),
    surface = finalSurfaceAt(cx * core.CELL_SIZE + 1, cz * core.CELL_SIZE + 1);
  return { ...base, elevation: surface.surfaceHeight, biome: surface.material, walkable: surface.walkable };
}
export function finalSurfaceDebugAt(x: number, z: number) {
  const debug = core.finalSurfaceDebugAt(x, z),
    earlier = debug.modifiers.filter((modifier) => modifier.priority !== WORLD_BUILDING_PRIORITIES.site),
    canonical = canonicalSiteModifiersAt(x, z, debug.base.groundHeight),
    modifiers = [...earlier, ...canonical];
  return { ...debug, modifiers, final: finalSurfaceAt(x, z), candidateCount: debug.candidateCount + canonical.length };
}
export function finalSurfaceTelemetry() {
  return { ...core.finalSurfaceTelemetry(), siteSurfaceOverrides, siteSurfaceCacheSize: siteSurfaceCache.size, siteSurfaceCacheLimit: SITE_CACHE_LIMIT };
}
export function resetFinalSurfaceTelemetry() {
  core.resetFinalSurfaceTelemetry();
  siteSurfaceOverrides = 0;
  siteSurfaceCache.clear();
}

function owns(tile: core.Tile, x: number, z: number) {
  return x >= tile.minX && x < tile.minX + tile.size && z >= tile.minZ && z < tile.minZ + tile.size;
}
function sitesNearTile(tile: core.Tile): readonly CriticalSite[] {
  if (tile.size > 256) return [];
  const centreX = tile.minX + tile.size / 2, centreZ = tile.minZ + tile.size / 2,
    radius = Math.SQRT2 * tile.size / 2 + SITE_SUPPORT_SOURCE_UNITS;
  return nearbyCriticalSites(centreX, centreZ, radius, 64);
}
function insideSiteReservation(x: number, z: number, sites: readonly CriticalSite[]) {
  return sites.some((site) => Math.hypot(wrapSourceX(x - site.x), z - site.z) <= SITE_SUPPORT_SOURCE_UNITS);
}
function physicalSiteFeatures(tile: core.Tile, sites: readonly CriticalSite[]): core.Feature[] {
  if (tile.size > 128) return [];
  const features: core.Feature[] = [];
  for (const site of sites) {
    const push = (kind: core.Feature["kind"], x: number, z: number, variant: number, suffix: string) => {
      if (!owns(tile, x, z)) return;
      const surface = finalSurfaceAt(x, z);
      if (surface.water.kind !== "none" || !surface.walkable || surface.reservedUse !== site.code) return;
      features.push({ kind, x, z, y: surface.groundHeight, variant, code: `${core.WORLD_SEED}/${core.GENERATOR_VERSION}/F/${site.code}/${suffix}` });
    };
    if (site.kind === "ruin") {
      push("keep", site.x, site.z, site.variant, "ruin-core");
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 + ((site.variant >>> 5) % 13) * 0.01,
          rubbleRadius = 6 + (i % 2) * 2;
        push("rock", site.x + Math.cos(angle) * rubbleRadius, site.z + Math.sin(angle) * rubbleRadius, site.variant + i + 1, `ruin-debris/${i}`);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, ringRadius = 5.5;
        push("rock", site.x + Math.cos(angle) * ringRadius, site.z + Math.sin(angle) * ringRadius, site.variant + i, `stone-ring/${i}`);
      }
      push("well", site.x, site.z, site.variant, "oathstone");
    }
  }
  return features;
}

/** Settlement keeps stay settlement geometry; lower-priority geometry cannot occupy a site reservation. */
export function featuresFor(tile: core.Tile): core.Feature[] {
  const sites = sitesNearTile(tile),
    inherited = sites.length
      ? core.featuresFor(tile).filter((feature) => !insideSiteReservation(feature.x, feature.z, sites))
      : core.featuresFor(tile);
  return [...inherited, ...physicalSiteFeatures(tile, sites)];
}
