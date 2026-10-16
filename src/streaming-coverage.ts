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

/** Clear foreign old detail onto a complete terrain backdrop before adding new
 * detail. This keeps transient residency bounded and avoids a stale square. */
export function progressiveDetailKeys(wanted: string[], cached: Pick<ReadonlySet<string>,'has'>, active: string[], covered: boolean): string[] {
  if (wanted.every(key=>cached.has(key))) return wanted;
  if (!covered) return active;
  const target = new Set(wanted);
  if (active.some(key=>!target.has(key))) return [];
  return wanted.filter(key=>cached.has(key));
}

export function visibleCoverageKeys(keys: string[], cached: Pick<ReadonlySet<string>,'has'>, fineCount: number, activeLimit: number): string[] {
  // The emergency root also uses one draw slot.
  return keys.filter(key=>cached.has(key)).slice(0,Math.max(0,activeLimit-fineCount-1));
}
