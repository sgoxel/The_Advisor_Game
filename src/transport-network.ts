import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  cities,
  continuityCorridor,
  countries,
  countryAtPosition,
  roadJunctions,
  roads as geographyRoads,
  villages,
  type Country,
  type Place,
  type Road,
} from "./geography.ts";
import {
  drainageCoarseSegments,
  freshwaterCrossingAt,
  naturalSurfaceAt,
  type DrainageSegment,
} from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import { politicalBorderGateways, type PoliticalBorderGateway } from "./political-settlement-access.ts";
import { canonicalRoadBucketCells } from "./road-spatial-index.ts";
import { travelMetrics } from "./travel.ts";

/**
 * S005 transport authority.
 *
 * Domestic physical roads and their real shared Y junctions are the already-tested
 * seeded macro road authority from geography.ts. This layer does not regenerate or
 * replace those roads. It assigns graph semantics to the same records, adds only the
 * missing international/harbor links, derives explicit bridge/border/ferry records,
 * and installs those added roads into the shared geography array before world.ts
 * builds its final-surface road index.
 */

export const TRANSPORT_LIMITS = Object.freeze({
  internationalNodeCandidates: 32,
  corridorSampleM: 5_000,
  harborCountriesPerContinent: 6,
  harborBearings: 32,
  harborRadiiM: Object.freeze([8_000, 16_000, 28_000, 45_000, 70_000, 100_000]),
  spatialBucketSource: 4096,
  waterBucketSource: 8192,
  queryRoadLimit: 160,
  ruralBridgeMaxM: 120,
});

export type TransportRoadClass = "main" | "regional" | "access" | "continuity";
export type TransportNodeKind = "capital" | "city" | "village" | "junction" | "harbor";
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

type MutableRoadEdge = Omit<TransportRoadEdge, "bridgeCodes" | "centerline" | "countryCodes"> & {
  centerline: TransportCenterlinePoint[];
  countryCodes: string[];
  bridgeCodes: string[];
};
type MutableNetwork = {
  nodes: TransportNode[];
  roadEdges: MutableRoadEdge[];
  ferryEdges: TransportFerryEdge[];
  bridges: TransportBridge[];
  borderCrossings: TransportBorderCrossing[];
  harbors: TransportHarbor[];
};

const NETWORK_CODE = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/TRANSPORT`;
const TAU = Math.PI * 2;
const countriesByKey = new Map(countries.map((country) => [`${country.continent}/${country.id}`, country]));
const countriesByCode = new Map(countries.map((country) => [country.code, country]));

function digestNumber(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function destination(origin: LonLat, bearing: number, distanceM: number): CanonicalPosition {
  const angular = distanceM / CANONICAL_PLANET_RADIUS,
    sinLat = Math.sin(origin.lat) * Math.cos(angular) + Math.cos(origin.lat) * Math.sin(angular) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(origin.lon + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(origin.lat),
      Math.cos(angular) - Math.sin(origin.lat) * Math.sin(lat),
    ));
  return { lon, lat, elevation: 0 };
}

function initialBearing(from: LonLat, to: LonLat) {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  return Math.atan2(
    Math.sin(deltaLon) * Math.cos(to.lat),
    Math.cos(from.lat) * Math.sin(to.lat) - Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(deltaLon),
  );
}

function interpolate(from: LonLat, to: LonLat, t: number) {
  return destination(from, initialBearing(from, to), greatCircleDistance(from, to) * Math.max(0, Math.min(1, t)));
}

function countryForPlace(place: Place) {
  const country = countriesByKey.get(`${place.continent}/${place.country}`);
  if (!country) throw new Error(`Transport country missing for ${place.code}`);
  return country;
}

function nodeForPlace(place: Place): TransportNode {
  const country = countryForPlace(place), source = lonLatToSource(place.canonicalPosition.lon, place.canonicalPosition.lat),
    capital = place.kind === "city" && place.city === 0;
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

function nodeForJunction(junction: (typeof roadJunctions)[number]): TransportNode {
  const country = countriesByKey.get(`${junction.continent}/${junction.country}`);
  if (!country) throw new Error(`Transport country missing for junction ${junction.code}`);
  return Object.freeze({
    code: `${NETWORK_CODE}/NODE/${junction.code}`,
    sourceId: junction.id,
    kind: "junction",
    countryCode: country.code,
    continent: junction.continent,
    position: Object.freeze({ ...junction.canonicalPosition }),
    x: junction.x,
    z: junction.z,
  });
}

function centerlineFromPositions(positions: readonly LonLat[]) {
  let previousX: number | undefined;
  return positions.map((position) => {
    const source = lonLatToSource(position.lon, position.lat),
      x = previousX === undefined ? source.x : previousX + wrapSourceX(source.x - previousX),
      natural = naturalSurfaceAt(x, source.z);
    previousX = x;
    return {
      x,
      z: source.z,
      position: Object.freeze({ lon: position.lon, lat: position.lat }),
      elevationM: natural.groundHeight,
    } satisfies TransportCenterlinePoint;
  });
}

function centerlineFromRoad(road: Road) {
  const points = road.centerline ?? [
    { x: road.fromX, z: road.fromZ, position: road.fromPosition },
    { x: road.toX, z: road.toZ, position: road.toPosition },
  ];
  let previousX: number | undefined;
  return points.map((point) => {
    const x = previousX === undefined ? point.x : previousX + wrapSourceX(point.x - previousX), natural = naturalSurfaceAt(x, point.z);
    previousX = x;
    return {
      x,
      z: point.z,
      position: Object.freeze({ lon: point.position.lon, lat: point.position.lat }),
      elevationM: natural.groundHeight,
    } satisfies TransportCenterlinePoint;
  });
}

function roadWidth(roadClass: TransportRoadClass) {
  if (roadClass === "main") return 8;
  if (roadClass === "regional") return 6;
  return 5;
}

function roadClassFor(road: Road, from: TransportNode, to: TransportNode): TransportRoadClass {
  if (continuityCorridor.road?.code === road.code) return "continuity";
  if (road.networkKind === "trunk") return "regional";
  if (from.kind === "village" || to.kind === "village") return "access";
  return "regional";
}

function maxRelief(points: readonly TransportCenterlinePoint[]) {
  let result = 0;
  for (const point of points) result = Math.max(result, macroSampleAt(point.position).reliefM);
  return result;
}

function baseRoadEdge(road: Road, nodeBySourceId: ReadonlyMap<string, TransportNode>): MutableRoadEdge {
  const from = nodeBySourceId.get(road.from), to = nodeBySourceId.get(road.to);
  if (!from || !to) throw new Error(`Transport endpoint missing for ${road.code}: ${road.from} -> ${road.to}`);
  const centerline = centerlineFromRoad(road), roadClass = roadClassFor(road, from, to);
  return {
    code: road.code,
    kind: "road",
    roadClass,
    from: from.code,
    to: to.code,
    countryCodes: [...new Set([from.countryCode, to.countryCode])].sort(),
    centerline,
    bridgeCodes: [],
    borderCrossingCode: null,
    widthM: roadWidth(roadClass),
    routeCandidate: 0,
    terrainCost: road.surfaceLengthM,
    maxNaturalReliefM: maxRelief(centerline),
  };
}

function segmentOwnedDry(from: LonLat, to: LonLat, countryCode: string) {
  const distanceM = greatCircleDistance(from, to), steps = Math.max(2, Math.ceil(distanceM / TRANSPORT_LIMITS.corridorSampleM));
  for (let index = 0; index <= steps; index++) {
    const point = interpolate(from, to, index / steps), macro = macroSampleAt(point), owner = countryAtPosition(point);
    if (!macro.land || macro.domain === "Lake" || macro.domain === "Ocean" || owner?.code !== countryCode) return false;
  }
  return true;
}

function gatewayCrossing(gateway: PoliticalBorderGateway, roadCode: string): TransportBorderCrossing | undefined {
  let a = gateway.inside, b = gateway.outside, ownerA = countryAtPosition(a), ownerB = countryAtPosition(b);
  if (!ownerA || !ownerB || ownerA.code === ownerB.code) return undefined;
  if (![ownerA.code, ownerB.code].includes(gateway.countryCode) || ![ownerA.code, ownerB.code].includes(gateway.neighbourCountryCode)) return undefined;
  for (let iteration = 0; iteration < 24; iteration++) {
    const mid = interpolate(a, b, 0.5), owner = countryAtPosition(mid);
    if (owner?.code === ownerA.code) a = mid;
    else b = mid;
  }
  const position = interpolate(a, b, 0.5), source = lonLatToSource(position.lon, position.lat), countriesPair = [gateway.countryCode, gateway.neighbourCountryCode].sort() as [string, string];
  return Object.freeze({
    code: `${roadCode}/BORDER/${countriesPair.join("--")}`,
    roadCode,
    countries: Object.freeze(countriesPair),
    position: Object.freeze({ lon: position.lon, lat: position.lat }),
    x: source.x,
    z: source.z,
  });
}

const waterBuckets = new Map<string, DrainageSegment[]>();
const waterBucketKey = (x: number, z: number) => `${x}/${z}`;
for (const segment of drainageCoarseSegments) {
  const path = { fromX: segment.ax, fromZ: segment.az, toX: segment.bx, toZ: segment.bz };
  for (const [x, z] of canonicalRoadBucketCells(path, TRANSPORT_LIMITS.waterBucketSource, segment.width, SOURCE_PRESENTATION_WIDTH)) {
    const key = waterBucketKey(x, z), list = waterBuckets.get(key) ?? [];
    list.push(segment);
    waterBuckets.set(key, list);
  }
}
for (const list of waterBuckets.values()) list.sort((a, b) => a.code.localeCompare(b.code));

function crossingPoint(a: TransportCenterlinePoint, b: TransportCenterlinePoint, stream: DrainageSegment) {
  const rx = wrapSourceX(b.x - a.x), rz = b.z - a.z,
    sx0 = a.x + wrapSourceX(stream.ax - a.x), sz0 = stream.az,
    sx = wrapSourceX(stream.bx - stream.ax), sz = stream.bz - stream.az,
    qx = sx0 - a.x, qz = sz0 - a.z, denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = (qx * sz - qz * sx) / denominator, u = (qx * rz - qz * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + rx * t, z: a.z + rz * t, roadX: rx, roadZ: rz };
}

function bridgeScan(roadCode: string, centerline: readonly TransportCenterlinePoint[]) {
  const found = new Map<string, TransportBridge>();
  let invalid = 0;
  for (let index = 1; index < centerline.length; index++) {
    const a = centerline[index - 1], b = centerline[index], path = { fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z }, candidates = new Map<string, DrainageSegment>();
    for (const [bx, bz] of canonicalRoadBucketCells(path, TRANSPORT_LIMITS.waterBucketSource, 0, SOURCE_PRESENTATION_WIDTH))
      for (const stream of waterBuckets.get(waterBucketKey(bx, bz)) ?? []) candidates.set(stream.code, stream);
    for (const stream of candidates.values()) {
      const hit = crossingPoint(a, b, stream);
      if (!hit) continue;
      const surface = naturalSurfaceAt(hit.x, hit.z);
      if (surface.water.kind !== "river") continue;
      const crossing = freshwaterCrossingAt(hit.x, hit.z, hit.roadX, hit.roadZ);
      if (!crossing || crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM) {
        invalid++;
        continue;
      }
      const identity = `${crossing.code}/${hit.x.toFixed(3)}/${hit.z.toFixed(3)}`;
      if (found.has(identity)) continue;
      const position = sourceToLonLat(hit.x, hit.z), bridge: TransportBridge = Object.freeze({
        code: `${roadCode}/BRIDGE/${found.size}`,
        roadCode,
        position: Object.freeze(position),
        x: wrapSourceX(hit.x),
        z: hit.z,
        spanM: crossing.spanM,
        drainageCode: crossing.code,
      });
      found.set(identity, bridge);
    }
  }
  return { bridges: [...found.values()], invalid };
}

function attachBridges(state: MutableNetwork, edge: MutableRoadEdge, strict = true) {
  const scan = bridgeScan(edge.code, edge.centerline);
  if (strict && scan.invalid) throw new Error(`Illegal unbridged freshwater crossing on ${edge.code}: ${scan.invalid}`);
  edge.bridgeCodes = scan.bridges.map((bridge) => bridge.code);
  state.bridges.push(...scan.bridges);
  return scan.invalid === 0;
}

function routeEdge(
  from: TransportNode,
  to: TransportNode,
  roadClass: TransportRoadClass,
  code: string,
  positions: readonly LonLat[],
  countryCodes: readonly string[],
  borderCrossingCode: string | null,
  routeCandidate: number,
): MutableRoadEdge {
  const centerline = centerlineFromPositions(positions), surfaceLengthM = centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(centerline[index].position, point.position), 0);
  return {
    code,
    kind: "road",
    roadClass,
    from: from.code,
    to: to.code,
    countryCodes: [...countryCodes],
    centerline,
    bridgeCodes: [],
    borderCrossingCode,
    widthM: roadWidth(roadClass),
    routeCandidate,
    terrainCost: surfaceLengthM + maxRelief(centerline) * 100,
    maxNaturalReliefM: maxRelief(centerline),
  };
}

function capitalNode(state: MutableNetwork, country: Country) {
  const node = state.nodes.find((candidate) => candidate.kind === "capital" && candidate.countryCode === country.code);
  if (!node) throw new Error(`Capital transport node missing for ${country.code}`);
  return node;
}

function addInternationalRoads(state: MutableNetwork) {
  const baseNodes = state.nodes.filter((node) => node.kind !== "harbor");
  for (const country of countries) {
    const gateway = politicalBorderGateways.find((candidate) => candidate.countryCode === country.code);
    if (!gateway) throw new Error(`Canonical border gateway missing for ${country.code}`);
    const from = capitalNode(state, country), crossingCodeBase = `${NETWORK_CODE}/ROAD/MAIN/CAPITAL/${country.code}--${gateway.neighbourCountryCode}`,
      crossing = gatewayCrossing(gateway, crossingCodeBase);
    if (!crossing) throw new Error(`Canonical gateway crossing invalid for ${gateway.id}`);
    const targets = baseNodes
      .filter((node) => node.countryCode === gateway.neighbourCountryCode)
      .map((node) => ({ node, distanceM: greatCircleDistance(gateway.outside, node.position) }))
      .sort((a, b) => a.distanceM - b.distanceM || a.node.code.localeCompare(b.node.code))
      .slice(0, TRANSPORT_LIMITS.internationalNodeCandidates);
    let accepted = false;
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index].node;
      if (!segmentOwnedDry(from.position, gateway.inside, country.code)) continue;
      if (!segmentOwnedDry(gateway.outside, target.position, gateway.neighbourCountryCode)) continue;
      const edge = routeEdge(from, target, "main", crossingCodeBase, [from.position, gateway.inside, gateway.outside, target.position], [country.code, gateway.neighbourCountryCode].sort(), crossing.code, index);
      if (!attachBridges(state, edge, false)) {
        state.bridges.splice(state.bridges.length - edge.bridgeCodes.length, edge.bridgeCodes.length);
        continue;
      }
      state.roadEdges.push(edge);
      state.borderCrossings.push(crossing);
      accepted = true;
      break;
    }
    if (!accepted) throw new Error(`No legal gateway road from ${country.code} to ${gateway.neighbourCountryCode}`);
  }
}

function harborCandidates(continent: number) {
  const coastalCountries = countries
    .filter((country) => country.continent === continent)
    .map((country) => ({ country, coastM: macroSampleAt(country.canonicalPosition).coastDistanceRad * CANONICAL_PLANET_RADIUS }))
    .sort((a, b) => a.coastM - b.coastM || a.country.code.localeCompare(b.country.code))
    .slice(0, TRANSPORT_LIMITS.harborCountriesPerContinent), candidates: { country: Country; position: CanonicalPosition; score: number }[] = [];
  for (const { country } of coastalCountries) {
    const phase = digestNumber(`${NETWORK_CODE}/HARBOR/${country.code}`) / 4294967296 * TAU;
    for (const radiusM of TRANSPORT_LIMITS.harborRadiiM) for (let bearingIndex = 0; bearingIndex < TRANSPORT_LIMITS.harborBearings; bearingIndex++) {
      const position = destination(country.canonicalPosition, phase + bearingIndex / TRANSPORT_LIMITS.harborBearings * TAU, radiusM),
        macro = macroSampleAt(position), owner = countryAtPosition(position), source = lonLatToSource(position.lon, position.lat), natural = naturalSurfaceAt(source.x, source.z), coastM = macro.coastDistanceRad * CANONICAL_PLANET_RADIUS;
      if (!owner || owner.code !== country.code || !macro.land || macro.domain !== "Mainland" || natural.water.kind !== "none" || coastM < 350 || coastM > 8_000) continue;
      candidates.push({ country, position, score: coastM + radiusM * 0.025 });
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.country.code.localeCompare(b.country.code));
}

function addHarbor(state: MutableNetwork, continent: number) {
  const baseNodes = state.nodes.filter((node) => node.continent === continent && node.kind !== "harbor");
  for (const candidate of harborCandidates(continent)) {
    const nearest = baseNodes
      .filter((node) => node.countryCode === candidate.country.code)
      .map((node) => ({ node, distanceM: greatCircleDistance(node.position, candidate.position) }))
      .sort((a, b) => a.distanceM - b.distanceM || a.node.code.localeCompare(b.node.code))
      .slice(0, TRANSPORT_LIMITS.internationalNodeCandidates);
    for (let index = 0; index < nearest.length; index++) {
      const from = nearest[index].node;
      if (!segmentOwnedDry(from.position, candidate.position, candidate.country.code)) continue;
      const source = lonLatToSource(candidate.position.lon, candidate.position.lat), harborNode: TransportNode = Object.freeze({
        code: `${NETWORK_CODE}/NODE/HARBOR/${continent}`,
        sourceId: `harbor-${continent}`,
        kind: "harbor",
        countryCode: candidate.country.code,
        continent,
        position: Object.freeze({ ...candidate.position }),
        x: source.x,
        z: source.z,
      }), roadCode = `${NETWORK_CODE}/ROAD/MAIN/HARBOR/${continent}`,
        edge = routeEdge(from, harborNode, "main", roadCode, [from.position, harborNode.position], [candidate.country.code], null, index);
      if (!attachBridges(state, edge, false)) {
        state.bridges.splice(state.bridges.length - edge.bridgeCodes.length, edge.bridgeCodes.length);
        continue;
      }
      state.nodes.push(harborNode);
      state.roadEdges.push(edge);
      const harbor: TransportHarbor = Object.freeze({
        code: `${NETWORK_CODE}/HARBOR/${continent}`,
        nodeCode: harborNode.code,
        countryCode: candidate.country.code,
        continent,
        position: harborNode.position,
        x: harborNode.x,
        z: harborNode.z,
        roadCode,
      });
      state.harbors.push(harbor);
      return harbor;
    }
  }
  throw new Error(`No deterministic road-linked harbor for continent ${continent}`);
}

function edgePairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function addFerries(state: MutableNetwork) {
  const candidates: { a: TransportHarbor; b: TransportHarbor; distanceM: number }[] = [];
  for (let i = 0; i < state.harbors.length; i++) for (let j = i + 1; j < state.harbors.length; j++) candidates.push({ a: state.harbors[i], b: state.harbors[j], distanceM: greatCircleDistance(state.harbors[i].position, state.harbors[j].position) });
  candidates.sort((a, b) => a.distanceM - b.distanceM || edgePairKey(a.a.code, a.b.code).localeCompare(edgePairKey(b.a.code, b.b.code)));
  const parent = new Map(state.harbors.map((harbor) => [harbor.code, harbor.code]));
  const root = (code: string): string => {
    const p = parent.get(code)!;
    if (p === code) return code;
    const r = root(p);
    parent.set(code, r);
    return r;
  };
  for (const candidate of candidates) {
    const ar = root(candidate.a.code), br = root(candidate.b.code);
    if (ar === br) continue;
    parent.set(ar, br);
    state.ferryEdges.push(Object.freeze({
      code: `${NETWORK_CODE}/FERRY/${candidate.a.continent}--${candidate.b.continent}`,
      kind: "ferry",
      from: candidate.a.nodeCode,
      to: candidate.b.nodeCode,
      fromHarborCode: candidate.a.code,
      toHarborCode: candidate.b.code,
      distanceM: candidate.distanceM,
    }));
    if (state.ferryEdges.length === state.harbors.length - 1) break;
  }
}

function networkDigest(state: MutableNetwork) {
  const pieces = [
    ...state.nodes.map((node) => `N:${node.code}:${node.position.lon.toFixed(9)}:${node.position.lat.toFixed(9)}`),
    ...state.roadEdges.map((edge) => `R:${edge.code}:${edge.from}:${edge.to}:${edge.centerline.map((point) => `${point.x.toFixed(4)},${point.z.toFixed(4)},${point.elevationM.toFixed(3)}`).join(";")}`),
    ...state.ferryEdges.map((edge) => `F:${edge.code}:${edge.from}:${edge.to}:${edge.distanceM.toFixed(3)}`),
    ...state.bridges.map((bridge) => `B:${bridge.code}:${bridge.x.toFixed(4)}:${bridge.z.toFixed(4)}:${bridge.spanM.toFixed(3)}`),
    ...state.borderCrossings.map((crossing) => `X:${crossing.code}:${crossing.x.toFixed(4)}:${crossing.z.toFixed(4)}`),
  ].sort();
  return digestNumber(pieces.join("\n")).toString(16).padStart(8, "0");
}

export function buildTransportNetwork(): TransportNetwork {
  const state: MutableNetwork = { nodes: [], roadEdges: [], ferryEdges: [], bridges: [], borderCrossings: [], harbors: [] };
  for (const place of [...cities, ...villages]) state.nodes.push(nodeForPlace(place));
  for (const junction of roadJunctions) state.nodes.push(nodeForJunction(junction));
  const nodeBySourceId = new Map(state.nodes.map((node) => [node.sourceId, node])),
    baseRoads = geographyRoads.filter((road) => !road.code.startsWith(`${NETWORK_CODE}/ROAD/`));
  for (const road of baseRoads) {
    const edge = baseRoadEdge(road, nodeBySourceId);
    attachBridges(state, edge, true);
    state.roadEdges.push(edge);
  }

  addInternationalRoads(state);
  for (const continent of [...new Set(countries.map((country) => country.continent))].sort((a, b) => a - b)) addHarbor(state, continent);
  addFerries(state);

  const incident = new Map<string, string[]>();
  for (const edge of state.roadEdges) for (const nodeCode of [edge.from, edge.to]) {
    const list = incident.get(nodeCode) ?? [];
    list.push(edge.code);
    incident.set(nodeCode, list);
  }
  const junctions = state.nodes.flatMap((node) => {
    const edges = [...(incident.get(node.code) ?? [])].sort();
    return edges.length >= 3 ? [Object.freeze({
      code: `${NETWORK_CODE}/JUNCTION/${node.sourceId}`,
      nodeCode: node.code,
      position: node.position,
      edgeCodes: Object.freeze(edges),
    })] : [];
  });

  const digest = networkDigest(state), frozenRoads = state.roadEdges.map((edge) => Object.freeze({
    ...edge,
    countryCodes: Object.freeze([...edge.countryCodes]),
    centerline: Object.freeze([...edge.centerline]),
    bridgeCodes: Object.freeze([...edge.bridgeCodes]),
  })) as readonly TransportRoadEdge[];
  return Object.freeze({
    code: NETWORK_CODE,
    nodes: Object.freeze([...state.nodes]),
    roadEdges: Object.freeze(frozenRoads),
    ferryEdges: Object.freeze([...state.ferryEdges]),
    bridges: Object.freeze([...state.bridges]),
    borderCrossings: Object.freeze([...state.borderCrossings]),
    harbors: Object.freeze([...state.harbors]),
    junctions: Object.freeze(junctions),
    digest,
  });
}

export const transportNetwork = buildTransportNetwork();

function roadSurfaceRecord(edge: TransportRoadEdge): Road {
  const from = transportNetwork.nodes.find((node) => node.code === edge.from)!, to = transportNetwork.nodes.find((node) => node.code === edge.to)!,
    first = edge.centerline[0], last = edge.centerline.at(-1)!, xs = edge.centerline.map((point) => point.x), zs = edge.centerline.map((point) => point.z),
    surfaceLengthM = edge.centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(edge.centerline[index].position, point.position), 0),
    travel = travelMetrics(surfaceLengthM, "good-road");
  return {
    code: edge.code,
    networkId: edge.code,
    networkKind: edge.roadClass === "continuity" ? "detour" : "link",
    coarseFallback: false,
    from: from.sourceId,
    to: to.sourceId,
    fromX: first.x,
    toX: last.x,
    fromZ: first.z,
    toZ: last.z,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    z: (first.z + last.z) / 2,
    fromPosition: from.position,
    toPosition: to.position,
    presentationLengthSourceUnits: edge.centerline.slice(1).reduce((sum, point, index) => sum + Math.hypot(wrapSourceX(point.x - edge.centerline[index].x), point.z - edge.centerline[index].z), 0),
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: edge.centerline.map((point) => ({ x: point.x, z: point.z, position: point.position })),
  };
}

const existingRoads = new Map(geographyRoads.map((road) => [road.code, road]));
for (const edge of transportNetwork.roadEdges) if (!existingRoads.has(edge.code)) {
  const road = roadSurfaceRecord(edge);
  geographyRoads.push(road);
  existingRoads.set(road.code, road);
}
export const transportSurfaceRoads: readonly Road[] = Object.freeze(transportNetwork.roadEdges.map((edge) => existingRoads.get(edge.code)!));

const transportBuckets = new Map<string, TransportRoadEdge[]>(), bucketKey = (x: number, z: number) => `${x}/${z}`;
for (const edge of transportNetwork.roadEdges) {
  const path = { fromX: edge.centerline[0].x, fromZ: edge.centerline[0].z, toX: edge.centerline.at(-1)!.x, toZ: edge.centerline.at(-1)!.z, centerline: edge.centerline };
  for (const [x, z] of canonicalRoadBucketCells(path, TRANSPORT_LIMITS.spatialBucketSource, 0, SOURCE_PRESENTATION_WIDTH)) {
    const key = bucketKey(x, z), bucket = transportBuckets.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.code === edge.code)) bucket.push(edge);
    transportBuckets.set(key, bucket);
  }
}
for (const bucket of transportBuckets.values()) bucket.sort((a, b) => a.code.localeCompare(b.code));

export function transportRoadsNear(x: number, z: number, radiusSource: number, limit = TRANSPORT_LIMITS.queryRoadLimit) {
  if (!Number.isFinite(radiusSource) || radiusSource <= 0 || radiusSource > 16_384) throw new RangeError("Transport road query radius outside bounded presentation support");
  const size = TRANSPORT_LIMITS.spatialBucketSource, bx = Math.floor(wrapSourceX(x) / size), bz = Math.floor(z / size), reach = Math.ceil(radiusSource / size), found = new Map<string, TransportRoadEdge>();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const canonicalX = ((bx + dx + SOURCE_PRESENTATION_WIDTH / size / 2) % (SOURCE_PRESENTATION_WIDTH / size) + SOURCE_PRESENTATION_WIDTH / size) % (SOURCE_PRESENTATION_WIDTH / size) - SOURCE_PRESENTATION_WIDTH / size / 2;
    for (const edge of transportBuckets.get(bucketKey(canonicalX, bz + dz)) ?? []) {
      let nearest = Infinity;
      for (let index = 1; index < edge.centerline.length; index++) {
        const a = edge.centerline[index - 1], b = edge.centerline[index], px = a.x + wrapSourceX(x - a.x), vx = wrapSourceX(b.x - a.x), vz = b.z - a.z, length = vx * vx + vz * vz,
          t = length ? Math.max(0, Math.min(1, ((px - a.x) * vx + (z - a.z) * vz) / length)) : 0;
        nearest = Math.min(nearest, Math.hypot(px - a.x - vx * t, z - a.z - vz * t));
      }
      if (nearest <= radiusSource) found.set(edge.code, edge);
    }
  }
  return Object.freeze([...found.values()].sort((a, b) => a.code.localeCompare(b.code)).slice(0, Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit))));
}

export function transportAcceptanceSummary() {
  const degree = new Map<string, number>();
  for (const edge of transportNetwork.roadEdges) for (const nodeCode of [edge.from, edge.to]) degree.set(nodeCode, (degree.get(nodeCode) ?? 0) + 1);
  const mandatory = transportNetwork.nodes.filter((node) => node.kind === "capital" || node.kind === "city" || node.kind === "village"), uncovered = mandatory.filter((node) => !degree.get(node.code));
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
