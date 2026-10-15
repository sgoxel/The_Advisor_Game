import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  cities,
  continuityCorridor,
  countries,
  countryAtPosition,
  roads as geographyRoads,
  villages,
  type Country,
  type Place,
  type Road,
} from "./geography.ts";
import { freshwaterCrossingAt, naturalSurfaceAt } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  CANONICAL_PLANET_RADIUS,
  greatCircleDistance,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import { travelMetrics } from "./travel.ts";

/**
 * WP-S005-001-001 transport authority.
 *
 * The topology below is deliberately created once from Campaign-SEED registries.
 * Camera, LOD, renderer, worker order and cache state never participate.  The
 * exported geography `roads` array is replaced in place after geography has
 * finished constructing so older final-surface/routing consumers retain one
 * shared array identity while consuming this network instead of the prototype
 * village chains.
 */

export const TRANSPORT_LIMITS = Object.freeze({
  routeCandidates: 9,
  routeSampleSource: 12,
  routeControlPoints: 5,
  harborCountriesPerContinent: 6,
  harborBearings: 32,
  harborRadiiM: Object.freeze([8_000, 16_000, 28_000, 45_000, 70_000, 100_000]),
  internationalCandidates: 12,
  spatialBucketSource: 4096,
  queryRoadLimit: 160,
  ruralBridgeMaxM: 120,
});

export type TransportRoadClass = "main" | "regional" | "access" | "continuity";
export type TransportNodeKind = "capital" | "city" | "village" | "harbor";
export type TransportEdgeKind = "road" | "ferry";

export type TransportNode = Readonly<{
  code: string;
  sourceId: string;
  kind: TransportNodeKind;
  countryCode: string;
  continent: number;
  position: CanonicalPosition;
  x: number;
  z: number;
}>;

export type TransportBridge = Readonly<{
  code: string;
  roadCode: string;
  position: LonLat;
  x: number;
  z: number;
  spanM: number;
  drainageCode: string;
}>;

export type TransportBorderCrossing = Readonly<{
  code: string;
  roadCode: string;
  countries: readonly [string, string];
  position: LonLat;
  x: number;
  z: number;
}>;

export type TransportHarbor = Readonly<{
  code: string;
  nodeCode: string;
  countryCode: string;
  continent: number;
  position: CanonicalPosition;
  x: number;
  z: number;
  roadCode: string;
}>;

export type TransportCenterlinePoint = Readonly<{
  x: number;
  z: number;
  position: LonLat;
  elevationM: number;
}>;

export type TransportRoadEdge = Readonly<{
  code: string;
  kind: "road";
  roadClass: TransportRoadClass;
  from: string;
  to: string;
  countryCodes: readonly string[];
  centerline: readonly TransportCenterlinePoint[];
  bridgeCodes: readonly string[];
  borderCrossingCode: string | null;
  widthM: number;
  routeCandidate: number;
  terrainCost: number;
  maxNaturalReliefM: number;
}>;

export type TransportFerryEdge = Readonly<{
  code: string;
  kind: "ferry";
  from: string;
  to: string;
  fromHarborCode: string;
  toHarborCode: string;
  distanceM: number;
}>;

export type TransportJunction = Readonly<{
  code: string;
  nodeCode: string;
  position: CanonicalPosition;
  edgeCodes: readonly string[];
}>;

export type TransportNetwork = Readonly<{
  code: string;
  nodes: readonly TransportNode[];
  roadEdges: readonly TransportRoadEdge[];
  ferryEdges: readonly TransportFerryEdge[];
  bridges: readonly TransportBridge[];
  borderCrossings: readonly TransportBorderCrossing[];
  harbors: readonly TransportHarbor[];
  junctions: readonly TransportJunction[];
  digest: string;
}>;

type MutableNetwork = {
  nodes: TransportNode[];
  roadEdges: TransportRoadEdge[];
  ferryEdges: TransportFerryEdge[];
  bridges: TransportBridge[];
  borderCrossings: TransportBorderCrossing[];
  harbors: TransportHarbor[];
};

type RouteBuild = {
  points: TransportCenterlinePoint[];
  bridges: TransportBridge[];
  borderCrossing?: TransportBorderCrossing;
  candidate: number;
  cost: number;
  maxReliefM: number;
};

const TAU = Math.PI * 2;
const NETWORK_CODE = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/TRANSPORT`;

function digestNumber(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function countryKey(continent: number, id: number) {
  return `${continent}/${id}`;
}

const countriesByKey = new Map(countries.map((country) => [countryKey(country.continent, country.id), country]));
const countriesByCode = new Map(countries.map((country) => [country.code, country]));

function countryForPlace(place: Place) {
  const country = countriesByKey.get(countryKey(place.continent, place.country));
  if (!country) throw new Error(`Transport country missing for ${place.code}`);
  return country;
}

function destination(origin: LonLat, bearing: number, distanceRad: number): CanonicalPosition {
  const sinLat = Math.sin(origin.lat) * Math.cos(distanceRad) +
      Math.cos(origin.lat) * Math.sin(distanceRad) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(
      origin.lon + Math.atan2(
        Math.sin(bearing) * Math.sin(distanceRad) * Math.cos(origin.lat),
        Math.cos(distanceRad) - Math.sin(origin.lat) * Math.sin(lat),
      ),
    );
  return { lon, lat, elevation: 0 };
}

function nodeForPlace(place: Place, capital: boolean): TransportNode {
  const country = countryForPlace(place), source = lonLatToSource(place.canonicalPosition.lon, place.canonicalPosition.lat);
  return Object.freeze({
    code: `${NETWORK_CODE}/NODE/${place.code}`,
    sourceId: place.id,
    kind: place.kind === "village" ? "village" : capital ? "capital" : "city",
    countryCode: country.code,
    continent: place.continent,
    position: Object.freeze({ ...place.canonicalPosition }),
    x: source.x,
    z: source.z,
  });
}

function pathControls(from: TransportNode, to: TransportNode, candidate: number, address: string) {
  const dx = wrapSourceX(to.x - from.x), dz = to.z - from.z, length = Math.hypot(dx, dz) || 1,
    px = -dz / length, pz = dx / length,
    signSeed = (digestNumber(`${address}/SIDE`) & 1) === 0 ? 1 : -1,
    sign = candidate % 2 === 0 ? signSeed : -signSeed,
    strengthBand = Math.floor((candidate + 1) / 2),
    strength = candidate === 0 ? 0 : Math.min(0.3, 0.075 * strengthBand),
    offset = Math.min(length * strength, 3200),
    pattern = candidate <= 4 ? [0, 0.55, 1, 0, 0] : candidate <= 6 ? [0, 0.4, 0.8, 0.4, 0] : [0, 0.65, -0.35, 0.45, 0];
  return pattern.map((factor, index) => {
    const t = index / (pattern.length - 1), amount = factor * offset * sign;
    return { x: from.x + dx * t + px * amount, z: from.z + dz * t + pz * amount };
  });
}

function samplePolyline(controls: readonly { x: number; z: number }[], stepSource = TRANSPORT_LIMITS.routeSampleSource) {
  const samples: { x: number; z: number; segment: number; t: number }[] = [];
  for (let segment = 0; segment < controls.length - 1; segment++) {
    const a = controls[segment], b = controls[segment + 1], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
      length = Math.hypot(dx, dz), count = Math.max(1, Math.ceil(length / stepSource));
    for (let index = segment === 0 ? 0 : 1; index <= count; index++) {
      const t = index / count;
      samples.push({ x: a.x + dx * t, z: a.z + dz * t, segment, t });
    }
  }
  return samples;
}

function polylineLengthSource(points: readonly { x: number; z: number }[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(wrapSourceX(points[i].x - points[i - 1].x), points[i].z - points[i - 1].z);
  return total;
}

function borderCrossingFor(
  roadCode: string,
  samples: readonly { x: number; z: number }[],
  fromCountry: Country,
  toCountry: Country,
): TransportBorderCrossing | undefined {
  let previous = countryAtPosition(sourceToLonLat(samples[0].x, samples[0].z));
  for (let i = 1; i < samples.length; i++) {
    const current = countryAtPosition(sourceToLonLat(samples[i].x, samples[i].z));
    if (!previous || !current || previous.code === current.code) {
      previous = current;
      continue;
    }
    if (!([previous.code, current.code].includes(fromCountry.code) && [previous.code, current.code].includes(toCountry.code))) return undefined;
    let a = samples[i - 1], b = samples[i];
    for (let iteration = 0; iteration < 24; iteration++) {
      const mx = a.x + wrapSourceX(b.x - a.x) * 0.5, mz = (a.z + b.z) * 0.5,
        owner = countryAtPosition(sourceToLonLat(mx, mz));
      if (owner?.code === previous.code) a = { ...a, x: mx, z: mz };
      else b = { ...b, x: mx, z: mz };
    }
    const x = a.x + wrapSourceX(b.x - a.x) * 0.5, z = (a.z + b.z) * 0.5,
      position = sourceToLonLat(x, z);
    return Object.freeze({
      code: `${roadCode}/BORDER/${[fromCountry.code, toCountry.code].sort().join("--")}`,
      roadCode,
      countries: Object.freeze([fromCountry.code, toCountry.code].sort() as [string, string]),
      position: Object.freeze(position),
      x: wrapSourceX(x),
      z,
    });
  }
  return undefined;
}

function routeCandidate(
  roadCode: string,
  from: TransportNode,
  to: TransportNode,
  candidate: number,
  allowedCountries: readonly string[],
  requireBorder: boolean,
): RouteBuild | undefined {
  const controls = pathControls(from, to, candidate, roadCode), samples = samplePolyline(controls);
  if (samples.length < 2) return undefined;
  let cost = polylineLengthSource(controls) * CANONICAL_METRES_PER_SOURCE_UNIT,
    maxReliefM = 0,
    previousHeight: number | undefined,
    previousPosition: LonLat | undefined;
  const bridgesByDrainage = new Map<string, TransportBridge>();
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index], position = sourceToLonLat(sample.x, sample.z), macro = macroSampleAt(position), natural = naturalSurfaceAt(sample.x, sample.z), owner = countryAtPosition(position);
    if (!macro.land || macro.domain === "Lake" || macro.domain === "Ocean" || natural.water.kind === "lake" || natural.water.kind === "ocean") return undefined;
    if (!owner || !allowedCountries.includes(owner.code)) return undefined;
    const relief = Math.max(0, macro.reliefM), terrainHeight = natural.groundHeight;
    maxReliefM = Math.max(maxReliefM, relief);
    cost += relief * 1.7 + (natural.cliff ? 80_000 : natural.slope * 15_000);
    if (previousHeight !== undefined && previousPosition) {
      const runM = Math.max(1, greatCircleDistance(previousPosition, position)), grade = Math.abs(terrainHeight - previousHeight) / runM;
      cost += Math.max(0, grade - 0.06) * 180_000;
    }
    if (natural.water.kind === "river" || natural.material === "Riverbank") {
      const segment = Math.min(controls.length - 2, sample.segment), a = controls[segment], b = controls[segment + 1],
        crossing = freshwaterCrossingAt(sample.x, sample.z, wrapSourceX(b.x - a.x), b.z - a.z);
      if (natural.water.kind === "river" && !crossing) return undefined;
      if (crossing && !bridgesByDrainage.has(crossing.code)) {
        if (crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM) return undefined;
        bridgesByDrainage.set(crossing.code, Object.freeze({
          code: `${roadCode}/BRIDGE/${bridgesByDrainage.size}`,
          roadCode,
          position: Object.freeze(position),
          x: wrapSourceX(sample.x),
          z: sample.z,
          spanM: crossing.spanM,
          drainageCode: crossing.code,
        }));
        cost += 4_000 + crossing.spanM * 45;
      }
    }
    previousHeight = terrainHeight;
    previousPosition = position;
  }

  const fromCountry = countriesByCode.get(from.countryCode), toCountry = countriesByCode.get(to.countryCode);
  let borderCrossing: TransportBorderCrossing | undefined;
  if (requireBorder) {
    if (!fromCountry || !toCountry || fromCountry.code === toCountry.code) return undefined;
    borderCrossing = borderCrossingFor(roadCode, samples, fromCountry, toCountry);
    if (!borderCrossing) return undefined;
  }

  const points = controls.map(({ x, z }) => {
    const position = sourceToLonLat(x, z), natural = naturalSurfaceAt(x, z);
    return Object.freeze({ x: wrapSourceX(x), z, position: Object.freeze(position), elevationM: natural.groundHeight });
  });
  return { points, bridges: [...bridgesByDrainage.values()], borderCrossing, candidate, cost, maxReliefM };
}

function buildRoute(
  roadCode: string,
  from: TransportNode,
  to: TransportNode,
  allowedCountries: readonly string[],
  requireBorder = false,
): RouteBuild {
  let best: RouteBuild | undefined;
  for (let candidate = 0; candidate < TRANSPORT_LIMITS.routeCandidates; candidate++) {
    const route = routeCandidate(roadCode, from, to, candidate, allowedCountries, requireBorder);
    if (!route) continue;
    if (!best || route.cost < best.cost - 1e-7 || (Math.abs(route.cost - best.cost) <= 1e-7 && route.candidate < best.candidate)) best = route;
  }
  if (!best) throw new Error(`No legal deterministic transport route for ${roadCode}`);
  return best;
}

function roadWidth(roadClass: TransportRoadClass) {
  if (roadClass === "main") return 8;
  if (roadClass === "regional") return 6;
  return 5;
}

function addRoad(
  state: MutableNetwork,
  from: TransportNode,
  to: TransportNode,
  roadClass: TransportRoadClass,
  suffix: string,
  requireBorder = false,
) {
  const countryCodes = from.countryCode === to.countryCode ? [from.countryCode] : [from.countryCode, to.countryCode].sort(),
    code = `${NETWORK_CODE}/ROAD/${roadClass.toUpperCase()}/${suffix}`,
    route = buildRoute(code, from, to, countryCodes, requireBorder),
    edge: TransportRoadEdge = Object.freeze({
      code,
      kind: "road",
      roadClass,
      from: from.code,
      to: to.code,
      countryCodes: Object.freeze(countryCodes),
      centerline: Object.freeze(route.points),
      bridgeCodes: Object.freeze(route.bridges.map((bridge) => bridge.code)),
      borderCrossingCode: route.borderCrossing?.code ?? null,
      widthM: roadWidth(roadClass),
      routeCandidate: route.candidate,
      terrainCost: route.cost,
      maxNaturalReliefM: route.maxReliefM,
    });
  state.roadEdges.push(edge);
  state.bridges.push(...route.bridges);
  if (route.borderCrossing) state.borderCrossings.push(route.borderCrossing);
  return edge;
}

function capitalFor(country: Country) {
  const capital = cities.find((city) => city.continent === country.continent && city.country === country.id && city.city === 0);
  if (!capital) throw new Error(`Capital missing for ${country.code}`);
  return capital;
}

function politicalSequence(from: TransportNode, to: TransportNode) {
  const controls = pathControls(from, to, 0, `${from.code}/${to.code}/NEIGHBOR`), samples = samplePolyline(controls, 40), sequence: string[] = [];
  for (const sample of samples) {
    const owner = countryAtPosition(sourceToLonLat(sample.x, sample.z));
    if (!owner) return [];
    if (sequence.at(-1) !== owner.code) sequence.push(owner.code);
  }
  return sequence;
}

function neighboringCapital(stateNodes: readonly TransportNode[], country: Country) {
  const from = stateNodes.find((node) => node.kind === "capital" && node.countryCode === country.code)!;
  const candidates = countries
    .filter((candidate) => candidate.continent === country.continent && candidate.code !== country.code)
    .map((candidate) => ({ candidate, distance: greatCircleDistance(from.position, capitalFor(candidate).canonicalPosition) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.code.localeCompare(b.candidate.code))
    .slice(0, TRANSPORT_LIMITS.internationalCandidates);
  for (const { candidate } of candidates) {
    const to = stateNodes.find((node) => node.kind === "capital" && node.countryCode === candidate.code)!;
    const sequence = politicalSequence(from, to);
    if (sequence.length === 2 && sequence[0] === country.code && sequence[1] === candidate.code) return candidate;
  }
  throw new Error(`No legal land-neighbor capital found for ${country.code}`);
}

function harborCandidates(continent: number) {
  const orderedCountries = countries
    .filter((country) => country.continent === continent)
    .map((country) => ({ country, coastM: macroSampleAt(country.canonicalPosition).coastDistanceRad * CANONICAL_PLANET_RADIUS }))
    .sort((a, b) => a.coastM - b.coastM || a.country.code.localeCompare(b.country.code))
    .slice(0, TRANSPORT_LIMITS.harborCountriesPerContinent);
  const candidates: { country: Country; position: CanonicalPosition; score: number }[] = [];
  for (const { country } of orderedCountries) {
    const start = (digestNumber(`${NETWORK_CODE}/HARBOR/${country.code}`) / 4294967296) * TAU;
    for (const radiusM of TRANSPORT_LIMITS.harborRadiiM)
      for (let bearingIndex = 0; bearingIndex < TRANSPORT_LIMITS.harborBearings; bearingIndex++) {
        const bearing = start + bearingIndex / TRANSPORT_LIMITS.harborBearings * TAU,
          position = destination(country.canonicalPosition, bearing, radiusM / CANONICAL_PLANET_RADIUS),
          macro = macroSampleAt(position), owner = countryAtPosition(position), source = lonLatToSource(position.lon, position.lat), natural = naturalSurfaceAt(source.x, source.z),
          coastM = macro.coastDistanceRad * CANONICAL_PLANET_RADIUS;
        if (!owner || owner.code !== country.code || !macro.land || macro.domain !== "Mainland" || natural.water.kind !== "none" || coastM < 350 || coastM > 8_000) continue;
        candidates.push({ country, position, score: coastM + radiusM * 0.025 });
      }
  }
  return candidates.sort((a, b) => a.score - b.score || a.country.code.localeCompare(b.country.code));
}

function addHarbor(state: MutableNetwork, continent: number, capitalNodes: readonly TransportNode[]) {
  for (const candidate of harborCandidates(continent)) {
    const capital = capitalNodes.find((node) => node.countryCode === candidate.country.code)!;
    if (!capital) continue;
    const source = lonLatToSource(candidate.position.lon, candidate.position.lat), harborNode: TransportNode = Object.freeze({
      code: `${NETWORK_CODE}/NODE/HARBOR/${continent}`,
      sourceId: `harbor-${continent}`,
      kind: "harbor",
      countryCode: candidate.country.code,
      continent,
      position: Object.freeze({ ...candidate.position }),
      x: source.x,
      z: source.z,
    });
    try {
      state.nodes.push(harborNode);
      const road = addRoad(state, capital, harborNode, "main", `HARBOR/${continent}`), harbor: TransportHarbor = Object.freeze({
        code: `${NETWORK_CODE}/HARBOR/${continent}`,
        nodeCode: harborNode.code,
        countryCode: candidate.country.code,
        continent,
        position: harborNode.position,
        x: harborNode.x,
        z: harborNode.z,
        roadCode: road.code,
      });
      state.harbors.push(harbor);
      return harbor;
    } catch {
      state.nodes.pop();
    }
  }
  throw new Error(`No deterministic road-linked harbor for continent ${continent}`);
}

function edgePairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function networkDigest(state: MutableNetwork) {
  const pieces = [
    ...state.nodes.map((node) => `N:${node.code}:${node.position.lon.toFixed(9)}:${node.position.lat.toFixed(9)}`),
    ...state.roadEdges.map((edge) => `R:${edge.code}:${edge.from}:${edge.to}:${edge.routeCandidate}:${edge.centerline.map((point) => `${point.x.toFixed(4)},${point.z.toFixed(4)},${point.elevationM.toFixed(3)}`).join(";")}`),
    ...state.ferryEdges.map((edge) => `F:${edge.code}:${edge.from}:${edge.to}:${edge.distanceM.toFixed(3)}`),
    ...state.bridges.map((bridge) => `B:${bridge.code}:${bridge.x.toFixed(4)}:${bridge.z.toFixed(4)}:${bridge.spanM.toFixed(3)}`),
    ...state.borderCrossings.map((crossing) => `X:${crossing.code}:${crossing.x.toFixed(4)}:${crossing.z.toFixed(4)}`),
  ].sort();
  return digestNumber(pieces.join("\n")).toString(16).padStart(8, "0");
}

export function buildTransportNetwork(): TransportNetwork {
  const state: MutableNetwork = { nodes: [], roadEdges: [], ferryEdges: [], bridges: [], borderCrossings: [], harbors: [] },
    capitalPlaceCodes = new Set(countries.map((country) => capitalFor(country).code));
  for (const city of cities) state.nodes.push(nodeForPlace(city, capitalPlaceCodes.has(city.code)));
  for (const village of villages) state.nodes.push(nodeForPlace(village, false));
  const nodeBySourceId = new Map(state.nodes.map((node) => [node.sourceId, node]));

  // Each village gets one canonical access road to its city.  All approaches
  // therefore meet at the same city node instead of merely crossing on screen.
  for (const village of villages) {
    const cityId = village.id.split("/").slice(0, 3).join("/"), from = nodeBySourceId.get(village.id)!, to = nodeBySourceId.get(cityId)!;
    addRoad(state, from, to, "access", `VILLAGE/${village.code}`);
  }

  // One country backbone: every non-capital city joins its capital.
  for (const country of countries) {
    const localCities = cities.filter((city) => city.continent === country.continent && city.country === country.id).sort((a, b) => a.city - b.city),
      capital = nodeBySourceId.get(localCities[0].id)!;
    for (const city of localCities.slice(1)) addRoad(state, nodeBySourceId.get(city.id)!, capital, "regional", `COUNTRY/${country.code}/CITY/${city.city}`);
  }

  // Every country selects a real adjacent country by the political ownership
  // sequence of the direct capital corridor.  Pair de-duplication preserves at
  // least one international main-road incident on every selecting country.
  const internationalPairs = new Set<string>();
  for (const country of countries) {
    const neighbor = neighboringCapital(state.nodes, country), pair = edgePairKey(country.code, neighbor.code);
    if (internationalPairs.has(pair)) continue;
    internationalPairs.add(pair);
    const from = state.nodes.find((node) => node.kind === "capital" && node.countryCode === country.code)!,
      to = state.nodes.find((node) => node.kind === "capital" && node.countryCode === neighbor.code)!;
    addRoad(state, from, to, "main", `CAPITAL/${country.code}--${neighbor.code}`, true);
  }

  const capitalNodes = state.nodes.filter((node) => node.kind === "capital");
  for (const continent of [...new Set(countries.map((country) => country.continent))].sort((a, b) => a - b)) addHarbor(state, continent, capitalNodes);

  // The three continent harbors form a deterministic minimum spanning chain by
  // Kruskal over geodesic ferry cost.  Ferry edges never enter geography roads.
  const ferryCandidates: { a: TransportHarbor; b: TransportHarbor; distanceM: number }[] = [];
  for (let i = 0; i < state.harbors.length; i++) for (let j = i + 1; j < state.harbors.length; j++) ferryCandidates.push({ a: state.harbors[i], b: state.harbors[j], distanceM: greatCircleDistance(state.harbors[i].position, state.harbors[j].position) });
  ferryCandidates.sort((a, b) => a.distanceM - b.distanceM || edgePairKey(a.a.code, a.b.code).localeCompare(edgePairKey(b.a.code, b.b.code)));
  const parent = new Map(state.harbors.map((harbor) => [harbor.code, harbor.code]));
  const root = (code: string): string => { const p = parent.get(code)!; if (p === code) return code; const r = root(p); parent.set(code, r); return r; };
  for (const candidate of ferryCandidates) {
    const ar = root(candidate.a.code), br = root(candidate.b.code);
    if (ar === br) continue;
    parent.set(ar, br);
    const code = `${NETWORK_CODE}/FERRY/${candidate.a.continent}--${candidate.b.continent}`;
    state.ferryEdges.push(Object.freeze({ code, kind: "ferry", from: candidate.a.nodeCode, to: candidate.b.nodeCode, fromHarborCode: candidate.a.code, toHarborCode: candidate.b.code, distanceM: candidate.distanceM }));
    if (state.ferryEdges.length === Math.max(0, state.harbors.length - 1)) break;
  }

  const incident = new Map<string, string[]>();
  for (const edge of [...state.roadEdges, ...state.ferryEdges]) for (const nodeCode of [edge.from, edge.to]) {
    const list = incident.get(nodeCode) ?? [];
    list.push(edge.code);
    incident.set(nodeCode, list);
  }
  const junctions = state.nodes.flatMap((node) => {
    const edges = [...(incident.get(node.code) ?? [])].sort();
    return edges.filter((code) => state.roadEdges.some((edge) => edge.code === code)).length >= 3
      ? [Object.freeze({ code: `${NETWORK_CODE}/JUNCTION/${node.code}`, nodeCode: node.code, position: node.position, edgeCodes: Object.freeze(edges) })]
      : [];
  });

  const digest = networkDigest(state);
  return Object.freeze({
    code: NETWORK_CODE,
    nodes: Object.freeze(state.nodes),
    roadEdges: Object.freeze(state.roadEdges),
    ferryEdges: Object.freeze(state.ferryEdges),
    bridges: Object.freeze(state.bridges),
    borderCrossings: Object.freeze(state.borderCrossings),
    harbors: Object.freeze(state.harbors),
    junctions: Object.freeze(junctions),
    digest,
  });
}

export const transportNetwork = buildTransportNetwork();

function roadSurfaceRecord(edge: TransportRoadEdge): Road {
  const from = transportNetwork.nodes.find((node) => node.code === edge.from)!, to = transportNetwork.nodes.find((node) => node.code === edge.to)!,
    first = edge.centerline[0], last = edge.centerline[edge.centerline.length - 1], dx = wrapSourceX(last.x - first.x), toX = first.x + dx,
    xs = edge.centerline.map((point) => first.x + wrapSourceX(point.x - first.x)), zs = edge.centerline.map((point) => point.z),
    surfaceLengthM = edge.centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(edge.centerline[index].position, point.position), 0),
    travel = travelMetrics(surfaceLengthM, "good-road"), presentationLengthSourceUnits = polylineLengthSource(edge.centerline);
  return {
    code: edge.code,
    from: from.sourceId,
    to: to.sourceId,
    fromX: first.x,
    toX,
    fromZ: first.z,
    toZ: last.z,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    z: (first.z + last.z) / 2,
    fromPosition: from.position,
    toPosition: to.position,
    presentationLengthSourceUnits,
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: edge.centerline.map((point) => ({ x: point.x, z: point.z, position: point.position })),
  };
}

export const transportSurfaceRoads: readonly Road[] = Object.freeze(transportNetwork.roadEdges.map(roadSurfaceRecord));

// Preserve the S003 cross-region lake-detour proof as one connected regional
// route.  It joins existing village nodes and remains subject to the same final
// surface authority; it is not a second transport graph.
const continuityRoad = continuityCorridor.road;
const installedRoads = continuityRoad ? [...transportSurfaceRoads, continuityRoad] : [...transportSurfaceRoads];
geographyRoads.splice(0, geographyRoads.length, ...(installedRoads as Road[]));

const transportBuckets = new Map<string, TransportRoadEdge[]>();
const bucketKey = (x: number, z: number) => `${Math.floor(wrapSourceX(x) / TRANSPORT_LIMITS.spatialBucketSource)}/${Math.floor(z / TRANSPORT_LIMITS.spatialBucketSource)}`;
for (const edge of transportNetwork.roadEdges) {
  const road = roadSurfaceRecord(edge), cx = (road.minX + road.maxX) * 0.5, cz = (road.minZ + road.maxZ) * 0.5,
    key = bucketKey(cx, cz), bucket = transportBuckets.get(key) ?? [];
  bucket.push(edge);
  transportBuckets.set(key, bucket);
}
for (const bucket of transportBuckets.values()) bucket.sort((a, b) => a.code.localeCompare(b.code));

/** Focus-bounded presentation query; visibility never changes canonical topology. */
export function transportRoadsNear(x: number, z: number, radiusSource: number, limit = TRANSPORT_LIMITS.queryRoadLimit) {
  if (!Number.isFinite(radiusSource) || radiusSource <= 0 || radiusSource > 16_384) throw new RangeError("Transport road query radius outside bounded presentation support");
  const reach = Math.ceil(radiusSource / TRANSPORT_LIMITS.spatialBucketSource), bx = Math.floor(wrapSourceX(x) / TRANSPORT_LIMITS.spatialBucketSource), bz = Math.floor(z / TRANSPORT_LIMITS.spatialBucketSource), found = new Map<string, TransportRoadEdge>();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const bucket = transportBuckets.get(`${bx + dx}/${bz + dz}`) ?? [];
    for (const edge of bucket) {
      const nearest = Math.min(...edge.centerline.map((point) => Math.hypot(wrapSourceX(point.x - x), point.z - z)));
      if (nearest <= radiusSource) found.set(edge.code, edge);
    }
  }
  return Object.freeze([...found.values()].sort((a, b) => a.code.localeCompare(b.code)).slice(0, Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit))));
}

export function transportAcceptanceSummary() {
  const roadDegree = new Map<string, number>();
  for (const edge of transportNetwork.roadEdges) for (const nodeCode of [edge.from, edge.to]) roadDegree.set(nodeCode, (roadDegree.get(nodeCode) ?? 0) + 1);
  const mandatory = transportNetwork.nodes.filter((node) => node.kind === "capital" || node.kind === "city" || node.kind === "village"),
    uncovered = mandatory.filter((node) => !roadDegree.get(node.code));
  return Object.freeze({
    code: transportNetwork.code,
    digest: transportNetwork.digest,
    countries: countries.length,
    cities: cities.length,
    villages: villages.length,
    mandatoryNodes: mandatory.length,
    uncoveredNodeCodes: Object.freeze(uncovered.map((node) => node.code)),
    roads: transportNetwork.roadEdges.length,
    ferries: transportNetwork.ferryEdges.length,
    junctions: transportNetwork.junctions.length,
    bridges: transportNetwork.bridges.length,
    borderCrossings: transportNetwork.borderCrossings.length,
    harbors: transportNetwork.harbors.length,
    mainRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "main").length,
    regionalRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "regional").length,
    accessRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "access").length,
    limits: TRANSPORT_LIMITS,
  });
}
