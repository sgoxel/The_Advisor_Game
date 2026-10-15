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
replace(
    "src/transport-network.ts",
    '''function neighboringCapital(stateNodes: readonly TransportNode[], country: Country) {
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
}''',
    '''function neighboringCapitals(stateNodes: readonly TransportNode[], country: Country) {
  const from = stateNodes.find((node) => node.kind === "capital" && node.countryCode === country.code)!;
  return countries
    .filter((candidate) => candidate.continent === country.continent && candidate.code !== country.code)
    .map((candidate) => ({ candidate, distance: greatCircleDistance(from.position, capitalFor(candidate).canonicalPosition) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.code.localeCompare(b.candidate.code))
    .slice(0, TRANSPORT_LIMITS.internationalCandidates)
    .filter(({ candidate }) => {
      const to = stateNodes.find((node) => node.kind === "capital" && node.countryCode === candidate.code)!;
      const sequence = politicalSequence(from, to);
      return sequence.length === 2 && sequence[0] === country.code && sequence[1] === candidate.code;
    })
    .map(({ candidate }) => candidate);
}''',
)
replace(
    "src/transport-network.ts",
    '''  // Each village gets one canonical access road to its city.  All approaches
  // therefore meet at the same city node instead of merely crossing on screen.
  for (const village of villages) {
    const cityId = village.id.split("/").slice(0, 3).join("/"), from = nodeBySourceId.get(village.id)!, to = nodeBySourceId.get(cityId)!;
    addRoad(state, from, to, "access", `VILLAGE/${village.code}`);
  }''',
    '''  // Build each city/village cluster as a deterministic rooted tree.  A village
  // first tries the city, then already-connected sibling villages by distance.
  // Difficult terrain can therefore redirect an approach without disconnecting
  // the settlement or inventing a second graph.
  for (const city of cities) {
    const cityNode = nodeBySourceId.get(city.id)!,
      localVillages = villages.filter((village) => village.id.startsWith(`${city.id}/`)).sort((a, b) => a.id.localeCompare(b.id)),
      connected: TransportNode[] = [cityNode];
    for (const village of localVillages) {
      const from = nodeBySourceId.get(village.id)!,
        parents = [...connected].sort((a, b) => greatCircleDistance(from.position, a.position) - greatCircleDistance(from.position, b.position) || a.code.localeCompare(b.code));
      let linked = false;
      for (const parent of parents) {
        try {
          addRoad(state, from, parent, "access", `VILLAGE/${village.code}/TO/${parent.sourceId.replaceAll("/", "-")}`);
          connected.push(from);
          linked = true;
          break;
        } catch {
          // Try the next already-connected canonical settlement; ordering is fixed.
        }
      }
      if (!linked) throw new Error(`No legal settlement access route for ${village.code}`);
    }
  }''',
)
replace(
    "src/transport-network.ts",
    '''  const internationalPairs = new Set<string>();
  for (const country of countries) {
    const neighbor = neighboringCapital(state.nodes, country), pair = edgePairKey(country.code, neighbor.code);
    if (internationalPairs.has(pair)) continue;
    internationalPairs.add(pair);
    const from = state.nodes.find((node) => node.kind === "capital" && node.countryCode === country.code)!,
      to = state.nodes.find((node) => node.kind === "capital" && node.countryCode === neighbor.code)!;
    addRoad(state, from, to, "main", `CAPITAL/${country.code}--${neighbor.code}`, true);
  }''',
    '''  const internationalPairs = new Set<string>(), internationalCountries = new Set<string>();
  for (const country of countries) {
    if (internationalCountries.has(country.code)) continue;
    const from = state.nodes.find((node) => node.kind === "capital" && node.countryCode === country.code)!;
    let linked = false;
    for (const neighbor of neighboringCapitals(state.nodes, country)) {
      const pair = edgePairKey(country.code, neighbor.code);
      if (internationalPairs.has(pair)) {
        internationalCountries.add(country.code);
        internationalCountries.add(neighbor.code);
        linked = true;
        break;
      }
      const to = state.nodes.find((node) => node.kind === "capital" && node.countryCode === neighbor.code)!;
      try {
        addRoad(state, from, to, "main", `CAPITAL/${country.code}--${neighbor.code}`, true);
        internationalPairs.add(pair);
        internationalCountries.add(country.code);
        internationalCountries.add(neighbor.code);
        linked = true;
        break;
      } catch {
        // Continue through deterministic political neighbors until one legal road fits.
      }
    }
    if (!linked) throw new Error(`No legal international capital route for ${country.code}`);
  }''',
)
replace(
    "src/transport-network.ts",
    '''for (const edge of transportNetwork.roadEdges) {
  const road = roadSurfaceRecord(edge), cx = (road.minX + road.maxX) * 0.5, cz = (road.minZ + road.maxZ) * 0.5,
    key = bucketKey(cx, cz), bucket = transportBuckets.get(key) ?? [];
  bucket.push(edge);
  transportBuckets.set(key, bucket);
}''',
    '''for (const edge of transportNetwork.roadEdges) {
  for (const point of edge.centerline) {
    const key = bucketKey(point.x, point.z), bucket = transportBuckets.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.code === edge.code)) bucket.push(edge);
    transportBuckets.set(key, bucket);
  }
}''',
)
