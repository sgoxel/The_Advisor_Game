import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  cities,
  continuityCorridor,
  countries,
  countryAtPosition,
  roadConnections as geographyRoadConnections,
  roadJunctions,
  roadNetworkTelemetry,
  roads as geographyRoads,
  villages,
  type Country,
  type Place,
  type Road,
} from "./geography.ts";
import { freshwaterCrossingAt, freshwaterSegmentsAround } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
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
import { politicalBorderGateways } from "./political-settlement-access.ts";
import { canonicalRoadBucketCells, canonicalRoadBucketX } from "./road-spatial-index.ts";
import { travelMetrics } from "./travel.ts";

/**
 * WP-S005 transport extension authority.
 *
 * Domestic topology is owned by geography's owner-approved macro road network.
 * S005 deliberately extends that same graph instead of constructing a second
 * planet-wide domestic network. Only international border links, road-linked
 * harbors and maritime transfer edges are added here. Their stored polylines are
 * coarse deterministic alignment recipes; final ground/profile/bridge geometry
 * remains demand-driven through the existing final-surface authority.
 */

export const TRANSPORT_LIMITS = Object.freeze({
  borderBearings: 72,
  borderStepM: 5_000,
  borderMaxM: 250_000,
  ownedRouteDetours: 32,
  ownedRouteSamples: 20,
  harborBearings: 32,
  harborRadiiM: Object.freeze([5_000, 10_000, 20_000, 35_000, 55_000, 80_000]),
  harborCityCandidates: 18,
  spatialBucketSource: 4096,
  queryRoadLimit: 160,
  bridgeRoadsPerQuery: 12,
  bridgeRoadCacheLimit: 96,
  ruralBridgeMaxM: 120,
});

export type TransportRoadClass = "main" | "regional" | "access" | "continuity";
export type TransportNodeKind = "capital" | "city" | "village" | "junction" | "harbor";

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
  sourceId: string;
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
  /** Macro relief only. Fine final-surface road profiles are materialized locally. */
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

type BorderGateway = Readonly<{
  id: string;
  countryCode: string;
  neighbourCountryCode: string;
  inside: CanonicalPosition;
  outside: CanonicalPosition;
  corridor: readonly CanonicalPosition[];
  distanceM: number;
}>;

type ExtensionBuild = Readonly<{
  roads: readonly Road[];
  borderCrossings: readonly TransportBorderCrossing[];
  harbors: readonly TransportHarbor[];
  harborNodes: readonly TransportNode[];
  ferries: readonly TransportFerryEdge[];
}>;

const TAU = Math.PI * 2;
const NETWORK_CODE = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/TRANSPORT`;
const BASE_ROADS = Object.freeze([...geographyRoads]);
const BASE_CONNECTION_COUNT = geographyRoadConnections.length;
const countriesByCode = new Map(countries.map((country) => [country.code, country]));
const places = [...cities, ...villages];
const placesById = new Map(places.map((place) => [place.id, place]));
const capitalsByCountry = new Map(
  countries.map((country) => {
    const capital = cities.find(
      (city) => city.continent === country.continent && city.country === country.id && city.city === 0,
    );
    if (!capital) throw new Error(`Capital missing for ${country.code}`);
    return [country.code, capital] as const;
  }),
);

function digestNumber(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function addressed(address: string) {
  return digestNumber(`${NETWORK_CODE}/${address}`) / 4294967296;
}

function sanitize(value: string) {
  return value.replaceAll("/", "-").replaceAll("|", "-");
}

function destination(origin: LonLat, bearing: number, distanceM: number): CanonicalPosition {
  const angular = distanceM / CANONICAL_PLANET_RADIUS,
    sinLat =
      Math.sin(origin.lat) * Math.cos(angular) +
      Math.cos(origin.lat) * Math.sin(angular) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(
      origin.lon +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angular) * Math.cos(origin.lat),
          Math.cos(angular) - Math.sin(origin.lat) * Math.sin(lat),
        ),
    );
  return { lon, lat, elevation: 0 };
}

function bearing(from: LonLat, to: LonLat) {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  return Math.atan2(
    Math.sin(deltaLon) * Math.cos(to.lat),
    Math.cos(from.lat) * Math.sin(to.lat) -
      Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(deltaLon),
  );
}

function interpolate(from: LonLat, to: LonLat, t: number) {
  return destination(from, bearing(from, to), greatCircleDistance(from, to) * t);
}

function sameOwnedDryLand(position: LonLat, country: Country) {
  const macro = macroSampleAt(position), owner = countryAtPosition(position);
  return (
    macro.land &&
    macro.domain !== "Lake" &&
    macro.domain !== "Ocean" &&
    macro.continentId === country.continent &&
    owner?.code === country.code
  );
}

function segmentLegal(from: LonLat, to: LonLat, country: Country, samples = TRANSPORT_LIMITS.ownedRouteSamples) {
  const distanceM = greatCircleDistance(from, to), azimuth = bearing(from, to), count = Math.max(4, samples);
  for (let index = 0; index <= count; index++)
    if (!sameOwnedDryLand(destination(from, azimuth, distanceM * index / count), country)) return false;
  return true;
}

/** Bounded coarse alignment only; no final-surface profile or road mesh is built. */
function ownedMacroPath(from: CanonicalPosition, to: CanonicalPosition, country: Country, address: string) {
  if (segmentLegal(from, to, country)) return Object.freeze([from, to] as CanonicalPosition[]);
  const distanceM = greatCircleDistance(from, to), midpoint = interpolate(from, to, 0.5), azimuth = bearing(from, to);
  for (let attempt = 0; attempt < TRANSPORT_LIMITS.ownedRouteDetours; attempt++) {
    const ring = Math.floor(attempt / 8), side = attempt % 8,
      radiusM = Math.min(80_000, Math.max(4_000, distanceM * (0.08 + ring * 0.08))),
      phase = TAU * addressed(`${address}/DETOUR/${ring}`),
      waypoint = destination(midpoint, azimuth + Math.PI / 2 + phase + side / 8 * TAU, radiusM);
    if (
      sameOwnedDryLand(waypoint, country) &&
      segmentLegal(from, waypoint, country, 12) &&
      segmentLegal(waypoint, to, country, 12)
    ) return Object.freeze([from, waypoint, to]);
  }

  const via = cities
    .filter((city) => city.continent === country.continent && city.country === country.id)
    .sort((a, b) =>
      greatCircleDistance(from, a.canonicalPosition) + greatCircleDistance(a.canonicalPosition, to) -
        greatCircleDistance(from, b.canonicalPosition) - greatCircleDistance(b.canonicalPosition, to) ||
      a.id.localeCompare(b.id)
    )
    .find((city) =>
      segmentLegal(from, city.canonicalPosition, country, 14) &&
      segmentLegal(city.canonicalPosition, to, country, 14)
    );
  if (via) return Object.freeze([from, via.canonicalPosition, to]);

  throw new Error(`No bounded owned macro alignment for ${address}`);
}

function sourcePolyline(positions: readonly CanonicalPosition[]) {
  const first = lonLatToSource(positions[0].lon, positions[0].lat);
  return positions.map((position) => {
    const source = lonLatToSource(position.lon, position.lat);
    return Object.freeze({ x: first.x + wrapSourceX(source.x - first.x), z: source.z, position: Object.freeze({ lon: position.lon, lat: position.lat }) });
  });
}

function makeRoad(
  code: string,
  networkId: string,
  fromId: string,
  toId: string,
  positions: readonly CanonicalPosition[],
  networkKind: "trunk" | "link" | "detour" = "trunk",
): Road {
  const centerline = sourcePolyline(positions), xs = centerline.map((point) => point.x), zs = centerline.map((point) => point.z),
    surfaceLengthM = centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(centerline[index].position, point.position), 0),
    travel = travelMetrics(surfaceLengthM, "good-road"), first = centerline[0], last = centerline.at(-1)!;
  return {
    code,
    networkId,
    networkKind,
    coarseFallback: false,
    from: fromId,
    to: toId,
    fromX: first.x,
    toX: last.x,
    fromZ: first.z,
    toZ: last.z,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    z: (first.z + last.z) / 2,
    fromPosition: positions[0],
    toPosition: positions.at(-1)!,
    presentationLengthSourceUnits: centerline.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - centerline[index].x, point.z - centerline[index].z), 0),
    surfaceLengthM,
    walkSurface: "good-road",
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline,
  };
}

function existingGatewayCandidates(country: Country): BorderGateway[] {
  const capital = capitalsByCountry.get(country.code)!;
  return politicalBorderGateways
    .filter((gateway) => gateway.countryCode === country.code)
    .map((gateway) => Object.freeze({
      id: `S004/${gateway.id}`,
      countryCode: gateway.countryCode,
      neighbourCountryCode: gateway.neighbourCountryCode,
      inside: gateway.inside,
      outside: gateway.outside,
      corridor: Object.freeze([...gateway.corridor]),
      distanceM: greatCircleDistance(capital.canonicalPosition, gateway.inside),
    }));
}

/** Discover additional canonical owner-boundary crossings when S004's one reserved gate is insufficient for a continent spanning tree. */
function discoveredGatewayCandidates(country: Country): BorderGateway[] {
  const capital = capitalsByCountry.get(country.code)!, phase = TAU * addressed(`${country.code}/BORDER/PHASE`), found = new Map<string, BorderGateway>();
  for (let bearingIndex = 0; bearingIndex < TRANSPORT_LIMITS.borderBearings; bearingIndex++) {
    const azimuth = phase + bearingIndex / TRANSPORT_LIMITS.borderBearings * TAU;
    let previous = capital.canonicalPosition;
    for (let distanceM = TRANSPORT_LIMITS.borderStepM; distanceM <= TRANSPORT_LIMITS.borderMaxM; distanceM += TRANSPORT_LIMITS.borderStepM) {
      const point = destination(capital.canonicalPosition, azimuth, distanceM), macro = macroSampleAt(point), owner = countryAtPosition(point);
      if (!macro.land || macro.domain === "Lake" || macro.domain === "Ocean" || macro.continentId !== country.continent || !owner) break;
      if (owner.code === country.code) {
        previous = point;
        continue;
      }
      if (owner.continent !== country.continent) break;
      let lo = previous, hi = point;
      for (let iteration = 0; iteration < 18; iteration++) {
        const mid = interpolate(lo, hi, 0.5), midOwner = countryAtPosition(mid);
        if (midOwner?.code === country.code) lo = mid;
        else hi = mid;
      }
      const candidate: BorderGateway = Object.freeze({
        id: `S005/${country.code}/${owner.code}/${bearingIndex}`,
        countryCode: country.code,
        neighbourCountryCode: owner.code,
        inside: lo,
        outside: hi,
        corridor: Object.freeze([capital.canonicalPosition, lo]),
        distanceM,
      });
      const current = found.get(owner.code);
      if (!current || candidate.distanceM < current.distanceM || (candidate.distanceM === current.distanceM && candidate.id < current.id)) found.set(owner.code, candidate);
      break;
    }
  }
  return [...found.values()].sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

function gatewayCandidates(country: Country) {
  const merged = new Map<string, BorderGateway>();
  for (const gateway of [...existingGatewayCandidates(country), ...discoveredGatewayCandidates(country)]) {
    const key = gateway.neighbourCountryCode;
    const current = merged.get(key);
    if (!current || gateway.id.startsWith("S004/") || (!current.id.startsWith("S004/") && (gateway.distanceM < current.distanceM || (gateway.distanceM === current.distanceM && gateway.id < current.id)))) merged.set(key, gateway);
  }
  return [...merged.values()].sort((a, b) => a.distanceM - b.distanceM || a.neighbourCountryCode.localeCompare(b.neighbourCountryCode) || a.id.localeCompare(b.id));
}

function nearestTargetCity(gateway: BorderGateway, country: Country) {
  return cities
    .filter((city) => city.continent === country.continent && city.country === country.id)
    .sort((a, b) => greatCircleDistance(gateway.outside, a.canonicalPosition) - greatCircleDistance(gateway.outside, b.canonicalPosition) || a.id.localeCompare(b.id));
}

function borderRoadFor(gateway: BorderGateway) {
  const fromCountry = countriesByCode.get(gateway.countryCode), toCountry = countriesByCode.get(gateway.neighbourCountryCode), from = capitalsByCountry.get(gateway.countryCode);
  if (!fromCountry || !toCountry || !from) return undefined;
  for (const to of nearestTargetCity(gateway, toCountry)) {
    try {
      const approach = ownedMacroPath(gateway.outside, to.canonicalPosition, toCountry, `${gateway.id}/${to.code}`),
        positions = [...gateway.corridor, gateway.outside, ...approach.slice(1)],
        pair = [fromCountry.code, toCountry.code].sort(),
        suffix = `${pair[0]}--${pair[1]}/${sanitize(gateway.id)}`,
        code = `${NETWORK_CODE}/ROAD/MAIN/BORDER/${suffix}`,
        networkId = `${NETWORK_CODE}/EDGE/BORDER/${suffix}`,
        road = makeRoad(code, networkId, from.id, to.id, positions),
        crossingPosition = interpolate(gateway.inside, gateway.outside, 0.5), crossingSource = lonLatToSource(crossingPosition.lon, crossingPosition.lat),
        crossing: TransportBorderCrossing = Object.freeze({
          code: `${code}/CROSSING`,
          roadCode: code,
          countries: Object.freeze(pair as [string, string]),
          position: Object.freeze({ lon: crossingPosition.lon, lat: crossingPosition.lat }),
          x: crossingSource.x,
          z: crossingSource.z,
        });
      return { road, crossing, neighborCode: toCountry.code };
    } catch {
      // Try the next canonical city in this neighbouring country.
    }
  }
  return undefined;
}

function buildInternationalRoads() {
  const roads: Road[] = [], crossings: TransportBorderCrossing[] = [];
  for (const continent of [...new Set(countries.map((country) => country.continent))].sort((a, b) => a - b)) {
    const local = countries.filter((country) => country.continent === continent).sort((a, b) => a.code.localeCompare(b.code));
    if (local.length <= 1) continue;
    const connected = new Set<string>([local[0].code]);
    while (connected.size < local.length) {
      const frontier = local
        .filter((country) => connected.has(country.code))
        .flatMap((country) => gatewayCandidates(country)
          .filter((gateway) => !connected.has(gateway.neighbourCountryCode))
          .map((gateway) => ({ country, gateway })))
        .sort((a, b) => a.gateway.distanceM - b.gateway.distanceM || a.country.code.localeCompare(b.country.code) || a.gateway.neighbourCountryCode.localeCompare(b.gateway.neighbourCountryCode) || a.gateway.id.localeCompare(b.gateway.id));
      let linked = false;
      for (const candidate of frontier) {
        const built = borderRoadFor(candidate.gateway);
        if (!built) continue;
        roads.push(built.road);
        crossings.push(built.crossing);
        connected.add(built.neighborCode);
        linked = true;
        break;
      }
      if (!linked) {
        const missing = local.filter((country) => !connected.has(country.code)).map((country) => country.code).join(", ");
        throw new Error(`No canonical international road frontier for continent ${continent}: ${missing}`);
      }
    }
  }
  return { roads, crossings };
}

function harborSiteCandidates(continent: number) {
  const candidateCities = cities
    .filter((city) => city.continent === continent)
    .map((city) => ({ city, coastM: Math.max(0, macroSampleAt(city.canonicalPosition).coastDistanceRad * CANONICAL_PLANET_RADIUS) }))
    .sort((a, b) => a.coastM - b.coastM || a.city.id.localeCompare(b.city.id))
    .slice(0, TRANSPORT_LIMITS.harborCityCandidates);
  const result: { city: Place; country: Country; position: CanonicalPosition; score: number }[] = [];
  for (const { city } of candidateCities) {
    const country = countries.find((candidate) => candidate.continent === city.continent && candidate.id === city.country)!;
    const phase = TAU * addressed(`${country.code}/${city.code}/HARBOR/PHASE`);
    for (const radiusM of TRANSPORT_LIMITS.harborRadiiM)
      for (let bearingIndex = 0; bearingIndex < TRANSPORT_LIMITS.harborBearings; bearingIndex++) {
        const position = destination(city.canonicalPosition, phase + bearingIndex / TRANSPORT_LIMITS.harborBearings * TAU, radiusM),
          macro = macroSampleAt(position), owner = countryAtPosition(position), coastM = macro.coastDistanceRad * CANONICAL_PLANET_RADIUS;
        if (!owner || owner.code !== country.code || !macro.land || macro.domain !== "Mainland" || coastM < 250 || coastM > 5_000) continue;
        result.push({ city, country, position, score: coastM + radiusM * 0.02 });
      }
  }
  return result.sort((a, b) => a.score - b.score || a.city.id.localeCompare(b.city.id));
}

function buildHarbors() {
  const roads: Road[] = [], harbors: TransportHarbor[] = [], nodes: TransportNode[] = [];
  for (const continent of [...new Set(countries.map((country) => country.continent))].sort((a, b) => a - b)) {
    let created = false;
    for (const candidate of harborSiteCandidates(continent)) {
      try {
        const positions = ownedMacroPath(candidate.city.canonicalPosition, candidate.position, candidate.country, `${candidate.country.code}/HARBOR/${continent}`),
          sourceId = `${NETWORK_CODE}/HARBOR-NODE/${continent}`,
          nodeCode = `${NETWORK_CODE}/NODE/HARBOR/${continent}`,
          roadCode = `${NETWORK_CODE}/ROAD/MAIN/HARBOR/${continent}`,
          road = makeRoad(roadCode, `${NETWORK_CODE}/EDGE/HARBOR/${continent}`, candidate.city.id, sourceId, positions),
          source = lonLatToSource(candidate.position.lon, candidate.position.lat),
          node: TransportNode = Object.freeze({ code: nodeCode, sourceId, kind: "harbor", countryCode: candidate.country.code, continent, position: Object.freeze({ ...candidate.position }), x: source.x, z: source.z }),
          harbor: TransportHarbor = Object.freeze({ code: `${NETWORK_CODE}/HARBOR/${continent}`, nodeCode, sourceId, countryCode: candidate.country.code, continent, position: node.position, x: node.x, z: node.z, roadCode });
        roads.push(road);
        nodes.push(node);
        harbors.push(harbor);
        created = true;
        break;
      } catch {
        // Try the next deterministic coast candidate.
      }
    }
    if (!created) throw new Error(`No bounded road-linked harbor for continent ${continent}`);
  }
  return { roads, harbors, nodes };
}

function buildFerries(harbors: readonly TransportHarbor[]): TransportFerryEdge[] {
  const candidates: { a: TransportHarbor; b: TransportHarbor; distanceM: number }[] = [];
  for (let i = 0; i < harbors.length; i++)
    for (let j = i + 1; j < harbors.length; j++)
      candidates.push({ a: harbors[i], b: harbors[j], distanceM: greatCircleDistance(harbors[i].position, harbors[j].position) });
  candidates.sort((a, b) => a.distanceM - b.distanceM || `${a.a.code}|${a.b.code}`.localeCompare(`${b.a.code}|${b.b.code}`));
  const parent = new Map(harbors.map((harbor) => [harbor.code, harbor.code]));
  const root = (code: string): string => {
    const current = parent.get(code)!;
    if (current === code) return code;
    const result = root(current);
    parent.set(code, result);
    return result;
  };
  const result: TransportFerryEdge[] = [];
  for (const candidate of candidates) {
    const ar = root(candidate.a.code), br = root(candidate.b.code);
    if (ar === br) continue;
    parent.set(ar, br);
    result.push(Object.freeze({
      code: `${NETWORK_CODE}/FERRY/${candidate.a.continent}--${candidate.b.continent}`,
      kind: "ferry",
      from: candidate.a.nodeCode,
      to: candidate.b.nodeCode,
      fromHarborCode: candidate.a.code,
      toHarborCode: candidate.b.code,
      distanceM: candidate.distanceM,
    }));
    if (result.length === Math.max(0, harbors.length - 1)) break;
  }
  return result;
}

function buildExtensions(): ExtensionBuild {
  const international = buildInternationalRoads(), harborBuild = buildHarbors(), ferries = buildFerries(harborBuild.harbors);
  return Object.freeze({
    roads: Object.freeze([...international.roads, ...harborBuild.roads]),
    borderCrossings: Object.freeze(international.crossings),
    harbors: Object.freeze(harborBuild.harbors),
    harborNodes: Object.freeze(harborBuild.nodes),
    ferries: Object.freeze(ferries),
  });
}

function settlementNode(place: Place): TransportNode {
  const country = countries.find((candidate) => candidate.continent === place.continent && candidate.id === place.country)!;
  return Object.freeze({
    code: `${NETWORK_CODE}/NODE/PLACE/${place.id}`,
    sourceId: place.id,
    kind: place.kind === "village" ? "village" : place.city === 0 ? "capital" : "city",
    countryCode: country.code,
    continent: place.continent,
    position: Object.freeze({ ...place.canonicalPosition }),
    x: place.x,
    z: place.z,
  });
}

function junctionNode(junction: (typeof roadJunctions)[number]): TransportNode {
  const country = countries.find((candidate) => candidate.continent === junction.continent && candidate.id === junction.country)!;
  return Object.freeze({
    code: `${NETWORK_CODE}/NODE/JUNCTION/${junction.id}`,
    sourceId: junction.id,
    kind: "junction",
    countryCode: country.code,
    continent: junction.continent,
    position: Object.freeze({ ...junction.canonicalPosition }),
    x: junction.x,
    z: junction.z,
  });
}

const bridgeCache = new Map<string, readonly TransportBridge[]>();
let bridgeCacheHits = 0, bridgeCacheMisses = 0, bridgeCacheEvictions = 0, focusQueries = 0, focusReturnedRoads = 0;

function currentBridges() {
  return Object.freeze([...bridgeCache.values()].flat().sort((a, b) => a.code.localeCompare(b.code)));
}

function segmentIntersection(
  a: { x: number; z: number }, b: { x: number; z: number },
  c: { x: number; z: number }, d: { x: number; z: number },
) {
  const dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z,
    det = dx * ez - dz * ex;
  if (Math.abs(det) < 1e-9) return undefined;
  const qx = c.x - a.x, qz = c.z - a.z, t = (qx * ez - qz * ex) / det, u = (qx * dz - qz * dx) / det;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

function discoverBridges(edge: TransportRoadEdge) {
  const bridges = new Map<string, TransportBridge>();
  for (let index = 1; index < edge.centerline.length; index++) {
    const a = edge.centerline[index - 1], b = edge.centerline[index], dx = b.x - a.x, dz = b.z - a.z,
      segmentM = greatCircleDistance(a.position, b.position), nearby = new Map<string, ReturnType<typeof freshwaterSegmentsAround>[number]>();
    for (const fraction of segmentM > 35_000 ? [0.25, 0.5, 0.75] : [0.5]) {
      const position = interpolate(a.position, b.position, fraction), radiusM = Math.min(28_000, Math.max(8_000, segmentM * 0.55));
      for (const river of freshwaterSegmentsAround(position, radiusM)) nearby.set(river.code, river);
    }
    for (const river of nearby.values()) {
      const c = { x: a.x + wrapSourceX(river.ax - a.x), z: river.az },
        d = { x: c.x + wrapSourceX(river.bx - river.ax), z: river.bz },
        intersection = segmentIntersection(a, b, c, d);
      if (!intersection) continue;
      const crossing = freshwaterCrossingAt(intersection.x, intersection.z, dx, dz);
      if (!crossing || crossing.spanM <= 0 || crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM || bridges.has(crossing.code)) continue;
      const position = sourceToLonLat(intersection.x, intersection.z), bridge: TransportBridge = Object.freeze({
        code: `${edge.code}/BRIDGE/${sanitize(crossing.code)}`,
        roadCode: edge.code,
        position: Object.freeze(position),
        x: wrapSourceX(intersection.x),
        z: intersection.z,
        spanM: crossing.spanM,
        drainageCode: crossing.code,
      });
      bridges.set(crossing.code, bridge);
    }
  }
  return Object.freeze([...bridges.values()].sort((a, b) => a.code.localeCompare(b.code)));
}

function touchBridgeCache(edge: TransportRoadEdge) {
  const cached = bridgeCache.get(edge.code);
  if (cached) {
    bridgeCacheHits++;
    bridgeCache.delete(edge.code);
    bridgeCache.set(edge.code, cached);
    return cached;
  }
  bridgeCacheMisses++;
  const bridges = discoverBridges(edge);
  bridgeCache.set(edge.code, bridges);
  if (bridgeCache.size > TRANSPORT_LIMITS.bridgeRoadCacheLimit) {
    bridgeCache.delete(bridgeCache.keys().next().value!);
    bridgeCacheEvictions++;
  }
  return bridges;
}

function roadWidth(roadClass: TransportRoadClass) {
  if (roadClass === "main") return 8;
  if (roadClass === "regional") return 6;
  return 5;
}

function wrapRoad(
  road: Road,
  nodeBySourceId: ReadonlyMap<string, TransportNode>,
  borderByRoad: ReadonlyMap<string, TransportBorderCrossing>,
): TransportRoadEdge {
  const from = nodeBySourceId.get(road.from), to = nodeBySourceId.get(road.to);
  if (!from || !to) throw new Error(`Transport endpoint missing for ${road.code}: ${road.from} -> ${road.to}`);
  const roadClass: TransportRoadClass = road.code.startsWith(`${NETWORK_CODE}/ROAD/MAIN/`)
    ? "main"
    : road.networkKind === "detour" || road.code === continuityCorridor.road?.code
      ? "continuity"
      : road.networkKind === "trunk" ? "regional" : "access";
  const raw = road.centerline ?? [
    { x: road.fromX, z: road.fromZ, position: road.fromPosition },
    { x: road.toX, z: road.toZ, position: road.toPosition },
  ];
  const centerline = Object.freeze(raw.map((point) => {
    const macro = macroSampleAt(point.position);
    return Object.freeze({ x: point.x, z: point.z, position: Object.freeze({ lon: point.position.lon, lat: point.position.lat }), elevationM: macro.reliefM });
  }));
  const relief = centerline.map((point) => point.elevationM), border = borderByRoad.get(road.code);
  const edge = {
    code: road.code,
    kind: "road" as const,
    roadClass,
    from: from.code,
    to: to.code,
    countryCodes: Object.freeze([...new Set([from.countryCode, to.countryCode])].sort()),
    centerline,
    get bridgeCodes() { return Object.freeze((bridgeCache.get(road.code) ?? []).map((bridge) => bridge.code)); },
    borderCrossingCode: border?.code ?? null,
    widthM: roadWidth(roadClass),
    routeCandidate: 0,
    terrainCost: road.surfaceLengthM + relief.reduce((sum, value) => sum + value * 10, 0),
    maxNaturalReliefM: Math.max(...relief),
  };
  return Object.freeze(edge);
}

function networkDigest(nodes: readonly TransportNode[], roads: readonly TransportRoadEdge[], ferries: readonly TransportFerryEdge[], crossings: readonly TransportBorderCrossing[], harbors: readonly TransportHarbor[]) {
  const pieces = [
    ...nodes.map((node) => `N:${node.code}:${node.position.lon.toFixed(9)}:${node.position.lat.toFixed(9)}`),
    ...roads.map((edge) => `R:${edge.code}:${edge.from}:${edge.to}:${edge.centerline.map((point) => `${point.x.toFixed(4)},${point.z.toFixed(4)}`).join(";")}`),
    ...ferries.map((edge) => `F:${edge.code}:${edge.from}:${edge.to}:${edge.distanceM.toFixed(3)}`),
    ...crossings.map((crossing) => `X:${crossing.code}:${crossing.x.toFixed(4)}:${crossing.z.toFixed(4)}`),
    ...harbors.map((harbor) => `H:${harbor.code}:${harbor.x.toFixed(4)}:${harbor.z.toFixed(4)}`),
  ].sort();
  return digestNumber(pieces.join("\n")).toString(16).padStart(8, "0");
}

function installExtensions(extensions: ExtensionBuild) {
  const installedRoadCodes = new Set(geographyRoads.map((road) => road.code)), installedNetworkIds = new Set(geographyRoads.map((road) => road.networkId));
  for (const road of extensions.roads) {
    if (!installedRoadCodes.has(road.code)) geographyRoads.push(road);
    if (!installedNetworkIds.has(road.networkId)) {
      geographyRoadConnections.push({ from: road.from, to: road.to, legs: [{ edgeId: road.networkId, reverse: false }] });
      installedNetworkIds.add(road.networkId);
    }
  }
}

function createTransportNetwork(install: boolean): TransportNetwork {
  const extensions = buildExtensions();
  if (install) installExtensions(extensions);
  const allRoads = [...BASE_ROADS, ...extensions.roads], nodes = [
    ...places.map(settlementNode),
    ...roadJunctions.map(junctionNode),
    ...extensions.harborNodes,
  ], nodeBySourceId = new Map(nodes.map((node) => [node.sourceId, node])),
    borderByRoad = new Map(extensions.borderCrossings.map((crossing) => [crossing.roadCode, crossing])),
    roadEdges = allRoads.map((road) => wrapRoad(road, nodeBySourceId, borderByRoad));

  const incident = new Map<string, string[]>();
  for (const edge of roadEdges) for (const nodeCode of [edge.from, edge.to]) {
    const list = incident.get(nodeCode) ?? [];
    list.push(edge.code);
    incident.set(nodeCode, list);
  }
  const junctions = nodes
    .filter((node) => node.kind === "junction")
    .map((node) => Object.freeze({
      code: `${NETWORK_CODE}/JUNCTION/${node.sourceId}`,
      nodeCode: node.code,
      position: node.position,
      edgeCodes: Object.freeze([...(incident.get(node.code) ?? [])].sort()),
    }))
    .filter((junction) => junction.edgeCodes.length >= 3);
  const digest = networkDigest(nodes, roadEdges, extensions.ferries, extensions.borderCrossings, extensions.harbors);
  return Object.freeze({
    code: NETWORK_CODE,
    nodes: Object.freeze(nodes),
    roadEdges: Object.freeze(roadEdges),
    ferryEdges: extensions.ferries,
    get bridges() { return currentBridges(); },
    borderCrossings: extensions.borderCrossings,
    harbors: extensions.harbors,
    junctions: Object.freeze(junctions),
    digest,
  });
}

/** Pure deterministic rebuild for tests; the module-level instance alone installs extensions. */
export function buildTransportNetwork() {
  return createTransportNetwork(false);
}

export const transportNetwork = createTransportNetwork(true);
export const transportSurfaceRoads: readonly Road[] = geographyRoads;

const transportBuckets = new Map<string, TransportRoadEdge[]>();
let transportBucketReferences = 0;
for (const edge of transportNetwork.roadEdges) {
  const road = {
    fromX: edge.centerline[0].x,
    fromZ: edge.centerline[0].z,
    toX: edge.centerline.at(-1)!.x,
    toZ: edge.centerline.at(-1)!.z,
    centerline: edge.centerline,
  };
  for (const [bx, bz] of canonicalRoadBucketCells(road, TRANSPORT_LIMITS.spatialBucketSource, 24, SOURCE_PRESENTATION_WIDTH)) {
    const key = `${bx}/${bz}`, bucket = transportBuckets.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.code === edge.code)) {
      bucket.push(edge);
      transportBucketReferences++;
    }
    transportBuckets.set(key, bucket);
  }
}
for (const bucket of transportBuckets.values()) bucket.sort((a, b) => a.code.localeCompare(b.code));

function distanceToEdge(edge: TransportRoadEdge, x: number, z: number) {
  let best = Infinity;
  const px = edge.centerline[0].x + wrapSourceX(x - edge.centerline[0].x);
  for (let index = 1; index < edge.centerline.length; index++) {
    const a = edge.centerline[index - 1], b = edge.centerline[index], dx = b.x - a.x, dz = b.z - a.z,
      length = dx * dx + dz * dz, t = length ? Math.max(0, Math.min(1, ((px - a.x) * dx + (z - a.z) * dz) / length)) : 0;
    best = Math.min(best, Math.hypot(px - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** Focus-bounded presentation query; no camera action changes canonical topology. */
export function transportRoadsNear(x: number, z: number, radiusSource: number, limit = TRANSPORT_LIMITS.queryRoadLimit) {
  if (!Number.isFinite(radiusSource) || radiusSource <= 0 || radiusSource > 16_384) throw new RangeError("Transport road query radius outside bounded presentation support");
  const size = TRANSPORT_LIMITS.spatialBucketSource,
    reach = Math.ceil(radiusSource / size),
    bx = canonicalRoadBucketX(Math.floor(wrapSourceX(x) / size), size, SOURCE_PRESENTATION_WIDTH),
    bz = Math.floor(z / size), found = new Map<string, TransportRoadEdge>();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const qx = canonicalRoadBucketX(bx + dx, size, SOURCE_PRESENTATION_WIDTH);
    for (const edge of transportBuckets.get(`${qx}/${bz + dz}`) ?? [])
      if (distanceToEdge(edge, x, z) <= radiusSource) found.set(edge.code, edge);
  }
  const result = [...found.values()]
    .sort((a, b) => distanceToEdge(a, x, z) - distanceToEdge(b, x, z) || a.code.localeCompare(b.code))
    .slice(0, Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit)));
  focusQueries++;
  focusReturnedRoads += result.length;
  for (const edge of result.slice(0, TRANSPORT_LIMITS.bridgeRoadsPerQuery)) touchBridgeCache(edge);
  return Object.freeze(result);
}

/** Explicit diagnostic request may scan topology, but ordinary pan/zoom never does. */
export function ensureTransportBridgeEvidence() {
  const existing = currentBridges()[0];
  if (existing) return existing;
  for (const edge of [...transportNetwork.roadEdges].sort((a, b) => a.code.localeCompare(b.code))) {
    const bridge = touchBridgeCache(edge)[0];
    if (bridge) return bridge;
  }
  return undefined;
}

export function transportGenerationTelemetry() {
  return Object.freeze({
    domesticAuthority: roadNetworkTelemetry.version,
    baseRoads: BASE_ROADS.length,
    extensionRoads: transportNetwork.roadEdges.length - BASE_ROADS.length,
    topologyRoads: transportNetwork.roadEdges.length,
    topologyNodes: transportNetwork.nodes.length,
    roadBuckets: transportBuckets.size,
    roadBucketReferences: transportBucketReferences,
    bridgeCacheRoads: bridgeCache.size,
    bridgeCacheLimit: TRANSPORT_LIMITS.bridgeRoadCacheLimit,
    bridgeCacheHits,
    bridgeCacheMisses,
    bridgeCacheEvictions,
    materializedBridges: currentBridges().length,
    focusQueries,
    focusReturnedRoads,
    geographyRoads: geographyRoads.length,
    geographyConnections: geographyRoadConnections.length,
    baseConnections: BASE_CONNECTION_COUNT,
  });
}

export function transportAcceptanceSummary() {
  const mandatory = transportNetwork.nodes.filter((node) => node.kind === "capital" || node.kind === "city" || node.kind === "village"),
    roadDegree = new Map<string, number>();
  for (const edge of transportNetwork.roadEdges) for (const nodeCode of [edge.from, edge.to]) roadDegree.set(nodeCode, (roadDegree.get(nodeCode) ?? 0) + 1);
  const uncovered = mandatory.filter((node) => !roadDegree.get(node.code));
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
    bridges: currentBridges().length,
    borderCrossings: transportNetwork.borderCrossings.length,
    harbors: transportNetwork.harbors.length,
    mainRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "main").length,
    regionalRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "regional").length,
    accessRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "access").length,
    continuityRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "continuity").length,
    domesticAuthority: roadNetworkTelemetry.version,
    limits: TRANSPORT_LIMITS,
  });
}
