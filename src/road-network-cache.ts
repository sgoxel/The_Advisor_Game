/**
 * Precomputed macro road network (build-time world cache). The network is a
 * pure function of the SEED, the settlement registry and the road generator,
 * so it is generated once by tools/build-world-cache.ts and shipped as JSON.
 * The fingerprint covers every input; on any mismatch the caller routes live.
 * tests/world-cache.test.ts regenerates it and fails if the file is stale.
 */
import cache from "./generated/road-network.json" with { type: "json" };
import { MACRO_ROAD_VERSION, type createMacroRoadNetwork } from "./macro-road-network.ts";

type RoadNetwork = ReturnType<typeof createMacroRoadNetwork>;
type FingerprintPlace = { id: string; canonicalPosition: { lon: number; lat: number } };

/** Two independent FNV-1a lanes over the exact inputs (64-bit fingerprint as hex). */
export function roadNetworkFingerprint(seed: string, places: readonly FingerprintPlace[], links: readonly (readonly [FingerprintPlace, FingerprintPlace])[]) {
  let a = 2166136261, b = 3166136261;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ (code + 31 * index), 2246822519);
    }
  };
  feed(`${seed}|${MACRO_ROAD_VERSION}|${places.length}|${links.length}`);
  for (const place of places) feed(`${place.id}:${place.canonicalPosition.lon}:${place.canonicalPosition.lat};`);
  for (const [from, to] of links) feed(`${from.id}>${to.id};`);
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** The shipped network when it was built from exactly these inputs, otherwise undefined. */
export function cachedRoadNetwork(fingerprint: string): RoadNetwork | undefined {
  const stored = cache as { fingerprint: string; network: RoadNetwork | null };
  if (!stored.network || stored.fingerprint !== fingerprint) {
    if (typeof console !== "undefined") console.warn(`World cache: road network ${stored.network ? "is stale" : "missing"}; routing roads live (slow start).`);
    return undefined;
  }
  // Fresh arrays per load: geography releases its edge list after deriving roads and the transport
  // network appends its extension connections, so the shipped JSON module object is never mutated.
  return { ...stored.network, edges: [...stored.network.edges], connections: [...stored.network.connections], junctions: [...stored.network.junctions] } as RoadNetwork;
}
