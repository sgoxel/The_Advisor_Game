import type { TransportNetwork, TransportRoadEdge } from "./transport-network.ts";

/**
 * Read-only shortest walking preview over the already-constructed SEED-owned
 * transport graph. This never substitutes for final-surface traversal validation
 * and deliberately excludes ferry edges and off-network focus-to-node legs.
 */
export function createTransportWalkingIndex(network: TransportNetwork) {
  type Step = { node: string; edge: TransportRoadEdge };
  const adjacency = new Map<string, Step[]>(network.nodes.map(node => [node.code, []]));
  for (const edge of network.roadEdges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to) ||
        !Number.isFinite(edge.surfaceLengthM) || edge.surfaceLengthM <= 0 ||
        !Number.isFinite(edge.fantasyWalkSeconds) || edge.fantasyWalkSeconds <= 0)
      throw new Error(`Invalid canonical walking edge ${edge.code}`);
    adjacency.get(edge.from)!.push({ node: edge.to, edge });
    adjacency.get(edge.to)!.push({ node: edge.from, edge });
  }
  for (const list of adjacency.values()) list.sort((a, b) =>
    a.edge.code < b.edge.code ? -1 : a.edge.code > b.edge.code ? 1 :
    a.node < b.node ? -1 : a.node > b.node ? 1 : 0);
  return Object.freeze({ adjacency, nodeCount: network.nodes.length });
}

type Index = ReturnType<typeof createTransportWalkingIndex>;
type HeapEntry = { code: string; lengthM: number };
const earlier = (a: HeapEntry, b: HeapEntry) => a.lengthM < b.lengthM ||
  (a.lengthM === b.lengthM && a.code < b.code);

/** Bounded by canonical graph size; no recursive search, viewport or LOD inputs. */
export function transportWalkingRoute(index: Index, from: string, to: string) {
  if (!index.adjacency.has(from) || !index.adjacency.has(to)) return null;
  const heap: HeapEntry[] = [], distances = new Map([[from, 0]]),
    parent = new Map<string, { previous: string; edge: TransportRoadEdge }>(),
    settled = new Set<string>();
  const push = (entry: HeapEntry) => {
    let position = heap.length;
    heap.push(entry);
    while (position > 0) {
      const up = (position - 1) >> 1;
      if (!earlier(entry, heap[up])) break;
      heap[position] = heap[up];
      position = up;
    }
    heap[position] = entry;
  };
  const pop = (): HeapEntry => {
    const top = heap[0], tail = heap.pop()!;
    if (heap.length) {
      let position = 0;
      while (position * 2 + 1 < heap.length) {
        let child = position * 2 + 1;
        if (child + 1 < heap.length && earlier(heap[child + 1], heap[child])) child++;
        if (!earlier(heap[child], tail)) break;
        heap[position] = heap[child];
        position = child;
      }
      heap[position] = tail;
    }
    return top;
  };
  push({ code: from, lengthM: 0 });
  while (heap.length && settled.size < index.nodeCount) {
    const current = pop();
    if (settled.has(current.code) || current.lengthM !== distances.get(current.code)) continue;
    settled.add(current.code);
    if (current.code === to) {
      const edges: TransportRoadEdge[] = [];
      for (let cursor = to; cursor !== from;) {
        const previous = parent.get(cursor);
        if (!previous) throw new Error("Incomplete canonical walking predecessor chain");
        edges.push(previous.edge);
        cursor = previous.previous;
      }
      edges.reverse();
      return Object.freeze({
        from, to,
        edgeCodes: Object.freeze(edges.map(edge => edge.code)),
        distanceM: edges.reduce((sum, edge) => sum + edge.surfaceLengthM, 0),
        fantasyWalkSeconds: edges.reduce((sum, edge) => sum + edge.fantasyWalkSeconds, 0),
        exploredNodes: settled.size,
      });
    }
    for (const step of index.adjacency.get(current.code)!) {
      if (settled.has(step.node)) continue;
      const candidate = current.lengthM + step.edge.surfaceLengthM,
        previous = distances.get(step.node);
      if (previous === undefined || candidate < previous) {
        distances.set(step.node, candidate);
        parent.set(step.node, { previous: current.code, edge: step.edge });
        push({ code: step.node, lengthM: candidate });
      }
    }
  }
  return null; // Explicitly disconnected walking graph; never use maritime shortcuts.
}
