from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected patch anchor missing in {path}")
    file.write_text(text.replace(old, new, 1))


replace(
    "src/transport-network.ts",
    'import { freshwaterCrossingAt, freshwaterCrossingSpanMAt, naturalSurfaceAt } from "./hydrology.ts";',
    'import { freshwaterCrossingAt, freshwaterSegmentsAround, naturalSurfaceAt } from "./hydrology.ts";',
)

replace(
    "src/transport-network.ts",
    "function buildRoute(\n",
    '''type LegalBridgeRouteCandidate = Readonly<{
  code: string;
  controls: readonly { x: number; z: number }[];
  detourM: number;
}>;

/**
 * Find bounded, exact freshwater crossings that can be used as deterministic
 * waypoints when the generic road curves cannot legally reach a nearby node.
 * This does not create bridge authority by itself: every returned control path
 * is revalidated by routeCandidate(), which is still the single legality gate.
 */
function legalBridgeRouteCandidates(
  roadCode: string,
  from: TransportNode,
  to: TransportNode,
  allowedCountries: readonly string[],
) {
  const separationM = greatCircleDistance(from.position, to.position);
  if (separationM > 120_000) return Object.freeze([]) as readonly LegalBridgeRouteCandidate[];

  // freshwaterSegmentsAround is intentionally capped at 23 km. Six fixed
  // stations cover the entire <=120 km fallback corridor without introducing
  // camera/runtime-dependent search state or an unbounded global river scan.
  const corridorDx = wrapSourceX(to.x - from.x), corridorDz = to.z - from.z,
    origins = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => sourceToLonLat(from.x + corridorDx * t, from.z + corridorDz * t)),
    segments = new Map<string, ReturnType<typeof freshwaterSegmentsAround>[number]>();
  for (const origin of origins)
    for (const segment of freshwaterSegmentsAround(origin, 23_000)) segments.set(segment.code, segment);

  const candidates: LegalBridgeRouteCandidate[] = [];
  const stations = [0.18, 0.34, 0.5, 0.66, 0.82] as const;
  for (const segment of [...segments.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    const dx = wrapSourceX(segment.bx - segment.ax), dz = segment.bz - segment.az,
      length = Math.hypot(dx, dz);
    if (!length) continue;
    const ux = -dz / length, uz = dx / length;
    for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
      const t = stations[stationIndex], x = segment.ax + dx * t, z = segment.az + dz * t,
        crossing = freshwaterCrossingAt(x, z, ux, uz);
      if (!crossing || crossing.spanM > TRANSPORT_LIMITS.ruralBridgeMaxM) continue;

      // CrossingAt proves 0.01 source unit beyond both union edges is dry. Use
      // twice that support so the adjoining road legs begin on dry ground while
      // the centre control forces routeCandidate to record the actual bridge.
      const a = { x: x + ux * (crossing.lo - 0.02), z: z + uz * (crossing.lo - 0.02) },
        b = { x: x + ux * (crossing.hi + 0.02), z: z + uz * (crossing.hi + 0.02) },
        centre = { x, z },
        aPosition = sourceToLonLat(a.x, a.z), bPosition = sourceToLonLat(b.x, b.z),
        centrePosition = sourceToLonLat(x, z),
        aOwner = countryAtPosition(aPosition), bOwner = countryAtPosition(bPosition),
        centreOwner = countryAtPosition(centrePosition),
        aSurface = naturalSurfaceAt(a.x, a.z), bSurface = naturalSurfaceAt(b.x, b.z);
      if (
        !aOwner || !bOwner || !centreOwner ||
        !allowedCountries.includes(aOwner.code) ||
        !allowedCountries.includes(bOwner.code) ||
        !allowedCountries.includes(centreOwner.code) ||
        aSurface.water.kind !== "none" || bSurface.water.kind !== "none"
      ) continue;

      const aFirst = greatCircleDistance(from.position, aPosition) <= greatCircleDistance(from.position, bPosition),
        near = aFirst ? a : b, far = aFirst ? b : a,
        nearPosition = aFirst ? aPosition : bPosition, farPosition = aFirst ? bPosition : aPosition,
        controls = Object.freeze([
          { x: from.x, z: from.z },
          near,
          centre,
          far,
          { x: to.x, z: to.z },
        ]),
        detourM = greatCircleDistance(from.position, nearPosition) + crossing.spanM + greatCircleDistance(farPosition, to.position);
      candidates.push(Object.freeze({
        code: `${roadCode}/BRIDGE-WAYPOINT/${segment.code.replaceAll("/", "-")}/${stationIndex}`,
        controls,
        detourM,
      }));
    }
  }

  return Object.freeze(
    candidates
      .sort((a, b) => a.detourM - b.detourM || a.code.localeCompare(b.code))
      .slice(0, 48),
  );
}

function buildRoute(
''',
)

replace(
    "src/transport-network.ts",
    '''  if (!best && greatCircleDistance(from.position, to.position) <= 120_000) {
    const planned = planRoute({
      from: from.position,
      to: to.position,
      terrain(position) {
        const source = lonLatToSource(position.lon, position.lat),
          natural = naturalSurfaceAt(source.x, source.z),
          macro = macroSampleAt(position),
          owner = countryAtPosition(position),
          outsideOwner = !owner || !allowedCountries.includes(owner.code),
          unbridgeableRiver = natural.water.kind === "river" &&
            freshwaterCrossingSpanMAt(source.x, source.z) > TRANSPORT_LIMITS.ruralBridgeMaxM;
        return {
          water: outsideOwner || natural.water.kind === "lake" || natural.water.kind === "ocean" || unbridgeableRiver,
          heightM: natural.groundHeight,
          highland: Math.max(macro.mountainIntensity, natural.cliff ? 1 : natural.slope),
        };
      },
    });
    if (planned.found && planned.points.length >= 2 && planned.points.length <= 96) {
      const controls = planned.points.map((point) => lonLatToSource(point.lon, point.lat));
      best = routeCandidate(
        roadCode,
        from,
        to,
        TRANSPORT_LIMITS.routeCandidates,
        allowedCountries,
        requireBorder,
        controls,
      );
    }
  }''',
    '''  if (!best) {
    const bridgeCandidates = legalBridgeRouteCandidates(roadCode, from, to, allowedCountries);
    for (let index = 0; index < bridgeCandidates.length; index++) {
      const route = routeCandidate(
        roadCode,
        from,
        to,
        TRANSPORT_LIMITS.routeCandidates + index,
        allowedCountries,
        requireBorder,
        bridgeCandidates[index].controls,
      );
      if (!route) continue;
      if (!best || route.cost < best.cost - 1e-7 || (Math.abs(route.cost - best.cost) <= 1e-7 && route.candidate < best.candidate)) best = route;
    }
  }
  if (!best && greatCircleDistance(from.position, to.position) <= 120_000) {
    const planned = planRoute({
      from: from.position,
      to: to.position,
      terrain(position) {
        const source = lonLatToSource(position.lon, position.lat),
          natural = naturalSurfaceAt(source.x, source.z),
          macro = macroSampleAt(position),
          owner = countryAtPosition(position),
          outsideOwner = !owner || !allowedCountries.includes(owner.code);
        return {
          // The generic planner may detour around freshwater, but it may not
          // silently cross it. Exact river crossings are supplied above and
          // revalidated by routeCandidate as explicit bridge records.
          water: outsideOwner || natural.water.kind !== "none",
          heightM: natural.groundHeight,
          highland: Math.max(macro.mountainIntensity, natural.cliff ? 1 : natural.slope),
        };
      },
    });
    if (planned.found && planned.points.length >= 2 && planned.points.length <= 96) {
      const controls = planned.points.map((point) => lonLatToSource(point.lon, point.lat));
      best = routeCandidate(
        roadCode,
        from,
        to,
        TRANSPORT_LIMITS.routeCandidates + 48,
        allowedCountries,
        requireBorder,
        controls,
      );
    }
  }''',
)
