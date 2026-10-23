import { greatCircleDistance, type LonLat } from "./planet.ts";
import type { TransportBridge, TransportNetwork, TransportNode, TransportRoadEdge } from "./transport-network.ts";

/**
 * Read-only shortest walking preview over the already-constructed SEED-owned
 * transport graph. This never substitutes for final-surface traversal validation
 * and deliberately excludes ferry edges and off-network focus-to-node legs.
 */
export function createTransportWalkingIndex(network: TransportNetwork) {
  type Step = { node: string; edge: TransportRoadEdge };
  const adjacency = new Map<string, Step[]>(), edgeCodes = new Set<string>();
  for (const node of network.nodes) {
    // Distinct SEED locations must never collapse into one walking graph node.
    if (adjacency.has(node.code)) throw new Error(`Duplicate canonical walking node ${node.code}`);
    adjacency.set(node.code, []);
  }
  for (const edge of network.roadEdges) {
    // Route previews and physical corridor recipes both resolve edges by code.
    // Duplicate identities would silently select unrelated geometry.
    if (edgeCodes.has(edge.code)) throw new Error(`Duplicate canonical walking edge ${edge.code}`);
    edgeCodes.add(edge.code);
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
type WalkingResult = Readonly<{
  from: string; to: string; edgeCodes: readonly string[];
  distanceM: number; fantasyWalkSeconds: number; exploredNodes: number;
}> | null;
const WALKING_ROUTE_CACHE_LIMIT = 12;
const WALKING_UNSAFE_EXCLUSION_LIMIT = 12;
// A SEED walking index is fixed for the campaign; reuse only its own finite,
// read-only graph answers across repeated selections and semantic zoom levels.
const walkingRouteCaches = new WeakMap<Index, Map<string, WalkingResult>>();
type HeapEntry = { code: string; lengthM: number };
const earlier = (a: HeapEntry, b: HeapEntry) => a.lengthM < b.lengthM ||
  (a.lengthM === b.lengthM && a.code < b.code);

/** Bounded by canonical graph size; no recursive search, viewport or LOD inputs. */
function searchWalkingRoute(
  index: Index, from: string, destinations: ReadonlySet<string>,
  excludedEdgeCode?: string, unsafeRoadCodes?: ReadonlySet<string>,
) {
  if (!index.adjacency.has(from) || !destinations.size ||
      (unsafeRoadCodes?.size ?? 0) > WALKING_UNSAFE_EXCLUSION_LIMIT) return null;
  let cache = walkingRouteCaches.get(index);
  if (!cache) { cache = new Map(); walkingRouteCaches.set(index, cache); }
  // Destination order/duplicates cannot alter an authoritative route, while a
  // bridge's excluded road must never borrow an unconstrained cached answer.
  // Explicitly unsafe physical roads may be excluded from a new graph preview.
  // This produces only an alternate graph hypothesis, never a physical PASS.
  const excluded = new Set(unsafeRoadCodes);
  if (excludedEdgeCode) excluded.add(excludedEdgeCode);
  const key = JSON.stringify([from, [...destinations].sort(), [...excluded].sort()]);
  if (cache.has(key)) {
    const cached = cache.get(key)!;
    cache.delete(key); cache.set(key, cached);
    return cached;
  }
  const remember = (answer: WalkingResult) => {
    cache!.set(key, answer);
    if (cache!.size > WALKING_ROUTE_CACHE_LIMIT)
      cache!.delete(cache!.keys().next().value!);
    return answer;
  };
  const heap: HeapEntry[] = [], distances = new Map([[from, 0]]),
    travelSeconds = new Map([[from, 0]]),
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
      return remember(Object.freeze({
        from, to: current.code,
        edgeCodes: Object.freeze(edges.map(edge => edge.code)),
        distanceM: current.lengthM,
        fantasyWalkSeconds: travelSeconds.get(current.code)!,
        exploredNodes: settled.size,
      }));
    }
    for (const step of index.adjacency.get(current.code)!) {
      if (excluded.has(step.edge.code) || settled.has(step.node)) continue;
      const candidate = current.lengthM + step.edge.surfaceLengthM,
        duration = travelSeconds.get(current.code)! + step.edge.fantasyWalkSeconds,
        previous = distances.get(step.node);
      // Finite per-edge facts must not accumulate into infinite route claims.
      if (!Number.isFinite(candidate) || !Number.isFinite(duration)) continue;
      if (previous === undefined || candidate < previous) {
        distances.set(step.node, candidate);
        travelSeconds.set(step.node, duration);
        parent.set(step.node, { previous: current.code, edge: step.edge });
        push({ code: step.node, lengthM: candidate });
      }
    }
  }
  return remember(null); // Explicitly disconnected walking graph; never use maritime shortcuts.
}

/** One graph search picks the shortest reachable destination, not the closest unverified straight-line target. */
export function transportWalkingRouteToNearest(
  index: Index, from: string, siteCodes: readonly string[],
  unsafeRoadCodes?: ReadonlySet<string>,
) {
  return searchWalkingRoute(index, from,
    new Set(siteCodes.filter(code => index.adjacency.has(code))), undefined, unsafeRoadCodes);
}

/** A specific requested endpoint retains the same deterministic route semantics. */
export function transportWalkingRoute(
  index: Index, from: string, to: string,
  unsafeRoadCodes?: ReadonlySet<string>,
) {
  return searchWalkingRoute(index, from, new Set([to].filter(code => index.adjacency.has(code))),
    undefined, unsafeRoadCodes);
}

/**
 * A selected bridge preview continues from the far canonical bank. A bridge
 * crossing a country border must search that bank's sites, not silently
 * require a route back into the starting country.
 */
export function selectedBridgePreviewDestinationBank(
  from: Pick<TransportNode, "code">,
  edge: Pick<TransportRoadEdge, "from" | "to">,
  nodes: ReadonlyMap<string, TransportNode>,
): TransportNode | undefined {
  const farCode = edge.from === from.code ? edge.to
    : edge.to === from.code ? edge.from : undefined;
  return farCode ? nodes.get(farCode) : undefined;
}

/**
 * Bridge-selected previews must actually include their chosen graph road.
 * Traverse that exact SEED edge once from the selected bank, then search the
 * remainder without retracing it. If no such walking path exists, fail closed.
 * This is still graph metadata, never proof of final-surface passage.
 */
export function transportWalkingRouteThroughEdge(
  index: Index, from: string, required: Pick<TransportRoadEdge, "code" | "from" | "to">,
  siteCodes: readonly string[], unsafeRoadCodes?: ReadonlySet<string>,
) {
  // A required selected bridge cannot be certified by a route which excludes it.
  if (unsafeRoadCodes?.has(required.code) || (from !== required.from && from !== required.to)) return null;
  const otherBank = from === required.from ? required.to : required.from,
    owned = index.adjacency.get(from)?.find(step =>
      step.edge.code === required.code && step.node === otherBank &&
      step.edge.from === required.from && step.edge.to === required.to);
  if (!owned) return null;
  const destinations = new Set(siteCodes.filter(code => index.adjacency.has(code)));
  const continuation = searchWalkingRoute(index, otherBank, destinations, required.code, unsafeRoadCodes);
  if (!continuation) return null;
  const edge = owned.edge,
    distanceM = edge.surfaceLengthM + continuation.distanceM,
    fantasyWalkSeconds = edge.fantasyWalkSeconds + continuation.fantasyWalkSeconds;
  if (!Number.isFinite(distanceM) || !Number.isFinite(fantasyWalkSeconds)) return null;
  return Object.freeze({
    from, to: continuation.to,
    edgeCodes: Object.freeze([edge.code, ...continuation.edgeCodes]),
    distanceM,
    fantasyWalkSeconds,
    exploredNodes: continuation.exploredNodes,
  });
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
  selectedBridge?: Pick<TransportBridge, "code" | "roadCode" | "position">,
): TransportNode | undefined {
  if (!selection) return fallbackRoad && nearestWalkingRoadEndpoint(fallbackRoad, nodes, focus);
  if (selection.kind === "ferry") return undefined;
  if (selection.kind === "junction" || selection.kind === "harbor") {
    const nodeCode = selection.kind === "junction"
      ? network.junctions.find(item => item.code === selection.code)?.nodeCode
      : network.harbors.find(item => item.code === selection.code)?.nodeCode;
    const node = nodeCode ? nodes.get(nodeCode) : undefined;
    return node?.kind === selection.kind ? node : undefined;
  }
  const border = selection.kind === "border"
    ? network.borderCrossings.find(item => item.code === selection.code) : undefined;
  const bridge = selection.kind === "bridge" && selectedBridge?.code === selection.code
    ? selectedBridge : undefined;
  const roadCode = selection.kind === "road" || selection.kind === "lake-detour" ? selection.code
    : selection.kind === "border" ? border?.roadCode
    : selection.kind === "bridge" ? bridge?.roadCode : undefined;
  const road = roadCode && network.roadEdges.find(edge => edge.code === roadCode);
  // A selected SEED crossing keeps its physical bank even after camera pan.
  // Ordinary selected roads still use focus to choose their nearest endpoint.
  return road ? nearestWalkingRoadEndpoint(road, nodes, border?.position ?? bridge?.position ?? focus) : undefined;
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
