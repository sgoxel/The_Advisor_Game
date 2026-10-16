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
  freshwaterCrossingSpanMAt,
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
import {
  politicalBorderGateways,
  type PoliticalBorderGateway,
} from "./political-settlement-access.ts";
import { canonicalRoadBucketCells } from "./road-spatial-index.ts";
import { planRoute } from "./routing.ts";
import { travelMetrics } from "./travel.ts";

/**
 * S005 transport authority.
 *
 * Domestic roads, their physical centre-lines and their real shared Y junctions
 * are owned by the current seeded macro road authority in geography.ts. S005
 * deliberately reuses those records rather than rebuilding a second network.
 * This module adds the missing cross-border/harbor/maritime semantics, derives
 * exact bridge records from authoritative hydrology, exposes bounded inspection,
 * and installs only genuinely new physical roads into the same geography array.
 */

export const TRANSPORT_LIMITS = Object.freeze({
  routeCandidates: 9,
  routeSampleSource: 12,
  routePlannerMaxM: 350_000,
  harborCountriesPerContinent: 6,
  harborBearings: 32,
  harborRadiiM: Object.freeze([8_000, 16_000, 28_000, 45_000, 70_000, 100_000]),
  internationalCandidates: 16,
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

type MutableRoadEdge = Omit<
  TransportRoadEdge,
  "countryCodes" | "centerline" | "bridgeCodes"
> & {
  countryCodes: string[];
  centerline: TransportCenterlinePoint[];
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

type RouteBuild = Readonly<{
  points: readonly TransportCenterlinePoint[];
  bridges: readonly TransportBridge[];
  borderCrossing?: TransportBorderCrossing;
  candidate: number;
  cost: number;
  maxReliefM: number;
}>;

const NETWORK_CODE = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/TRANSPORT`;
const TAU = Math.PI * 2;
const countriesByKey = new Map(
  countries.map((country) => [`${country.continent}/${country.id}`, country]),
);
const countriesByCode = new Map(countries.map((country) => [country.code, country]));

function digestNumber(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
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

function countryForPlace(place: Place) {
  const country = countriesByKey.get(`${place.continent}/${place.country}`);
  if (!country) throw new Error(`Transport country missing for ${place.code}`);
  return country;
}

function capitalFor(country: Country) {
  const capital = cities.find(
    (city) =>
      city.continent === country.continent &&
      city.country === country.id &&
      city.city === 0,
  );
  if (!capital) throw new Error(`Capital missing for ${country.code}`);
  return capital;
}

function nodeForPlace(place: Place): TransportNode {
  const country = countryForPlace(place),
    source = lonLatToSource(place.canonicalPosition.lon, place.canonicalPosition.lat),
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

function transientNode(
  code: string,
  position: CanonicalPosition,
  countryCode: string,
  continent: number,
): TransportNode {
  const source = lonLatToSource(position.lon, position.lat);
  return Object.freeze({
    code: `${NETWORK_CODE}/NODE/GATEWAY/${code}`,
    sourceId: `gateway-${code}`,
    kind: "city",
    countryCode,
    continent,
    position: Object.freeze({ ...position }),
    x: source.x,
    z: source.z,
  });
}

function edgePairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
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

function centrePoint(x: number, z: number): TransportCenterlinePoint {
  const position = sourceToLonLat(x, z),
    natural = naturalSurfaceAt(x, z);
  return Object.freeze({
    x: wrapSourceX(x),
    z,
    position: Object.freeze(position),
    elevationM: natural.groundHeight,
  });
}

function centerlineFromRoad(road: Road) {
  const sourcePoints =
    road.centerline ??
    [
      { x: road.fromX, z: road.fromZ, position: road.fromPosition },
      { x: road.toX, z: road.toZ, position: road.toPosition },
    ];
  let previousX: number | undefined;
  return sourcePoints.map((point) => {
    const x =
      previousX === undefined
        ? point.x
        : previousX + wrapSourceX(point.x - previousX);
    previousX = x;
    const natural = naturalSurfaceAt(x, point.z);
    return Object.freeze({
      x,
      z: point.z,
      position: Object.freeze({ lon: point.position.lon, lat: point.position.lat }),
      elevationM: natural.groundHeight,
    });
  });
}

function maxRelief(points: readonly TransportCenterlinePoint[]) {
  let result = 0;
  for (const point of points)
    result = Math.max(result, macroSampleAt(point.position).reliefM);
  return result;
}

function physicalLength(points: readonly TransportCenterlinePoint[]) {
  return points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + greatCircleDistance(points[index].position, point.position),
      0,
    );
}

function baseRoadEdge(
  road: Road,
  nodeBySourceId: ReadonlyMap<string, TransportNode>,
): MutableRoadEdge {
  const from = nodeBySourceId.get(road.from),
    to = nodeBySourceId.get(road.to);
  if (!from || !to)
    throw new Error(`Transport endpoint missing for ${road.code}: ${road.from} -> ${road.to}`);
  const centerline = centerlineFromRoad(road),
    roadClass = roadClassFor(road, from, to);
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
    terrainCost: road.surfaceLengthM + maxRelief(centerline) * 100,
    maxNaturalReliefM: maxRelief(centerline),
  };
}

const waterBuckets = new Map<string, DrainageSegment[]>();
const waterBucketKey = (x: number, z: number) => `${x}/${z}`;
for (const segment of drainageCoarseSegments) {
  const path = {
    fromX: segment.ax,
    fromZ: segment.az,
    toX: segment.bx,
    toZ: segment.bz,
  };
  for (const [x, z] of canonicalRoadBucketCells(
    path,
    TRANSPORT_LIMITS.waterBucketSource,
    segment.width,
    SOURCE_PRESENTATION_WIDTH,
  )) {
    const key = waterBucketKey(x, z),
      list = waterBuckets.get(key) ?? [];
    list.push(segment);
    waterBuckets.set(key, list);
  }
}
for (const list of waterBuckets.values()) list.sort((a, b) => a.code.localeCompare(b.code));

function crossingPoint(
  a: TransportCenterlinePoint,
  b: TransportCenterlinePoint,
  stream: DrainageSegment,
) {
  const rx = wrapSourceX(b.x - a.x),
    rz = b.z - a.z,
    sx0 = a.x + wrapSourceX(stream.ax - a.x),
    sz0 = stream.az,
    sx = wrapSourceX(stream.bx - stream.ax),
    sz = stream.bz - stream.az,
    qx = sx0 - a.x,
    qz = sz0 - a.z,
    denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = (qx * sz - qz * sx) / denominator,
    u = (qx * rz - qz * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + rx * t, z: a.z + rz * t, roadX: rx, roadZ: rz };
}

function bridgeScan(
  roadCode: string,
  centerline: readonly TransportCenterlinePoint[],
) {
  const found = new Map<string, TransportBridge>();
  let invalid = 0;
  for (let index = 1; index < centerline.length; index++) {
    const a = centerline[index - 1],
      b = centerline[index],
      path = { fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z },
      candidates = new Map<string, DrainageSegment>();
    for (const [bx, bz] of canonicalRoadBucketCells(
      path,
      TRANSPORT_LIMITS.waterBucketSource,
      0,
      SOURCE_PRESENTATION_WIDTH,
    ))
      for (const stream of waterBuckets.get(waterBucketKey(bx, bz)) ?? [])
        candidates.set(stream.code, stream);
    for (const stream of candidates.values()) {
      const hit = crossingPoint(a, b, stream);
      if (!hit) continue;
      const surface = naturalSurfaceAt(hit.x, hit.z);
      if (surface.water.kind !== "river") continue;
      const crossing = freshwaterCrossingAt(
        hit.x,
        hit.z,
        hit.roadX,
        hit.roadZ,
      );
      if (!crossing || crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM) {
        invalid++;
        continue;
      }
      const identity = `${crossing.code}/${hit.x.toFixed(3)}/${hit.z.toFixed(3)}`;
      if (found.has(identity)) continue;
      const position = sourceToLonLat(hit.x, hit.z),
        bridge: TransportBridge = Object.freeze({
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

function attachBaseBridges(state: MutableNetwork, edge: MutableRoadEdge) {
  const scan = bridgeScan(edge.code, edge.centerline);
  if (scan.invalid)
    throw new Error(`Illegal unbridged freshwater crossing on ${edge.code}: ${scan.invalid}`);
  edge.bridgeCodes = scan.bridges.map((bridge) => bridge.code);
  state.bridges.push(...scan.bridges);
}

function pathControls(
  from: TransportNode,
  to: TransportNode,
  candidate: number,
  address: string,
) {
  const dx = wrapSourceX(to.x - from.x),
    dz = to.z - from.z,
    length = Math.hypot(dx, dz) || 1,
    px = -dz / length,
    pz = dx / length,
    seedSign = (digestNumber(`${address}/SIDE`) & 1) === 0 ? 1 : -1,
    sign = candidate % 2 === 0 ? seedSign : -seedSign,
    band = Math.floor((candidate + 1) / 2),
    strength = candidate === 0 ? 0 : Math.min(0.3, 0.075 * band),
    offset = Math.min(length * strength, 3200),
    pattern =
      candidate <= 4
        ? [0, 0.55, 1, 0.55, 0]
        : candidate <= 6
          ? [0, 0.4, 0.8, 0.4, 0]
          : [0, 0.65, -0.35, 0.45, 0];
  return pattern.map((factor, index) => {
    const t = index / (pattern.length - 1),
      amount = factor * offset * sign;
    return { x: from.x + dx * t + px * amount, z: from.z + dz * t + pz * amount };
  });
}

function samplePolyline(
  controls: readonly { x: number; z: number }[],
  stepSource = TRANSPORT_LIMITS.routeSampleSource,
) {
  const samples: { x: number; z: number; segment: number }[] = [];
  for (let segment = 0; segment < controls.length - 1; segment++) {
    const a = controls[segment],
      b = controls[segment + 1],
      dx = wrapSourceX(b.x - a.x),
      dz = b.z - a.z,
      length = Math.hypot(dx, dz),
      count = Math.max(1, Math.ceil(length / stepSource));
    for (let index = segment === 0 ? 0 : 1; index <= count; index++) {
      const t = index / count;
      samples.push({ x: a.x + dx * t, z: a.z + dz * t, segment });
    }
  }
  return samples;
}

function borderCrossingFor(
  roadCode: string,
  samples: readonly { x: number; z: number }[],
  fromCountry: Country,
  toCountry: Country,
): TransportBorderCrossing | undefined {
  let previous = countryAtPosition(sourceToLonLat(samples[0].x, samples[0].z));
  let result: TransportBorderCrossing | undefined;
  for (let index = 1; index < samples.length; index++) {
    const current = countryAtPosition(sourceToLonLat(samples[index].x, samples[index].z));
    if (!previous || !current || previous.code === current.code) {
      previous = current;
      continue;
    }
    if (
      ![previous.code, current.code].includes(fromCountry.code) ||
      ![previous.code, current.code].includes(toCountry.code)
    )
      return undefined;
    if (result) return undefined;
    let a = samples[index - 1],
      b = samples[index];
    for (let iteration = 0; iteration < 24; iteration++) {
      const mx = a.x + wrapSourceX(b.x - a.x) * 0.5,
        mz = (a.z + b.z) * 0.5,
        owner = countryAtPosition(sourceToLonLat(mx, mz));
      if (owner?.code === previous.code) a = { ...a, x: mx, z: mz };
      else b = { ...b, x: mx, z: mz };
    }
    const x = a.x + wrapSourceX(b.x - a.x) * 0.5,
      z = (a.z + b.z) * 0.5,
      position = sourceToLonLat(x, z);
    result = Object.freeze({
      code: `${roadCode}/BORDER/${[fromCountry.code, toCountry.code]
        .sort()
        .join("--")}`,
      roadCode,
      countries: Object.freeze(
        [fromCountry.code, toCountry.code].sort() as [string, string],
      ),
      position: Object.freeze(position),
      x: wrapSourceX(x),
      z,
    });
    previous = current;
  }
  return result;
}

function routeCandidate(
  roadCode: string,
  from: TransportNode,
  to: TransportNode,
  candidate: number,
  allowedCountries: readonly string[],
  requireBorder: boolean,
  overrideControls?: readonly { x: number; z: number }[],
): RouteBuild | undefined {
  const controls = overrideControls ?? pathControls(from, to, candidate, roadCode),
    samples = samplePolyline(controls);
  if (samples.length < 2) return undefined;
  let cost = 0,
    maxReliefM = 0,
    previousHeight: number | undefined,
    previousPosition: LonLat | undefined;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index],
      position = sourceToLonLat(sample.x, sample.z),
      macro = macroSampleAt(position),
      natural = naturalSurfaceAt(sample.x, sample.z),
      owner = countryAtPosition(position);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.domain === "Ocean" ||
      natural.water.kind === "lake" ||
      natural.water.kind === "ocean" ||
      !owner ||
      !allowedCountries.includes(owner.code)
    )
      return undefined;
    if (natural.water.kind === "river") {
      const segment = Math.min(controls.length - 2, sample.segment),
        a = controls[segment],
        b = controls[segment + 1],
        crossing = freshwaterCrossingAt(
          sample.x,
          sample.z,
          wrapSourceX(b.x - a.x),
          b.z - a.z,
        );
      if (!crossing || crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM)
        return undefined;
    }
    const relief = Math.max(0, macro.reliefM),
      height = natural.groundHeight;
    maxReliefM = Math.max(maxReliefM, relief);
    cost += relief * 1.7 + (natural.cliff ? 80_000 : natural.slope * 15_000);
    if (previousHeight !== undefined && previousPosition) {
      const runM = Math.max(1, greatCircleDistance(previousPosition, position)),
        grade = Math.abs(height - previousHeight) / runM;
      cost += Math.max(0, grade - 0.06) * 180_000;
      if (grade > 0.38) return undefined;
    }
    previousHeight = height;
    previousPosition = position;
  }

  const points = controls.map(({ x, z }) => centrePoint(x, z)),
    scan = bridgeScan(roadCode, points);
  if (scan.invalid) return undefined;
  cost += physicalLength(points) + scan.bridges.reduce((sum, bridge) => sum + 4_000 + bridge.spanM * 45, 0);

  const fromCountry = countriesByCode.get(from.countryCode),
    toCountry = countriesByCode.get(to.countryCode);
  let borderCrossing: TransportBorderCrossing | undefined;
  if (requireBorder) {
    if (!fromCountry || !toCountry || fromCountry.code === toCountry.code)
      return undefined;
    borderCrossing = borderCrossingFor(roadCode, samples, fromCountry, toCountry);
    if (!borderCrossing) return undefined;
  }
  return Object.freeze({
    points: Object.freeze(points),
    bridges: Object.freeze(scan.bridges),
    borderCrossing,
    candidate,
    cost,
    maxReliefM,
  });
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
    const route = routeCandidate(
      roadCode,
      from,
      to,
      candidate,
      allowedCountries,
      requireBorder,
    );
    if (!route) continue;
    if (
      !best ||
      route.cost < best.cost - 1e-7 ||
      (Math.abs(route.cost - best.cost) <= 1e-7 && route.candidate < best.candidate)
    )
      best = route;
  }

  if (
    !best &&
    greatCircleDistance(from.position, to.position) <= TRANSPORT_LIMITS.routePlannerMaxM
  ) {
    const planned = planRoute({
      from: from.position,
      to: to.position,
      terrain(position) {
        const source = lonLatToSource(position.lon, position.lat),
          natural = naturalSurfaceAt(source.x, source.z),
          macro = macroSampleAt(position),
          owner = countryAtPosition(position),
          outsideOwner = !owner || !allowedCountries.includes(owner.code),
          unbridgeableRiver =
            natural.water.kind === "river" &&
            freshwaterCrossingSpanMAt(source.x, source.z) >
              TRANSPORT_LIMITS.ruralBridgeMaxM;
        return {
          water:
            outsideOwner ||
            natural.water.kind === "lake" ||
            natural.water.kind === "ocean" ||
            unbridgeableRiver,
          heightM: natural.groundHeight,
          highland: Math.max(
            macro.mountainIntensity,
            natural.cliff ? 1 : natural.slope,
          ),
        };
      },
    });
    if (planned.found && planned.points.length >= 2 && planned.points.length <= 128) {
      const controls = planned.points.map((point) =>
        lonLatToSource(point.lon, point.lat),
      );
      best = routeCandidate(
        roadCode,
        from,
        to,
        TRANSPORT_LIMITS.routeCandidates + 1,
        allowedCountries,
        requireBorder,
        controls,
      );
    }
  }
  if (!best) throw new Error(`No legal deterministic transport route for ${roadCode}`);
  return best;
}

function appendRoute(
  state: MutableNetwork,
  from: TransportNode,
  to: TransportNode,
  roadClass: TransportRoadClass,
  code: string,
  route: RouteBuild,
  countryCodes: readonly string[],
) {
  const edge: MutableRoadEdge = {
    code,
    kind: "road",
    roadClass,
    from: from.code,
    to: to.code,
    countryCodes: [...countryCodes],
    centerline: [...route.points],
    bridgeCodes: route.bridges.map((bridge) => bridge.code),
    borderCrossingCode: route.borderCrossing?.code ?? null,
    widthM: roadWidth(roadClass),
    routeCandidate: route.candidate,
    terrainCost: route.cost,
    maxNaturalReliefM: route.maxReliefM,
  };
  state.roadEdges.push(edge);
  state.bridges.push(...route.bridges);
  if (route.borderCrossing) state.borderCrossings.push(route.borderCrossing);
  return edge;
}

function routeThroughGateway(
  roadCode: string,
  from: TransportNode,
  to: TransportNode,
  gateway: PoliticalBorderGateway,
  candidate: number,
): RouteBuild | undefined {
  const direct =
      gateway.countryCode === from.countryCode &&
      gateway.neighbourCountryCode === to.countryCode,
    reverse =
      gateway.neighbourCountryCode === from.countryCode &&
      gateway.countryCode === to.countryCode;
  if (!direct && !reverse) return undefined;
  const fromPosition = direct ? gateway.inside : gateway.outside,
    toPosition = direct ? gateway.outside : gateway.inside,
    fromGate = transientNode(
      `${gateway.id}/FROM`,
      fromPosition,
      from.countryCode,
      from.continent,
    ),
    toGate = transientNode(
      `${gateway.id}/TO`,
      toPosition,
      to.countryCode,
      to.continent,
    );
  try {
    const fromApproach = buildRoute(
        `${roadCode}/GATEWAY/FROM`,
        from,
        fromGate,
        [from.countryCode],
      ),
      crossing = buildRoute(
        `${roadCode}/GATEWAY/CROSSING`,
        fromGate,
        toGate,
        [from.countryCode, to.countryCode].sort(),
        true,
      ),
      toApproach = buildRoute(
        `${roadCode}/GATEWAY/TO`,
        toGate,
        to,
        [to.countryCode],
      ),
      controls = [
        ...fromApproach.points.map((point) => ({ x: point.x, z: point.z })),
        ...crossing.points.slice(1).map((point) => ({ x: point.x, z: point.z })),
        ...toApproach.points.slice(1).map((point) => ({ x: point.x, z: point.z })),
      ];
    return routeCandidate(
      roadCode,
      from,
      to,
      candidate,
      [from.countryCode, to.countryCode].sort(),
      true,
      controls,
    );
  } catch {
    return undefined;
  }
}

function gatewayCandidates(country: Country) {
  const fromCapital = capitalFor(country);
  return politicalBorderGateways
    .filter(
      (gateway) =>
        gateway.countryCode === country.code ||
        gateway.neighbourCountryCode === country.code,
    )
    .map((gateway) => {
      const neighbourCode =
          gateway.countryCode === country.code
            ? gateway.neighbourCountryCode
            : gateway.countryCode,
        neighbour = countriesByCode.get(neighbourCode);
      return {
        gateway,
        neighbour,
        distanceM: neighbour
          ? greatCircleDistance(
              fromCapital.canonicalPosition,
              capitalFor(neighbour).canonicalPosition,
            )
          : Infinity,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        gateway: PoliticalBorderGateway;
        neighbour: Country;
        distanceM: number;
      } => Boolean(entry.neighbour) && entry.neighbour!.continent === country.continent,
    )
    .sort(
      (a, b) =>
        a.distanceM - b.distanceM || a.gateway.id.localeCompare(b.gateway.id),
    );
}

function capitalNode(state: MutableNetwork, country: Country) {
  const node = state.nodes.find(
    (candidate) =>
      candidate.kind === "capital" && candidate.countryCode === country.code,
  );
  if (!node) throw new Error(`Capital transport node missing for ${country.code}`);
  return node;
}

function addInternationalRoads(state: MutableNetwork) {
  const linkedCountries = new Set<string>(),
    linkedPairs = new Set<string>();
  for (const country of [...countries].sort((a, b) => a.code.localeCompare(b.code))) {
    if (linkedCountries.has(country.code)) continue;
    const from = capitalNode(state, country),
      candidates = gatewayCandidates(country).slice(
        0,
        TRANSPORT_LIMITS.internationalCandidates,
      );
    let linked = false;
    for (let index = 0; index < candidates.length; index++) {
      const { gateway, neighbour } = candidates[index],
        pair = edgePairKey(country.code, neighbour.code);
      if (linkedPairs.has(pair)) {
        linkedCountries.add(country.code);
        linkedCountries.add(neighbour.code);
        linked = true;
        break;
      }
      const to = capitalNode(state, neighbour),
        ordered = [country.code, neighbour.code].sort(),
        code = `${NETWORK_CODE}/ROAD/MAIN/CAPITAL/${ordered.join("--")}`,
        route = routeThroughGateway(code, from, to, gateway, index);
      if (!route) continue;
      appendRoute(state, from, to, "main", code, route, ordered);
      linkedPairs.add(pair);
      linkedCountries.add(country.code);
      linkedCountries.add(neighbour.code);
      linked = true;
      break;
    }
    if (!linked)
      throw new Error(`No legal international capital route for ${country.code}`);
  }
}

function harborCandidates(continent: number) {
  const orderedCountries = countries
      .filter((country) => country.continent === continent)
      .map((country) => ({
        country,
        coastM:
          macroSampleAt(country.canonicalPosition).coastDistanceRad *
          CANONICAL_PLANET_RADIUS,
      }))
      .sort((a, b) => a.coastM - b.coastM || a.country.code.localeCompare(b.country.code))
      .slice(0, TRANSPORT_LIMITS.harborCountriesPerContinent),
    candidates: { country: Country; position: CanonicalPosition; score: number }[] = [];
  for (const { country } of orderedCountries) {
    const start =
      (digestNumber(`${NETWORK_CODE}/HARBOR/${country.code}`) / 4294967296) * TAU;
    for (const radiusM of TRANSPORT_LIMITS.harborRadiiM)
      for (
        let bearingIndex = 0;
        bearingIndex < TRANSPORT_LIMITS.harborBearings;
        bearingIndex++
      ) {
        const bearing =
            start +
            (bearingIndex / TRANSPORT_LIMITS.harborBearings) * TAU,
          position = destination(country.canonicalPosition, bearing, radiusM),
          macro = macroSampleAt(position),
          owner = countryAtPosition(position),
          source = lonLatToSource(position.lon, position.lat),
          natural = naturalSurfaceAt(source.x, source.z),
          coastM = macro.coastDistanceRad * CANONICAL_PLANET_RADIUS;
        if (
          !owner ||
          owner.code !== country.code ||
          !macro.land ||
          macro.domain !== "Mainland" ||
          natural.water.kind !== "none" ||
          coastM < 350 ||
          coastM > 8_000
        )
          continue;
        candidates.push({
          country,
          position,
          score: coastM + radiusM * 0.025,
        });
      }
  }
  return candidates.sort(
    (a, b) => a.score - b.score || a.country.code.localeCompare(b.country.code),
  );
}

function addHarbor(state: MutableNetwork, continent: number) {
  for (const candidate of harborCandidates(continent)) {
    const capital = capitalNode(state, candidate.country),
      source = lonLatToSource(candidate.position.lon, candidate.position.lat),
      harborNode: TransportNode = Object.freeze({
        code: `${NETWORK_CODE}/NODE/HARBOR/${continent}`,
        sourceId: `harbor-${continent}`,
        kind: "harbor",
        countryCode: candidate.country.code,
        continent,
        position: Object.freeze({ ...candidate.position }),
        x: source.x,
        z: source.z,
      }),
      roadCode = `${NETWORK_CODE}/ROAD/MAIN/HARBOR/${continent}`;
    try {
      const route = buildRoute(
        roadCode,
        capital,
        harborNode,
        [candidate.country.code],
      );
      state.nodes.push(harborNode);
      appendRoute(
        state,
        capital,
        harborNode,
        "main",
        roadCode,
        route,
        [candidate.country.code],
      );
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
    } catch {
      // Stable candidate order; try the next legal coast/capital pair.
    }
  }
  throw new Error(`No deterministic road-linked harbor for continent ${continent}`);
}

function addFerries(state: MutableNetwork) {
  const candidates: {
    a: TransportHarbor;
    b: TransportHarbor;
    distanceM: number;
  }[] = [];
  for (let i = 0; i < state.harbors.length; i++)
    for (let j = i + 1; j < state.harbors.length; j++)
      candidates.push({
        a: state.harbors[i],
        b: state.harbors[j],
        distanceM: greatCircleDistance(
          state.harbors[i].position,
          state.harbors[j].position,
        ),
      });
  candidates.sort(
    (a, b) =>
      a.distanceM - b.distanceM ||
      edgePairKey(a.a.code, a.b.code).localeCompare(edgePairKey(b.a.code, b.b.code)),
  );
  const parent = new Map(state.harbors.map((harbor) => [harbor.code, harbor.code]));
  const root = (code: string): string => {
    const parentCode = parent.get(code)!;
    if (parentCode === code) return code;
    const result = root(parentCode);
    parent.set(code, result);
    return result;
  };
  for (const candidate of candidates) {
    const ar = root(candidate.a.code),
      br = root(candidate.b.code);
    if (ar === br) continue;
    parent.set(ar, br);
    state.ferryEdges.push(
      Object.freeze({
        code: `${NETWORK_CODE}/FERRY/${candidate.a.continent}--${candidate.b.continent}`,
        kind: "ferry",
        from: candidate.a.nodeCode,
        to: candidate.b.nodeCode,
        fromHarborCode: candidate.a.code,
        toHarborCode: candidate.b.code,
        distanceM: candidate.distanceM,
      }),
    );
    if (state.ferryEdges.length === state.harbors.length - 1) break;
  }
}

function networkDigest(state: MutableNetwork) {
  const pieces = [
    ...state.nodes.map(
      (node) =>
        `N:${node.code}:${node.position.lon.toFixed(9)}:${node.position.lat.toFixed(9)}`,
    ),
    ...state.roadEdges.map(
      (edge) =>
        `R:${edge.code}:${edge.from}:${edge.to}:${edge.routeCandidate}:${edge.centerline
          .map(
            (point) =>
              `${point.x.toFixed(4)},${point.z.toFixed(4)},${point.elevationM.toFixed(3)}`,
          )
          .join(";")}`,
    ),
    ...state.ferryEdges.map(
      (edge) => `F:${edge.code}:${edge.from}:${edge.to}:${edge.distanceM.toFixed(3)}`,
    ),
    ...state.bridges.map(
      (bridge) =>
        `B:${bridge.code}:${bridge.x.toFixed(4)}:${bridge.z.toFixed(4)}:${bridge.spanM.toFixed(3)}`,
    ),
    ...state.borderCrossings.map(
      (crossing) =>
        `X:${crossing.code}:${crossing.x.toFixed(4)}:${crossing.z.toFixed(4)}`,
    ),
  ].sort();
  return digestNumber(pieces.join("\n")).toString(16).padStart(8, "0");
}

export function buildTransportNetwork(): TransportNetwork {
  const state: MutableNetwork = {
    nodes: [],
    roadEdges: [],
    ferryEdges: [],
    bridges: [],
    borderCrossings: [],
    harbors: [],
  };
  for (const place of [...cities, ...villages]) state.nodes.push(nodeForPlace(place));
  for (const junction of roadJunctions) state.nodes.push(nodeForJunction(junction));
  const nodeBySourceId = new Map(state.nodes.map((node) => [node.sourceId, node])),
    baseRoads = geographyRoads.filter(
      (road) => !road.code.startsWith(`${NETWORK_CODE}/ROAD/`),
    );
  for (const road of baseRoads) {
    const edge = baseRoadEdge(road, nodeBySourceId);
    attachBaseBridges(state, edge);
    state.roadEdges.push(edge);
  }

  addInternationalRoads(state);
  for (const continent of [
    ...new Set(countries.map((country) => country.continent)),
  ].sort((a, b) => a - b))
    addHarbor(state, continent);
  addFerries(state);

  const incident = new Map<string, string[]>();
  for (const edge of state.roadEdges)
    for (const nodeCode of [edge.from, edge.to]) {
      const list = incident.get(nodeCode) ?? [];
      list.push(edge.code);
      incident.set(nodeCode, list);
    }
  const junctions = state.nodes.flatMap((node) => {
    const edges = [...(incident.get(node.code) ?? [])].sort();
    return edges.length >= 3
      ? [
          Object.freeze({
            code: `${NETWORK_CODE}/JUNCTION/${node.sourceId}`,
            nodeCode: node.code,
            position: node.position,
            edgeCodes: Object.freeze(edges),
          }),
        ]
      : [];
  });

  const digest = networkDigest(state),
    frozenRoads = state.roadEdges.map((edge) =>
      Object.freeze({
        ...edge,
        countryCodes: Object.freeze([...edge.countryCodes]),
        centerline: Object.freeze([...edge.centerline]),
        bridgeCodes: Object.freeze([...edge.bridgeCodes]),
      }),
    ) as readonly TransportRoadEdge[];
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
  const from = transportNetwork.nodes.find((node) => node.code === edge.from)!,
    to = transportNetwork.nodes.find((node) => node.code === edge.to)!,
    first = edge.centerline[0],
    last = edge.centerline.at(-1)!,
    xs = edge.centerline.map((point) => first.x + wrapSourceX(point.x - first.x)),
    zs = edge.centerline.map((point) => point.z),
    surfaceLengthM = physicalLength(edge.centerline),
    travel = travelMetrics(surfaceLengthM, "good-road");
  return {
    code: edge.code,
    networkId: edge.code,
    networkKind: edge.roadClass === "continuity" ? "detour" : "link",
    coarseFallback: false,
    from: from.sourceId,
    to: to.sourceId,
    fromX: first.x,
    toX: first.x + wrapSourceX(last.x - first.x),
    fromZ: first.z,
    toZ: last.z,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    z: (first.z + last.z) / 2,
    fromPosition: from.position,
    toPosition: to.position,
    presentationLengthSourceUnits: edge.centerline
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum +
          Math.hypot(
            wrapSourceX(point.x - edge.centerline[index].x),
            point.z - edge.centerline[index].z,
          ),
        0,
      ),
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: edge.centerline.map((point) => ({
      x: point.x,
      z: point.z,
      position: point.position,
    })),
  };
}

const existingRoads = new Map(geographyRoads.map((road) => [road.code, road]));
for (const edge of transportNetwork.roadEdges)
  if (!existingRoads.has(edge.code)) {
    const road = roadSurfaceRecord(edge);
    geographyRoads.push(road);
    existingRoads.set(road.code, road);
  }
export const transportSurfaceRoads: readonly Road[] = Object.freeze(
  transportNetwork.roadEdges.map((edge) => existingRoads.get(edge.code)!),
);

const transportBuckets = new Map<string, TransportRoadEdge[]>(),
  bucketKey = (x: number, z: number) => `${x}/${z}`;
for (const edge of transportNetwork.roadEdges) {
  const path = {
    fromX: edge.centerline[0].x,
    fromZ: edge.centerline[0].z,
    toX: edge.centerline.at(-1)!.x,
    toZ: edge.centerline.at(-1)!.z,
    centerline: edge.centerline,
  };
  for (const [x, z] of canonicalRoadBucketCells(
    path,
    TRANSPORT_LIMITS.spatialBucketSource,
    0,
    SOURCE_PRESENTATION_WIDTH,
  )) {
    const key = bucketKey(x, z),
      bucket = transportBuckets.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.code === edge.code)) bucket.push(edge);
    transportBuckets.set(key, bucket);
  }
}
for (const bucket of transportBuckets.values())
  bucket.sort((a, b) => a.code.localeCompare(b.code));

export function transportRoadsNear(
  x: number,
  z: number,
  radiusSource: number,
  limit = TRANSPORT_LIMITS.queryRoadLimit,
) {
  if (
    !Number.isFinite(radiusSource) ||
    radiusSource <= 0 ||
    radiusSource > 16_384
  )
    throw new RangeError("Transport road query radius outside bounded presentation support");
  const size = TRANSPORT_LIMITS.spatialBucketSource,
    bucketCount = SOURCE_PRESENTATION_WIDTH / size,
    bx = Math.floor(wrapSourceX(x) / size),
    bz = Math.floor(z / size),
    reach = Math.ceil(radiusSource / size),
    found = new Map<string, TransportRoadEdge>();
  for (let dz = -reach; dz <= reach; dz++)
    for (let dx = -reach; dx <= reach; dx++) {
      const canonicalX =
        ((bx + dx + bucketCount / 2) % bucketCount + bucketCount) % bucketCount -
        bucketCount / 2;
      for (const edge of transportBuckets.get(bucketKey(canonicalX, bz + dz)) ?? []) {
        let nearest = Infinity;
        for (let index = 1; index < edge.centerline.length; index++) {
          const a = edge.centerline[index - 1],
            b = edge.centerline[index],
            px = a.x + wrapSourceX(x - a.x),
            vx = wrapSourceX(b.x - a.x),
            vz = b.z - a.z,
            length = vx * vx + vz * vz,
            t = length
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((px - a.x) * vx + (z - a.z) * vz) / length,
                  ),
                )
              : 0;
          nearest = Math.min(
            nearest,
            Math.hypot(px - a.x - vx * t, z - a.z - vz * t),
          );
        }
        if (nearest <= radiusSource) found.set(edge.code, edge);
      }
    }
  return Object.freeze(
    [...found.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .slice(0, Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit))),
  );
}

export function transportAcceptanceSummary() {
  const degree = new Map<string, number>();
  for (const edge of transportNetwork.roadEdges)
    for (const nodeCode of [edge.from, edge.to])
      degree.set(nodeCode, (degree.get(nodeCode) ?? 0) + 1);
  const mandatory = transportNetwork.nodes.filter(
      (node) =>
        node.kind === "capital" || node.kind === "city" || node.kind === "village",
    ),
    uncovered = mandatory.filter((node) => !degree.get(node.code)),
    capitalLinks = transportNetwork.roadEdges.filter((edge) => {
      if (edge.roadClass !== "main" || edge.countryCodes.length !== 2) return false;
      const from = transportNetwork.nodes.find((node) => node.code === edge.from),
        to = transportNetwork.nodes.find((node) => node.code === edge.to);
      return from?.kind === "capital" && to?.kind === "capital";
    });
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
    internationalCapitalLinks: capitalLinks.length,
    mainRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "main").length,
    regionalRoads: transportNetwork.roadEdges.filter(
      (edge) => edge.roadClass === "regional",
    ).length,
    accessRoads: transportNetwork.roadEdges.filter((edge) => edge.roadClass === "access")
      .length,
    limits: TRANSPORT_LIMITS,
  });
}
