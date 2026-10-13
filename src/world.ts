/** World authority. Pure coordinate functions; no RNG, mutable sequence or wall clock. */
import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  canonicalCellId,
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import { streamingBudgetForViewport } from "./streaming.ts";
import { nearestPlace, places, roads, type Place, type Road } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { continuityRoadRecipe } from "./continuity.ts";
import {
  WORLD_BUILDING_PRIORITIES,
  compareSurfaceModifiers,
  composeFinalSurface,
  type FinalSurface,
  type SurfaceBase,
  type SurfaceMaterial,
  type SurfaceModifier,
} from "./final-surface.ts";
export { WORLD_SEED } from "./config.ts";
export const GENERATOR_VERSION = WORLD_FOUNDATION_VERSION;
export const WORLD_SIZE = 262144;
export const WORLD_MIN = -WORLD_SIZE / 2;
export const CELL_SIZE = 2;
export const MAX_LEVEL = 17; // Finest render tile and logical cell are both 2 Ã— 2 source units.
export type Tile = {
  level: number;
  x: number;
  z: number;
  key: string;
  size: number;
  minX: number;
  minZ: number;
};
export type Feature = {
  kind: "house" | "keep" | "tree" | "rock" | "field" | "well";
  x: number;
  z: number;
  y: number;
  code: string;
  variant: number;
};
export type Cell = {
  code: string;
  x: number;
  z: number;
  elevation: number;
  biome: string;
  walkable: boolean;
  tile: string;
};
export type ProvinceSeed = {
  code: string;
  x: number;
  z: number;
  domain: "Mainland" | "Archipelago";
  elevationLimit: number;
};
export type RegionSeed = {
  code: string;
  x: number;
  z: number;
  landform: "Mainland" | "Island" | "Ocean" | "Lake";
  radius: number;
  elevationLimit: number;
  parent: ProvinceSeed;
};
export type DistrictSeed = {
  code: string;
  x: number;
  z: number;
  parent: RegionSeed;
  coastOffset: number;
  beachWidth: number;
};
export type PatchSeed = {
  code: string;
  x: number;
  z: number;
  parent: DistrictSeed;
  grain: number;
};

/** Stable integer coordinate digest. A content lookup, never a pseudorandom stream.
 * Digests can collide; coordinate-containing canonical codes are the actual identities. */
export function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export const SEED_VALUE = digest(`${WORLD_SEED}/${GENERATOR_VERSION}`);
/** Five nested source-detail levels. Macro landform authority lives above them. */
export function provinceSeed(cx: number, cz: number): ProvinceSeed {
  const x = Math.floor(cx / 1000),
    z = Math.floor(cz / 1000),
    code = `${WORLD_SEED}/${GENERATOR_VERSION}/L1/${x}/${z}`,
    macro = macroSampleAt(sourceToLonLat(x * 2000 + 1000, z * 2000 + 1000));
  return {
    code,
    x,
    z,
    domain: macro.domain === "Mainland" ? "Mainland" : "Archipelago",
    elevationLimit: 620,
  };
}
// Neighbouring samples almost always share a region: remember the last one built.
let lastRegion: RegionSeed | undefined;
export function regionSeed(cx: number, cz: number): RegionSeed {
  const x = Math.floor(cx / 100),
    z = Math.floor(cz / 100);
  if (lastRegion && lastRegion.x === x && lastRegion.z === z) return lastRegion;
  const parent = provinceSeed(cx, cz),
    code = `${parent.code}/L2/${x - parent.x * 10}/${z - parent.z * 10}`,
    macro = macroSampleAt(sourceToLonLat(x * 200 + 100, z * 200 + 100));
  return (lastRegion = {
    code,
    x,
    z,
    landform: macro.domain,
    // Retained only as source-detail metadata; it no longer controls island geometry.
    radius: 64 + (digest(code) % 12),
    elevationLimit:
      macro.domain === "Mainland" ? 620 : macro.domain === "Island" ? 180 : 0,
    parent,
  });
}
export function districtSeed(cx: number, cz: number): DistrictSeed {
  const parent = regionSeed(cx, cz),
    x = Math.floor(cx / 10) - parent.x * 10,
    z = Math.floor(cz / 10) - parent.z * 10;
  const code = `${parent.code}/L3/${x}/${z}`,
    value = digest(code);
  return {
    code,
    x,
    z,
    parent,
    coastOffset: (value % 13) - 6,
    beachWidth: 3 + ((value >>> 8) % 4),
  };
}
export function patchSeed(cx: number, cz: number): PatchSeed {
  const parent = districtSeed(cx, cz),
    x = Math.floor(cx / 2) - (parent.parent.x * 50 + parent.x * 5),
    z = Math.floor(cz / 2) - (parent.parent.z * 50 + parent.z * 5);
  const code = `${parent.code}/L4/${x}/${z}`;
  return { code, x, z, parent, grain: digest(code) % 5 };
}
export function cellSeed(cx: number, cz: number) {
  const parent = patchSeed(cx, cz),
    x = cx - Math.floor(cx / 2) * 2,
    z = cz - Math.floor(cz / 2) * 2;
  const code = `${parent.code}/L5/${x}/${z}`;
  return {
    code,
    x,
    z,
    parent,
    surface: (parent.grain + (digest(code) % 3)) % 5,
  };
}
/** Signed macro coast margin in source/render units. Positive is dry land. */
export function islandCoast(x: number, z: number, _region?: RegionSeed) {
  return macroSampleAt(sourceToLonLat(x, z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}
export function coordinateValue(x: number, z: number, layer: number): number {
  let n =
    SEED_VALUE ^
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(layer, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export function field(
  x: number,
  z: number,
  spacing: number,
  layer: number,
): number {
  const gx = Math.floor(x / spacing),
    gz = Math.floor(z / spacing);
  const tx = smooth(x / spacing - gx),
    tz = smooth(z / spacing - gz);
  const at = (a: number, b: number) =>
    (coordinateValue(a, b, layer) % 10001) / 10000;
  return lerp(
    lerp(at(gx, gz), at(gx + 1, gz), tx),
    lerp(at(gx, gz + 1), at(gx + 1, gz + 1), tx),
    tz,
  );
}
export function riverX(z: number): number {
  return 125 + 42 * Math.sin(z / 150) + 18 * Math.sin(z / 57);
}
export function settlement(
  sx: number,
  sz: number,
): { x: number; z: number; name: string } {
  const v = coordinateValue(sx, sz, 10);
  return {
    x: sx * 512,
    z: sz * 512,
    name:
      sx === 0 && sz === 0
        ? "Alderwick"
        : [
            "Briarford",
            "Greyhaven",
            "Oakmere",
            "Westwatch",
            "Ashbourne",
            "Thornfield",
          ][v % 6],
  };
}

/**
 * S003 composition needs one real graph-connected crossing before the dedicated
 * hydrology/network WPs exist. Both the creek and the road endpoints are immutable
 * SEED-derived inputs; no camera, query order or mutable RNG selects this site.
 * The creek is deliberately narrower than the binding 120 m rural bridge cap.
 */
export const RURAL_BRIDGE_MAX_LENGTH_M = 120;
const REPRESENTATIVE_BRIDGE_ROAD = roads[0];
type RoadSourcePoint = Readonly<{ x: number; z: number }>;

/**
 * WP-S003-002-001 runtime adapter: one representative rendered/traversable road
 * consumes the same canonical continuity recipe used by remote definition queries.
 * The later transport-network WP can migrate the rest of the road registry without
 * changing this feature identity or the shared-boundary contra²È="24€ôì)ô)•áÁ½ÉÐ™Õ¹Ñ¥½¸Ñ¥±•½ÉA½Í¥Ñ¥½¸¡àè¹Õµ‰•È°èè¹Õµ‰•È°±•Ù•°€ô5a}1Y0¤èQ¥±”ì(€¥˜€¡à€ð]=I1}5%8ñðà€øô€µ]=I1}5%8ñðè€ð]=I1}5%8ñðè€øô€µ]=I1}5%8¤(€€€Ñ¡É½Ü¹•ÜI…¹•ÉÉ½È ‰A½Í¥Ñ¥½¸½ÕÑÍ¥‘”•¹•É…Ñ•É•…±´ˆ¤ì(€½¹ÍÐÍ¥é”€ô]=I1}M%i€¼€È€¨¨±•Ù•°ì(€É•ÑÕÉ¸Ñ¥±•Ð (€€€±•Ù•°°(€€€5…Ñ ¹™±½½È ¡à€´]=I1}5%8¤€¼Í¥é”¤°(€€€5…Ñ ¹™±½½È ¡è€´]=I1}5%8¤€¼Í¥é”¤°(€€¤ì)ô)•áÁ½ÉÐ™Õ¹Ñ¥½¸•±±Ð¡àè¹Õµ‰•È°èè¹Õµ‰•È¤è•±°ì(€½¹ÍÐÑ¥±”€ôÑ¥±•½ÉA½Í¥Ñ¥½¸¡à°è¤°(€€€à€ô5…Ñ ¹™±½½È¡à€¼11}M%i¤°(€€€è€ô5…Ñ ¹™±½½È¡è€¼11}M%i¤°(€€€Áà€ôà€¨11}M%i€¬€Ä°(€€€Áè€ôè€¨11}M%i€¬€Ä°(€€€ÍÕÉ™…”€ô™¥¹…±MÕÉ™…•Ð¡Áà°Áè¤ì(€É•ÑÕÉ¸ì(€€€½‘”è•±±M••¡à°è¤¹½‘”°(€€€àèà°(€€€èèè°(€€€•±•Ù…Ñ¥½¸èÍÕÉ™…”¹ÍÕÉ™…•!•¥¡Ð°(€€€‰¥½µ”èÍÕÉ™…”¹µ…Ñ•É¥…°°(€€€Ý…±­…‰±”èÍÕÉ™…”¹Ý…±­…‰±”°(€€€Ñ¥±”è€‘íÑ¥±”¹±•Ù•±ô¼‘íÑ¥±”¹áô¼‘íÑ¥±”¹éõ€°(€ôì)ô(¼¨¨•…ÑÕÉ•Ì…É”½Ý¹•‰äÑ¡•¥È…¹¡½ÈÑ¥±”ìÑ¥±”½É‘•È½é½½´¹•Ù•È¡…¹•ÌÑ¡•´¸€¨¼)•áÁ½ÉÐ™Õ¹Ñ¥½¸™•…ÑÕÉ•Í½È¡Ñ¥±”èQ¥±”¤è•…ÑÕÉ•mtì(€½¹ÍÐ™•…ÑÕÉ•Ìè•…ÑÕÉ•mt€ômtì(€½¹ÍÐ…‘€ô€ (€€€­¥¹è•…ÑÕÉl‰­¥¹‰t°(€€€àè¹Õµ‰•È°(€€€èè¹Õµ‰•È°(€€€Ù…É¥…¹Ðè¹Õµ‰•È°(€€€¥èÍÑÉ¥¹œ°(€€€¤€ôøì(€€€¥˜€ (€€€€€à€ðÑ¥±”¹µ¥¹`ñð(€€€€€à€øôÑ¥±”¹µ¥¹`€¬Ñ¥±”¹Í¥é”ñð(€€€€€è€ðÑ¥±”¹µ¥¹hñð(€€€€€è€øôÑ¥±”¹µ¥¹h€¬Ñ¥±”¹Í¥é”(€€€€¤(€€€€€É•ÑÕÉ¸ì(€€€½¹ÍÐÍÕÉ™…”€ô™¥¹…±MÕÉ™…•Ð¡à°è¤ì(€€€¥˜€¡ÍÕÉ™…”¹É½Õ¹‘!•¥¡Ð€ð€À¸ÈñðÍÕÉ™…”¹Ý…Ñ•È¹­¥¹€„ôô€‰¹½¹”ˆ¤É•ÑÕÉ¸ì(€€€¥˜€ ¡­¥¹€ôôô€‰ÑÉ•”ˆñð­¥¹€ôôô€‰É½¬ˆ¤€˜˜ÍÕÉ™…”¹Ù••Ñ…Ñ¥½¹•¹Í¥ÑåM…±”€ðô€À¤É•ÑÕÉ¸ì(€€€™•…ÑÕÉ•Ì¹ÁÕÍ ¡ì(€€€€€­¥¹°(€€€€€à°(€€€€€è°(€€€€€äèÍÕÉ™…”¹É½Õ¹‘!•¥¡Ð°(€€€€€Ù…É¥…¹Ð°(€€€€€½‘”è€‘í]=I1}Mô¼‘í9IQ=I}YIM%=9ô½¼‘í¥‘õ€°(€€€ô¤ì(€ôì(€™½È€¡½¹ÍÐÌ½˜Á±…•Ì¤ì(€€€½¹ÍÐ•áÑ•¹Ð€ôÌ¹­¥¹€ôôô€‰¥Ñäˆ€ü€ÐÐÀ€è€àÀì(€€€¥˜€ (€€€€€Ì¹à€ðÑ¥±”¹µ¥¹`€´•áÑ•¹Ðñð(€€€€€Ì¹à€øÑ¥±”¹µ¥¹`€¬Ñ¥±”¹Í¥é”€¬•áÑ•¹Ðñð(€€€€€Ì¹è€ðÑ¥±”¹µ¥¹h€´•áÑ•¹Ðñð(€€€€€Ì¹è€øÑ¥±”¹µ¥¹h€¬Ñ¥±”¹Í¥é”€¬•áÑ•¹Ð(€€€€¤(€€€€€½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÍà€ô5…Ñ ¹™±½½È¡Ì¹à€¼€È¤°(€€€€€Íè€ô5…Ñ ¹™±½½È¡Ì¹è€¼€È¤°(€€€€€¥€ôÌ¹¥ì(€€€…‘ (€€€€€€‰­••Àˆ°(€€€€€Ì¹à€´€ÌÀ°(€€€€€Ì¹è€´€Èà°(€€€€€½½É‘¥¹…Ñ•Y…±Õ”¡Íà°Íè°€ÄÄ¤°(€€€€€€‘í¥‘ô¼‘íÌ¹­¥¹‘ô½­••Á€°(€€€€¤ì(€€€…‘ ‰Ý•±°ˆ°Ì¹à°Ì¹è°€À°€‘í¥‘ô¼‘íÌ¹­¥¹‘ô½Ý•±±€¤ì(€€€™½È€¡±•Ð¤€ô€Àì¤€ð€Äàì¤¬¬¤ì(€€€€€½¹ÍÐØ€ô½½É‘¥¹…Ñ•Y…±Õ”¡Íà°Íè°€ÈÀ€¬¤¤ì(€€€€€½¹ÍÐÍ¥‘”€ô¤€”€È€ôôô€À€ü€´Ä€è€Äì(€€€€€½¹ÍÐà€ôÌ¹à€¬€¡¤€ð€ÄÀ€üÍ¥‘”€¨€ ÄÔ€¬€¡Ø€”€Ø¤¤€è€¡¤€´€ÄÐ¤€¨€ÄÌ¤ì(€€€€€½¹ÍÐè€ô(€€€€€€€Ì¹è€¬€¡¤€ð€ÄÀ€ü€¡5…Ñ ¹™±½½È¡¤€¼€È¤€´€È¤€¨€ÄÐ€èÍ¥‘”€¨€ ÐÈ€¬€¡Ø€”€Ô¤¤¤ì(€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡à€´€¡Ì¹à€´€ÌÀ¤°è€´€¡Ì¹è€´€Èà¤¤€ø€Ää¤(€€€€€€€…‘ ‰¡½ÕÍ”ˆ°à°è°Ø°€‘í¥‘ô¼‘íÌ¹­¥¹‘ô½¡½ÕÍ”¼‘í¥õ€¤ì(€€€ô(€€€™½È€¡±•Ð¤€ô€Àì¤€ð€Ðì¤¬¬¤(€€€€€…‘ (€€€€€€€€‰™¥•±ˆ°(€€€€€€€Ì¹à€¬€¡¤€”€È€ôôô€À€ü€´Ä€è€Ä¤€¨€¡Ì¹­¥¹€ôôô€‰¥Ñäˆ€ü€ÌÔÀ€è€ØÔ¤°(€€€€€€€Ì¹è€¬€ÄØ€¬5…Ñ ¹™±½½È¡¤€¼€È¤€¨€ÈÐ°(€€€€€€€¤°(€€€€€€€€‘í¥‘ô¼‘íÌ¹­¥¹‘ô½™¥•±¼‘í¥õ€°(€€€€€€¤ì(€€€¥˜€¡Ì¹­¥¹€ôôô€‰¥Ñäˆ¤(€€€€€™½È€¡±•Ð¤€ô€Àì¤€ð€ÐÀÀì¤¬¬¤ì(€€€€€€€½¹ÍÐà€ô€ ¡¤€”€ÈÀ¤€´€ä¸Ô¤€¨€Èä°(€€€€€€€€€è€ô€¡5…Ñ ¹™±½½È¡¤€¼€ÈÀ¤€´€ä¸Ô¤€¨€Èäì(€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡à¤€ø€ÐÀñð5…Ñ ¹…‰Ì¡è¤€ø€ÔÔ¤(€€€€€€€€€…‘ (€€€€€€€€€€€€‰¡½ÕÍ”ˆ°(€€€€€€€€€€€Ì¹à€¬à°(€€€€€€€€€€€Ì¹è€¬è°(€€€€€€€€€€€½½É‘¥¹…Ñ•Y…±Õ”¡Íà°Íè°€àÀ€¬¤¤°(€€€€€€€€€€€€‘í¥‘ô½ÕÉ‰…¸µ¡½ÕÍ”¼‘í¥õ€°(€€€€€€€€€€¤ì(€€€€€ô(€ô(€¥˜€¡Ñ¥±”¹Í¥é”€ðô€ÈÔØ¤ì(€€€™½È€ (€€€€€±•Ðè€ô5…Ñ ¹™±½½È¡Ñ¥±”¹µ¥¹h€¼€ÄÀ¤€´€Äì(€€€€€è€ð€¡Ñ¥±”¹µ¥¹h€¬Ñ¥±”¹Í¥é”¤€¼€ÄÀ€¬€Äì(€€€€€è¬¬(€€€€¤ì(€€€€€™½È€ (€€€€€€€±•Ðà€ô5…Ñ ¹™±½½È¡Ñ¥±”¹µ¥¹`€¼€ÄÀ¤€´€Äì(€€€€€€€à€ð€¡Ñ¥±”¹µ¥¹`€¬Ñ¥±”¹Í¥é”¤€¼€ÄÀ€¬€Äì(€€€€€€€à¬¬(€€€€€€¤ì(€€€€€€€½¹ÍÐØ€ô½½É‘¥¹…Ñ•Y…±Õ”¡à°è°€ÌÀ¤ì(€€€€€€€½¹ÍÐà€ôà€¨€ÄÀ€¬€¡Ø€”€Ü¤€´€Ì°(€€€€€€€€€è€ôè€¨€ÄÀ€¬€ ¡Ø€øøø€Ô¤€”€Ü¤€´€Ìì(€€€€€€€½¹ÍÐ‰¥½µ”€ô‰¥½µ•Ð¡à°è¤ì(€€€€€€€¥˜€¡‰¥½µ”€ôôô€‰]½½‘±…¹ˆ€˜˜Ø€”€Ð€„ôô€À¤(€€€€€€€€€…‘ ‰ÑÉ•”ˆ°à°è°Ø°ÑÉ•”¼‘íáô¼‘íéõ€¤ì(€€€€€€€•±Í”¥˜€ (€€€€€€€€€€…l‰M•ÑÑ±•µ•¹Ðˆ°€‰=•…¸ˆ°€‰1…­”ˆ°€‰I¥Ù•Èˆ°€‰I½…ˆ°€‰	É¥‘”‰t¹¥¹±Õ‘•Ì¡‰¥½µ”¤€˜˜(€€€€€€€€€Ø€”€ÌÄ€ôôô€À(€€€€€€€€¤(€€€€€€€€€…‘ ‰É½¬ˆ°à°è°Ø°É½¬¼‘íáô¼‘íéõ€¤ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸™•…ÑÕÉ•Ìì)ô)•áÁ½ÉÐÑåÁ”Y¥•Ü€ôì(€àè¹Õµ‰•Èì(€èè¹Õµ‰•Èì(€¡…±™!•¥¡Ðè¹Õµ‰•Èì(€…ÍÁ•Ðè¹Õµ‰•Èì(€å…Üè¹Õµ‰•Èì(€Á¥á•±Ìè¹Õµ‰•Èì)ôì(¼¨¨Y¥•ÝÁ½ÉÐ‰½Õ¹‘Ì½˜Ñ¡”Ñ¥±Ñ•½ÉÑ¡½É…Á¡¥Œ…µ•É„°•¹±…É•‰ä½¹”Ñ¥±”™½ÈÁÉ•™•Ñ ¸€¨¼)•áÁ½ÉÐ™Õ¹Ñ¥½¸Ù¥•Ý	½Õ¹‘Ì¡Ù¥•ÜèY¥•Ü¤ì(€½¹ÍÐ¡Ü€ôÙ¥•Ü¹¡…±™!•¥¡Ð€¨Ù¥•Ü¹…ÍÁ•Ð°(€€€¡è€ôÙ¥•Ü¹¡…±™!•¥¡Ð€¼5…Ñ ¹Í¥¸¡5…Ñ ¹A$€¼€Ì¤ì(€½¹ÍÐŒ€ô5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡Ù¥•Ü¹å…Ü¤¤°(€€€Ì€ô5…Ñ ¹…‰Ì¡5…Ñ ¹Í¥¸¡Ù¥•Ü¹å…Ü¤¤ì(€½¹ÍÐµ…É¥¸€ô5…Ñ ¹µ…à Ð°5…Ñ ¹µ¥¸ Ðà°Ù¥•Ü¹¡…±™!•¥¡Ð€¨€À¸ÌÔ¤¤ì(€É•ÑÕÉ¸ìÉàè¡Ü€¨Œ€¬¡è€¨Ì€¬µ…É¥¸°Éèè¡Ü€¨Ì€¬¡è€¨Œ€¬µ…É¥¸ôì)ô()™Õ¹Ñ¥½¸ÝÉ…ÁÁ•‘Q¥±•¥ÍÑ…¹•`¡àè¹Õµ‰•È°™½ÕÍ`è¹Õµ‰•È¤è¹Õµ‰•Èì(€É•ÑÕÉ¸5…Ñ ¹…‰Ì¡ÝÉ…ÁM½ÕÉ•`¡à€´™½ÕÍ`¤¤ì)ô((¼¨¨á…ÐµÁ½±”Ñ…¹•¹Ð½Ù•É…”¥Ì„É…‘¥…°ÁÉ•Í•¹Ñ…Ñ¥½¸É¥¹œ°¹½ÐÝ½É±…ÕÑ¡½É¥Ñä¸€¨¼)½¹ÍÐA=1}Q%Y}AQ!}1%5%P€ô€ÄØì((¼¨¨(€¨]É…Àµ…Ý…É”±½…°Á…Ñ Í•±•Ñ¥½¸¸9•…È„Á½±”°±½¹¥ÑÕ‘”½¹Ù•É•¹”•áÁ…¹‘Ì(€¨Ñ¡”Í½ÕÉ”µ‘½µ…¥¸Í•…É Í¼Ñ¡”Ñ…¹•¹ÐÙ¥•ÜÉ••¥Ù•Ì„½µÁ±•Ñ”É¥¹œ½˜(€¨…¹½¹¥…°½Ù•É…”¥¹ÍÑ•…½˜„¹…ÉÉ½Ü•ÅÕ¥É•Ñ…¹Õ±…ÈÝ•‘”¸(€¨¼)•áÁ½ÉÐ™Õ¹Ñ¥½¸Í•±•ÑQ¥±•Ì (€Ù¥•ÜèY¥•Ü°(€Ñ¡É•Í¡½±€ô€ÄäÀ°(€…Ñ¥Ù•1¥µ¥Ð€ôÍÑÉ•…µ¥¹	Õ‘•Ñ½ÉY¥•ÝÁ½ÉÐ (€€€Ù¥•Ü¹Á¥á•±Ì€¨Ù¥•Ü¹…ÍÁ•Ð°(€€€Ù¥•Ü¹Á¥á•±Ì°(€€¤¹…Ñ¥Ù•A…Ñ¡•Ì°(¤èQ¥±•mtì(€½¹ÍÐ‰½Õ¹‘Ì€ôÙ¥•Ý	½Õ¹‘Ì¡Ù¥•Ü¤°(€€€™½ÕÌ€ôÍ½ÕÉ•Q½1½¹1…Ð¡Ù¥•Ü¹à°Ù¥•Ü¹è¤°(€€€…ÑA½±”€ô5…Ñ ¹…‰Ì¡5…Ñ ¹…‰Ì¡™½ÕÌ¹±…Ð¤€´5…Ñ ¹A$€¼€È¤€ðô€Å”´ÄÈ°(€€€Í•±•Ñ¥½¹1¥µ¥Ð€ô…ÑA½±”(€€€€€€ü5…Ñ ¹µ¥¸¡…Ñ¥Ù•1¥µ¥Ð°A=1}Q%Y}AQ!}1%5%P¤(€€€€€€è…Ñ¥Ù•1¥µ¥Ð°(€€€ÍÑÉ•…µ`€ô…ÑA½±”€ü€À€èÙ¥•Ü¹à°(€€€±½¹¥ÑÕ‘•M…±”€ô5…Ñ ¹µ…à À¸ÀÈ°5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡™½ÕÌ¹±…Ð¤¤¤°(€€€Éà€ô…ÑA½±”(€€€€€€ü]=I1}M%i€¼€È(€€€€€€è5…Ñ ¹µ¥¸¡]=I1}M%i€¼€È°‰½Õ¹‘Ì¹Éà€¼±½¹¥ÑÕ‘•M…±”¤°(€€€Éè€ô‰½Õ¹‘Ì¹Éè°(€€€Í•±•Ñ•€ô¹•Ü5…ÀñÍÑÉ¥¹œ°Q¥±”ø ¤°(€€€•¹ÑÉ•Ì€ômÍÑÉ•…µatì((€¥˜€¡ÍÑÉ•…µ`€´Éà€ð]=I1}5%8¤•¹ÑÉ•Ì¹ÁÕÍ ¡ÍÑÉ•…µ`€¬]=I1}M%i¤ì(€¥˜€¡ÍÑÉ•…µ`€¬Éà€ø€µ]=I1}5%8¤•¹ÑÉ•Ì¹ÁÕÍ ¡ÍÑÉ•…µ`€´]=I1}M%i¤ì((€½¹ÍÐÙ¥Í¥Ð€ô€¡ÐèQ¥±”°•¹ÑÉ•`è¹Õµ‰•È¤€ôøì(€€€½¹ÍÐµ…áh€ôÐ¹µ¥¹h€¬Ð¹Í¥é”ì(€€€€¼¼Q¡”LÀÀÄÍ½ÕÉ”Á±…¹”•áÑ•¹‘ÌÁ…ÍÐÑ¡”…¹½¹¥…°Á½±•Ì¸9•Ù•ÈÍÑÉ•…´(€€€€¼¼Ñ¡½Í”¥¹Ù…±¥‰…¹‘Ì¸MÕ‰‘¥Ù¥‘”½…ÉÍ”É½ÍÍ¥¹œÁ…Ñ¡•ÌÕ¹Ñ¥°Ñ¡”•á…Ð(€€€€¼¼±•Ù•°´ÈÁ½±”‰½Õ¹‘…É¥•Ì…¸‰”Í•±•Ñ•Ý¥Ñ¡½ÕÐ™½±‘•‘ÕÁ±¥…Ñ•Ì¸(€€€¥˜€ (€€€€€Ð¹µ¥¹h€øôM=UI}AIM9QQ%=9}A=1}%MQ9ñð(€€€€€µ…áh€ðô€µM=UI}AIM9QQ%=9}A=1}%MQ9(€€€€¤(€€€€€É•ÑÕÉ¸ì(€€€½¹ÍÐÉ½ÍÍ•ÍA½±”€ô(€€€€€Ð¹µ¥¹h€ð€µM=UI}AIM9QQ%=9}A=1}%MQ9ñð(€€€€€µ…áh€øM=UI}AIM9QQ%=9}A=1}%MQ9ì(€€€¥˜€ (€€€€€Ð¹µ¥¹`€ø•¹ÑÉ•`€¬Éàñð(€€€€€Ð¹µ¥¹`€¬Ð¹Í¥é”€ð•¹ÑÉ•`€´Éàñð(€€€€€Ð¹µ¥¹h€øÙ¥•Ü¹è€¬Éèñð(€€€€€µ…áh€ðÙ¥•Ü¹è€´Éè(€€€€¤(€€€€€É•ÑÕÉ¸ì(€€€½¹ÍÐÁÉ½©•Ñ•‘A¥á•±Ì€ô€¡Ð¹Í¥é”€¨Ù¥•Ü¹Á¥á•±Ì¤€¼€¡Ù¥•Ü¹¡…±™!•¥¡Ð€¨€È¤ì(€€€¥˜€ (€€€€€Ð¹±•Ù•°€ð5a}1Y0€˜˜(€€€€€€¡É½ÍÍ•ÍA½±”ñðÁÉ½©•Ñ•‘A¥á•±Ì€øÑ¡É•Í¡½±¤(€€€€¤ì(€€€€€™½È€¡±•Ð‘è€ô€Àì‘è€ð€Èì‘è¬¬¤(€€€€€€€™½È€¡±•Ð‘à€ô€Àì‘à€ð€Èì‘à¬¬¤(€€€€€€€€€Ù¥Í¥Ð¡Ñ¥±•Ð¡Ð¹±•Ù•°€¬€Ä°Ð¹à€¨€È€¬‘à°Ð¹è€¨€È€¬‘è¤°•¹ÑÉ•`¤ì(€€€ô•±Í”Í•±•Ñ•¹Í•Ð¡Ð¹­•ä°Ð¤ì(€ôì((€™½È€¡½¹ÍÐ•¹ÑÉ•`½˜•¹ÑÉ•Ì¤Ù¥Í¥Ð¡Ñ¥±•Ð À°€À°€À¤°•¹ÑÉ•`¤ì(€¥˜€¡Í•±•Ñ•¹Í¥é”€øÍ•±•Ñ¥½¹1¥µ¥Ð¤(€€€É•ÑÕÉ¸Í•±•ÑQ¥±•Ì¡Ù¥•Ü°Ñ¡É•Í¡½±€¨€Ä¸ÈÔ°Í•±•Ñ¥½¹1¥µ¥Ð¤ì((€É•ÑÕÉ¸l¸¸¹Í•±•Ñ•¹Ù…±Õ•Ì ¥t¹Í½ÉÐ (€€€€¡„°ˆ¤€ôø(€€€€€5…Ñ ¹¡åÁ½Ð (€€€€€€€ÝÉ…ÁÁ•‘Q¥±•¥ÍÑ…¹•`¡„¹µ¥¹`€¬„¹Í¥é”€¼€È°ÍÑÉ•…µ`¤°(€€€€€€€„¹µ¥¹h€¬„¹Í¥é”€¼€È€´Ù¥•Ü¹è°(€€€€€€¤€´(€€€€€5…Ñ ¹¡åÁ½Ð (€€€€€€€ÝÉ…ÁÁ•‘Q¥±•¥ÍÑ…¹•`¡ˆ¹µ¥¹`€¬ˆ¹Í¥é”€¼€È°ÍÑÉ•…µ`¤°(€€€€€€€ˆ¹µ¥¹h€¬ˆ¹Í¥é”€¼€È€´Ù¥•Ü¹è°(€€€€€€¤°(€€¤ì)ô(