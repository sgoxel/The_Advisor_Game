export type NpcModelEntry = { url: string; heightM: number; triangles: number; rigged: boolean };
export type NpcModelManifest = { version: number; characters: Record<string, NpcModelEntry> };

let current: NpcModelManifest = { version: 1, characters: {} };
let checked = 0;
let pending: Promise<NpcModelManifest> | undefined;

/** The batch publishes each validated model atomically; refresh during long sessions. */
export function npcModels(): Promise<NpcModelManifest> {
  if (pending) return pending;
  if (Date.now() - checked < 60_000) return Promise.resolve(current);
  pending = fetch(new URL('models/npcs/manifest.json', document.baseURI), { cache: 'no-cache' })
    .then(async response => {
      if (!response.ok) throw new Error(`NPC model manifest: ${response.status}`);
      current = await response.json() as NpcModelManifest;
      return current;
    })
    .catch(() => current)
    .finally(() => { checked = Date.now(); pending = undefined; });
  return pending;
}
