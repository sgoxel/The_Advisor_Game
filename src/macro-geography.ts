import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  clampLatitude,
  normalizeLongitude,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";

/**
 * Planet-scale natural-world authority. Every value is a pure lookup from the
 * Campaign SEED + generator version. Camera, LOD, device and visit order never
 * enter these functions.
 */
export type MountainKind =
  | "chain"
  | "hook"
  | "massif"
  | "highland"
  | "ridge"
  | "volcanic";

export type MacroContinent = {
  id: number;
  code: string;
  name: string;
  canonicalPosition: CanonicalPosition;
  majorRadius: number;
  minorRadius: number;
  rotation: number;
  harmonics: readonly { frequency: number; amplitude: number; phase: number }[];
};

export type MacroIsland = {
  id: number;
  code: string;
  continent: number;
  canonicalPosition: CanonicalPosition;
  majorRadius: number;
  minorRadius: number;
  rotation: number;
  harmonic: { frequency: number; amplitude: number; phase: number };
};

export type MacroLake = {
  id: number;
  code: string;
  continent: number;
  canonicalPosition: CanonicalPosition;
  majorRadius: number;
  minorRadius: number;
  rotation: number;
  harmonic: { frequency: number; amplitude: number; phase: number };
};

export type MountainSystem = {
  id: number;
  code: string;
  continent: number;
  kind: MountainKind;
  canonicalPosition: CanonicalPosition;
  axis: number;
  length: number;
  width: number;
  relief: number;
  curve: number;
};

export type MacroGeography = {
  seed: string;
  version: string;
  continents: readonly MacroContinent[];
  islands: readonly MacroIsland[];
  lakes: readonly MacroLake[];
  mountainSystems: readonly MountainSystem[];
};

export type MacroSample = {
  landform: "Mainland" | "Island" | "Ocean";
  continent: number | null;
  island: number | null;
  lake: number | null;
  lakeCode: string | null;
  landScore: number;
  mountainSystem: string | null;
  mountainKind: MountainKind | null;
  mountainRelief: number;
};

const CONTINENT_NAMES = ["Eldermere", "Westreach", "Dawnlands"] as const;
const MOUNTAIN_KINDS: readonly MountainKind[] = [
  "chain",
  "hook",
  "massif",
  "highland",
  "ridge",
  "volcanic",
];

/** Stable content digest; this is an address lookup, never a mutable RNG stream. */
export function macroDigest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

const unit = (seed: string, key: string) =>
  macroDigest(`${seed}/${WORLD_FOUNDATION_VERSION}/${key}`) / 0xffffffff;
const signed = (seed: string, key: string) => unit(seed, key) * 2 - 1;
const TAU = Math.PI * 2;

function angularDistance(a: LonLat, b: LonLat) {
  const dLat = b.lat - a.lat,
    dLon = normalizeLongitude(b.lon - a.lon),
    x = dLon * Math.cos((a.lat + b.lat) / 2);
  return Math.hypot(x, dLat);
}

/** Local tangent-radian offset, safe for the bounded macro features generated here. */
export function macroOffset(
  origin: LonLat,
  eastRadians: number,
  northRadians: number,
): CanonicalPosition {
  const lat = clampLatitude(origin.lat + northRadians),
    cos = Math.max(0.2, Math.abs(Math.cos(origin.lat)));
  return {
    lon: normalizeLongitude(origin.lon + eastRadians / cos),
    lat,
    elevation: 0,
  };
}

function localPoint(origin: LonLat, point: LonLat) {
  return {
    x: normalizeLongitude(point.lon - origin.lon) * Math.cos(origin.lat),
    y: point.lat - origin.lat,
  };
}

function rotate(x: number, y: number, angle: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: x * c + y * s, y: -x * s + y * c };
}

function continentScore(continent: MacroContinent, position: LonLat) {
  const local = localPoint(continent.canonicalPosition, position),
    p = rotate(local.x, local.y, continent.rotation),
    angle = Math.atan2(p.y / continent.minorRadius, p.x / continent.majorRadius),
    radius = Math.hypot(p.x / continent.majorRadius, p.y / continent.minorRadius);
  let outline = 1;
  for (const harmonic of continent.harmonics)
    outline += harmonic.amplitude * Math.sin(harmonic.frequency * angle + harmonic.phase);
  outline += 0.045 * Math.cos(angle - continent.rotation * 0.7);
  return outline - radius;
}

function ellipticalFeatureScore(
  feature: Pick<
    MacroIsland | MacroLake,
    "canonicalPosition" | "majorRadius" | "minorRadius" | "rotation" | "harmonic"
  >,
  position: LonLat,
) {
  const local = localPoint(feature.canonicalPosition, position),
    p = rotate(local.x, local.y, feature.rotation),
    angle = Math.atan2(p.y / feature.minorRadius, p.x / feature.majorRadius),
    radius = Math.hypot(p.x / feature.majorRadius, p.y / feature.minorRadius),
    outline =
      1 +
      feature.harmonic.amplitude *
        Math.sin(feature.harmonic.frequency * angle + feature.harmonic.phase);
  return outline - radius;
}

function islandScore(island: MacroIsland, position: LonLat) {
  return ellipticalFeatureScore(island, position);
}

function lakeScore(lake: MacroLake, position: LonLat) {
  return ellipticalFeatureScore(lake, position);
}

function makeContinent(seed: string, id: number, accepted: readonly MacroContinent[]) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const key = `CONTINENT/${id}/ATTEMPT/${attempt}`,
      lon = normalizeLongitude(signed(seed, `${key}/LON`) * Math.PI),
      lat = signed(seed, `${key}/LAT`) * 0.52,
      candidate = { lon, lat };
    if (accepted.some((other) => angularDistance(candidate, other.canonicalPosition) < 1.4))
      continue;
    const code = `${seed}/${WORLD_FOUNDATION_VERSION}/MACRO/CONTINENT/${id}`;
    return {
      id,
      code,
      name: CONTINENT_NAMES[id] ?? `Continent ${id + 1}`,
      canonicalPosition: { lon, lat, elevation: 0 },
      majorRadius: 0.72 + unit(seed, `${key}/MAJOR`) * 0.16,
      minorRadius: 0.45 + unit(seed, `${key}/MINOR`) * 0.11,
      rotation: unit(seed, `${key}/ROTATION`) * TAU,
      harmonics: [2, 3, 5, 7].map((frequency, index) => ({
        frequency,
        amplitude:
          0.035 +
          unit(seed, `${key}/HARMONIC/${index}/AMP`) *
            (index < 2 ? 0.085 : 0.05),
        phase: unit(seed, `${key}/HARMONIC/${index}/PHASE`) * TAU,
      })),
    } satisfies MacroContinent;
  }
  throw new Error(`Unable to place macro continent ${id}`);
}

function makeIslands(seed: string, continents: readonly MacroContinent[]) {
  const islands: MacroIsland[] = [];
  for (const continent of continents) {
    const count = 4 + (macroDigest(`${continent.code}/ISLAND-COUNT`) % 3);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const key = `ISLAND/${continent.id}/${i}/ATTEMPT/${attempt}`,
          angle = unit(seed, `${key}/ANGLE`) * TAU,
          radius = 0.92 + unit(seed, `${key}/RADIUS`) * 0.5,
          origin = macroOffset(
            continent.canonicalPosition,
            Math.cos(angle) * continent.majorRadius * radius,
            Math.sin(angle) * continent.minorRadius * radius,
          );
        if (Math.abs(origin.lat) > 1.28) continue;
        const mainlandScore = Math.max(
          ...continents.map((candidate) => continentScore(candidate, origin)),
        );
        if (mainlandScore > -0.035) continue;
        const majorRadius = 0.045 + unit(seed, `${key}/MAJOR`) * 0.095,
          minorRadius = majorRadius * (0.45 + unit(seed, `${key}/ASPECT`) * 0.42),
          island: MacroIsland = {
            id: islands.length,
            code: `${seed}/${WORLD_FOUNDATION_VERSION}/MACRO/ISLAND/${continent.id}/${i}`,
            continent: continent.id,
            canonicalPosition: origin,
            majorRadius,
            minorRadius,
            rotation: unit(seed, `${key}/ROTATION`) * TAU,
            harmonic: {
              frequency: 2 + (macroDigest(`${seed}/${key}/FREQUENCY`) % 4),
              amplitude: 0.05 + unit(seed, `${key}/AMP`) * 0.12,
              phase: unit(seed, `${key}/PHASE`) * TAU,
            },
          };
        if (
          islands.some(
            (other) =>
              angularDistance(origin, other.canonicalPosition) <
              majorRadius + other.majorRadius * 0.65,
          )
        )
          continue;
        islands.push(island);
        break;
      }
    }
  }
  return islands;
}

function mountainParameters(kind: MountainKind, seed: string, key: string) {
  const u = (name: string) => unit(seed, `${key}/${name}`);
  switch (kind) {
    case "chain":
      return {
        length: 0.46 + u("L") * 0.22,
        width: 0.045 + u("W") * 0.035,
        relief: 135 + u("R") * 65,
        curve: signed(seed, `${key}/C`) * 0.12,
      };
    case "hook":
      return {
        length: 0.35 + u("L") * 0.18,
        width: 0.055 + u("W") * 0.035,
        relief: 125 + u("R") * 75,
        curve: (signed(seed, `${key}/C`) || 1) * (0.28 + u("C2") * 0.24),
      };
    case "massif":
      return {
        length: 0.16 + u("L") * 0.1,
        width: 0.11 + u("W") * 0.08,
        relief: 155 + u("R") * 80,
        curve: 0,
      };
    case "highland":
      return {
        length: 0.3 + u("L") * 0.18,
        width: 0.14 + u("W") * 0.09,
        relief: 55 + u("R") * 55,
        curve: signed(seed, `${key}/C`) * 0.1,
      };
    case "ridge":
      return {
        length: 0.22 + u("L") * 0.17,
        width: 0.035 + u("W") * 0.028,
        relief: 90 + u("R") * 65,
        curve: signed(seed, `${key}/C`) * 0.08,
      };
    case "volcanic":
      return {
        length: 0.13 + u("L") * 0.18,
        width: 0.045 + u("W") * 0.045,
        relief: 185 + u("R") * 95,
        curve: signed(seed, `${key}/C`) * 0.08,
      };
  }
}

function makeMountainSystems(seed: string, continents: readonly MacroContinent[]) {
  const systems: MountainSystem[] = [];
  let requiredKind = 0;
  for (const continent of continents) {
    const count = 4 + (macroDigest(`${continent.code}/MOUNTAIN-COUNT`) % 3);
    for (let i = 0; i < count; i++) {
      const key = `MOUNTAIN/${continent.id}/${i}`,
        kind =
          requiredKind < MOUNTAIN_KINDS.length
            ? MOUNTAIN_KINDS[
                (requiredKind++ +
                  (macroDigest(`${seed}/MOUNTAIN-KIND-OFFSET`) %
                    MOUNTAIN_KINDS.length)) %
                  MOUNTAIN_KINDS.length
              ]
            : MOUNTAIN_KINDS[
                macroDigest(`${seed}/${key}/KIND`) % MOUNTAIN_KINDS.length
              ],
        angle = unit(seed, `${key}/POSITION-ANGLE`) * TAU,
        radius = 0.12 + unit(seed, `${key}/POSITION-RADIUS`) * 0.5,
        center = continentLocalPosition(
          continent,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ),
        parameters = mountainParameters(kind, seed, key);
      systems.push({
        id: systems.length,
        code: `${seed}/${WORLD_FOUNDATION_VERSION}/MACRO/MOUNTAIN/${continent.id}/${i}/${kind}`,
        continent: continent.id,
        kind,
        canonicalPosition: center,
        axis: unit(seed, `${key}/AXIS`) * TAU,
        ...parameters,
      });
    }
  }
  return systems;
}

function makeLakes(
  seed: string,
  continents: readonly MacroContinent[],
  mountainSystems: readonly MountainSystem[],
) {
  const lakes: MacroLake[] = [];
  for (const continent of continents) {
    const count = 1;
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 128; attempt++) {
        const key = `LAKE/${continent.id}/${i}/ATTEMPT/${attempt}`,
          angle = unit(seed, `${key}/ANGLE`) * TAU,
          radius = 0.08 + unit(seed, `${key}/RADIUS`) * 0.28,
          origin = continentLocalPosition(
            continent,
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
          ),
          interior = continentScore(continent, origin);
        if (interior < 0.24 || Math.abs(origin.lat) > 1.25) continue;
        const majorRadius = 0.04 + unit(seed, `${key}/MAJOR`) * 0.04,
          minorRadius = majorRadius * (0.5 + unit(seed, `${key}/ASPECT`) * 0.3);
        if (
          mountainSystems.some(
            (system) =>
              system.continent === continent.id &&
              angularDistance(origin, system.canonicalPosition) < majorRadius * 1.35,
          ) ||
          lakes.some(
            (other) =>
              other.continent === continent.id &&
              angularDistance(origin, other.canonicalPosition) <
                majorRadius + other.majorRadius * 1.25,
          )
        )
          continue;
        lakes.push({
          id: lakes.length,
          code: `${seed}/${WORLD_FOUNDATION_VERSION}/MACRO/LAKE/${continent.id}/${i}`,
          continent: continent.id,
          canonicalPosition: origin,
          majorRadius,
          minorRadius,
          rotation: unit(seed, `${key}/ROTATION`) * TAU,
          harmonic: {
            frequency: 2 + (macroDigest(`${seed}/${key}/FREQUENCY`) % 4),
            amplitude: 0.045 + unit(seed, `${key}/AMP`) * 0.09,
            phase: unit(seed, `${key}/PHASE`) * TAU,
          },
        });
        placed = true;
        break;
      }
      if (!placed)
        throw new Error(`Unable to place macro lake ${continent.id}/${i}`);
    }
  }
  return lakes;
}

export function buildMacroGeography(seed = WORLD_SEED): MacroGeography {
  const continents: MacroContinent[] = [];
  for (let id = 0; id < 3; id++)
    continents.push(makeContinent(seed, id, continents));
  const mountainSystems = makeMountainSystems(seed, continents);
  return Object.freeze({
    seed,
    version: WORLD_FOUNDATION_VERSION,
    continents: Object.freeze(continents),
    islands: Object.freeze(makeIslands(seed, continents)),
    lakes: Object.freeze(makeLakes(seed, continents, mountainSystems)),
    mountainSystems: Object.freeze(mountainSystems),
  });
}

export const MACRO_GEOGRAPHY = buildMacroGeography();

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax,
    dy = by - ay,
    length2 = dx * dx + dy * dy || 1,
    t = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2),
    ),
    x = ax + dx * t,
    y = ay + dy * t;
  return Math.hypot(px - x, py - y);
}

function mountainInfluence(system: MountainSystem, position: LonLat) {
  const local = localPoint(system.canonicalPosition, position),
    p = rotate(local.x, local.y, system.axis),
    half = system.length / 2;
  let distance: number;
  if (system.kind === "massif") {
    distance = Math.hypot(p.x / 1.35, p.y);
  } else if (system.kind === "hook") {
    const bend = system.curve >= 0 ? 1 : -1,
      d1 = distanceToSegment(p.x, p.y, -half, 0, half * 0.15, 0),
      d2 = distanceToSegment(
        p.x,
        p.y,
        half * 0.15,
        0,
        half * 0.45,
        bend * half * 0.58,
      );
    distance = Math.min(d1, d2);
  } else {
    const curveOffset =
      system.curve *
      Math.sin(
        (Math.max(-half, Math.min(half, p.x)) / Math.max(half, 1e-6)) *
          Math.PI,
      );
    distance = distanceToSegment(p.x, p.y, -half, 0, half, curveOffset);
  }
  const cross = Math.max(0, 1 - distance / system.width),
    along =
      system.kind === "massif"
        ? 1
        : Math.max(
            0,
            1 -
              Math.max(0, Math.abs(p.x) - half) /
                Math.max(system.width, 1e-6),
          ),
    profile = cross * cross * (3 - 2 * cross) * along;
  if (system.kind === "volcanic") {
    const chain = Math.max(0, 1 - distance / system.width),
      cone = Math.max(
        0,
        1 - Math.hypot(p.x * 1.6, p.y) / (system.width * 1.7),
      );
    return Math.max(chain * 0.58, cone * cone);
  }
  return profile;
}

export function sampleMacroGeography(
  position: LonLat,
  geography: MacroGeography = MACRO_GEOGRAPHY,
): MacroSample {
  let continent: MacroContinent | undefined,
    bestContinentScore = -Infinity;
  for (const candidate of geography.continents) {
    const score = continentScore(candidate, position);
    if (score > bestContinentScore) {
      bestContinentScore = score;
      continent = candidate;
    }
  }

  let lake: MacroLake | undefined,
    bestLakeScore = -Infinity;
  if (bestContinentScore > 0 && continent)
    for (const candidate of geography.lakes) {
      if (candidate.continent !== continent.id) continue;
      const score = lakeScore(candidate, position);
      if (score > bestLakeScore) {
        bestLakeScore = score;
        lake = candidate;
      }
    }
  const insideLake = bestContinentScore > 0 && bestLakeScore > 0;

  let island: MacroIsland | undefined,
    bestIslandScore = -Infinity;
  if (bestContinentScore <= 0)
    for (const candidate of geography.islands) {
      const score = islandScore(candidate, position);
      if (score > bestIslandScore) {
        bestIslandScore = score;
        island = candidate;
      }
    }

  const landform =
      insideLake
        ? "Ocean"
        : bestContinentScore > 0
          ? "Mainland"
          : bestIslandScore > 0
            ? "Island"
            : "Ocean",
    owningContinent =
      landform === "Mainland"
        ? continent?.id ?? null
        : landform === "Island"
          ? island?.continent ?? null
          : null,
    sampleContinent = insideLake ? lake?.continent ?? null : owningContinent;
  let mountain: MountainSystem | undefined,
    mountainStrength = 0;
  if (!insideLake && owningContinent !== null)
    for (const candidate of geography.mountainSystems) {
      if (candidate.continent !== owningContinent) continue;
      const strength = mountainInfluence(candidate, position);
      if (strength > mountainStrength) {
        mountainStrength = strength;
        mountain = candidate;
      }
    }

  return {
    landform,
    continent: sampleContinent,
    island: landform === "Island" ? island?.id ?? null : null,
    lake: insideLake ? lake?.id ?? null : null,
    lakeCode: insideLake ? lake?.code ?? null : null,
    landScore: insideLake
      ? -Math.max(0.001, bestLakeScore)
      : landform === "Mainland"
        ? bestContinentScore
        : landform === "Island"
          ? bestIslandScore
          : Math.max(bestContinentScore, bestIslandScore),
    mountainSystem:
      mountainStrength > 0.015 ? mountain?.code ?? null : null,
    mountainKind: mountainStrength > 0.015 ? mountain?.kind ?? null : null,
    mountainRelief: mountain ? mountain.relief * mountainStrength : 0,
  };
}

export function continentLocalPosition(
  continent: MacroContinent,
  eastFraction: number,
  northFraction: number,
): CanonicalPosition {
  const p = rotate(
    eastFraction * continent.majorRadius,
    northFraction * continent.minorRadius,
    -continent.rotation,
  );
  return macroOffset(continent.canonicalPosition, p.x, p.y);
}
