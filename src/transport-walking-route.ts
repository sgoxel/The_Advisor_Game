import { greatCircleDistance, type LonLat } from "./planet.ts";
import type { TransportNetwork, TransportNode, TransportRoadEdge } from "./transport-network.ts";

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
function searchWalkingRoute(index: Index, from: string, destinations: ReadonlySet<string>) {
  if (!index.adjacency.has(from) || !destinations.size) return null;
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
    if (destinations.has(current.code)) {
      const edges: TransportRoadEdge[] = [];
      for (let cursor = current.code; cursor !== from;) {
        const previous = parent.get(cursor);
        if (!previous) throw new Error("Incomplete canonical walking predecessor chain");
        edges.push(previous.edge);
        cursor = previous.previous;
      }
      edges.reverse();
      return Object.freeze({
        from, to: current.code,
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

/** One graph search picks the shortest reachable destination, not the closest unverified straight-line target. */
export function transportWalkingRouteToNearest(index: Index, from: string, siteCodes: readonly string[]) {
  return searchWalkingRoute(index, from, new Set(siteCodes.filter(code => index.adjacency.has(code))));
}

/** A specific requested endpoint retains the same deterministic route semantics. */
export function transportWalkingRoute(index: Index, from: string, to: string) {
  return searchWalkingRoute(index, from, new Set([to].filter(code => index.adjacency.has(code))));
}

/**
 * Source X/Z is a flat projection, not a physical distance at high latitudes.
 * Choose the real geodesically closest legal graph endpoint for a map preview.
 * This selects an inspection origin only; it never moves the character.
 */
export function nearestWalkingRoadEndpoint(
  edge: Pick<TransportRoadEdge, "from" | "to">,
  nodes: ReadonlyMap<string, TransportNode>,
  focus: LonLat,
): TransportNode | undefined {
  let best: TransportNode | undefined;
  let bestDistance = Infinity;
  for (const code of [edge.from, edge.to]) {
    const node = nodes.get(code);
    if (!node || node.kind === "site") continue;
    const distance = greatCircleDistance(focus, node.position);
    if (distance < bestDistance || (distance === bestDistance && (!best || node.code < best.code))) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Land route previews must originate at the actual selected graph node/road.
 * A selected ferry is not an implicit walking leg. No selection falls back to
 * the geographically nearest local road; an invalid selection fails closed.
 * This chooses graph facts only and does not move an actor.
 */
export function selectedWalkingPreviewOrigin(
  selection: { kind: string; code: string } | undefined,
  focus: LonLat,
  network: Pick<TransportNetwork, "junctions" | "harbors" | "borderCrossings" | "roadEdges">,
  nodes: ReadonlyMap<string, TransportNode>,
  fallbackRoad?: TransportRoadEdge,
  bridgeRoadCode?: string,
): TransportNode | undefined {
  if (!selection) return fallbackRoad && nearestWalkingRoadEndpoint(fallbackRoad, nodes, focus);
  if (selection.kind === "ferry") return undefined;
  if (selection.kind === "junction" || selection.kind === "harbor") {
    const nodeCode = selection.kind === "junction"
      ? network.junctions.find(item => item.code === selection.code)?.nodeCode
      : network.harbors.find(item => item.code === selection.code)?.nodeCode;
    const node = nodeCode && nodes.get(nodeCode);
    return node?.kind === selection.kind ? node : undefined;
  }
  const roadCode = selection.kind === "road" || selection.kind === "lake-detour" ? selection.code
    : selection.kind === "border" ? network.borderCrossings.find(item => item.code === selection.code)?.roadCode
    : selection.kind === "bridge" ? bridgeRoadCode : undefined;
  const road = roadCode && network.roadEdges.find(edge => edge.code === roadCode);
  return road ? nearestWalkingRoadEndpoint(road, nodes, focus) : undefined;
}

/** Overlay only: project/highlight at most the already focus-bounded road query. */
export function visibleWalkingPreviewEdgeCodes(
  route: { readonly edgeCodes: readonly string[] } | null,
  nearby: readonly Pick<TransportRoadEdge, "code">[],
): ReadonlySet<string> {
  const wanted = new Set(route?.edgeCodes ?? []), visible = new Set<string>();
  for (const edge of nearby) if (wanted.has(edge.code)) visible.add(edge.code);
  return visible;
}
