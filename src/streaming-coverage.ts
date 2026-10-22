import type { Tile } from './world.ts';

export type TileJobKind = 'coverage' | 'detail';
export type TileJob = { tile: Tile; kind: TileJobKind };
export const coverageKey = (tile: Tile) => `coverage/${tile.key}`;
export const tileJobKey = ({tile,kind}: TileJob) => kind === 'coverage' ? coverageKey(tile) : tile.key;

/** One outstanding worker job. Recompute priority from the live view instead of
 * posting a FIFO backlog that continues after the player reverses the wheel. */
export function nextStreamingJob(root: Tile, wanted: Tile[], coverage: Tile[], cached: Pick<ReadonlySet<string>,'has'>): TileJob | undefined {
  if (!cached.has(root.key)) return {tile:root,kind:'detail'};
  if (wanted.every(tile=>cached.has(tile.key))) return;
  const coarse = coverage.find(tile=>!cached.has(coverageKey(tile)));
  if (coarse) return {tile:coarse,kind:'coverage'};
  const fine = wanted.find(tile=>!cached.has(tile.key));
  if (fine) return {tile:fine,kind:'detail'};
}

/** Keep existing world geometry until a complete overlapping LOD replacement
 * is ready. Disjoint new regions may arrive progressively without clearing the
 * already visible buildings/roads or drawing overlapping parent/child meshes. */
export function progressiveDetailKeys(
 wanted: string[], cached: Pick<ReadonlySet<string>,'has'>, active: string[], covered: boolean,
 overlaps: (a:string,b:string)=>boolean = ()=>true, limit=Infinity,
): string[] {
 if(wanted.every(key=>cached.has(key)))return wanted;
 if(!covered)return active;
 const retained=active.filter(key=>wanted.some(target=>overlaps(key,target))),
  available=wanted.filter(key=>cached.has(key)),
  replacements=available.filter(key=>!retained.some(old=>overlaps(old,key)&&wanted.some(target=>overlaps(old,target)&&!cached.has(target)))),
  next=[...new Set([...retained.filter(old=>!replacements.some(key=>overlaps(old,key))),...replacements])];
 // Preserve the render headroom for outgoing/incoming LOD sets and terrain.
 // A complete cached destination can always replace the old set immediately.
 return next.length<=limit?next:retained;
}

export function visibleCoverageKeys(keys: string[], cached: Pick<ReadonlySet<string>,'has'>, fineCount: number, activeLimit: number): string[] {
  // The emergency root also uses one draw slot.
  return keys.filter(key=>cached.has(key)).slice(0,Math.max(0,activeLimit-fineCount-1));
}
