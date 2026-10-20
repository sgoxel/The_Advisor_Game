import type { TransportJunction } from "./transport-network.ts";

/** Seed-stable inverted index; map interactions visit only junctions incident to focused roads. */
export function createTransportJunctionLookup(junctions: readonly TransportJunction[]) {
  const roadToJunctionIndices = new Map<string, number[]>();
  for (let index = 0; index < junctions.length; index++) {
    for (const roadCode of junctions[index].edgeCodes) {
      const indices = roadToJunctionIndices.get(roadCode) ?? [];
      indices.push(index);
      roadToJunctionIndices.set(roadCode, indices);
    }
  }
  return (nearbyRoadCodes: ReadonlySet<string>): TransportJunction[] => {
    const indices = new Set<number>();
    for (const code of nearbyRoadCodes)
      for (const index of roadToJunctionIndices.get(code) ?? []) indices.add(index);
    // Preserve original draw order and prevent duplicate Y-junction markers.
    return [...indices].sort((a, b) => a - b).map((index) => junctions[index]);
  };
}
