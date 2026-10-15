from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        return
    file.write_text(text.replace(old, new, 1))


replace(
    "src/transport-network.ts",
    'import { freshwaterCrossingAt, naturalSurfaceAt } from "./hydrology.ts";',
    'import { freshwaterCrossingAt, freshwaterCrossingSpanMAt, naturalSurfaceAt } from "./hydrology.ts";',
)
replace(
    "src/transport-network.ts",
    'import { travelMetrics } from "./travel.ts";',
    'import { travelMetrics } from "./travel.ts";\nimport { planRoute } from "./routing.ts";',
)
replace(
    "src/transport-network.ts",
    "  requireBorder: boolean,\n): RouteBuild | undefined {\n  const controls = pathControls(from, to, candidate, roadCode), samples = samplePolyline(controls);",
    "  requireBorder: boolean,\n  overrideControls?: readonly { x: number; z: number }[],\n): RouteBuild | undefined {\n  const controls = overrideControls ?? pathControls(from, to, candidate, roadCode), samples = samplePolyline(controls);",
)
replace(
    "src/transport-network.ts",
    "  if (!best) throw new Error(`No legal deterministic transport route for ${roadCode}`);\n  return best;",
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
  }
  if (!best) throw new Error(`No legal deterministic transport route for ${roadCode}`);
  return best;''',
)
