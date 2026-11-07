/**
 * Player-chosen protagonist (owner request, 2026-11-07).
 *
 * The game has no fixed protagonist: the player — who is the Advisor — assigns
 * any SEED resident as the person they advise. This module owns only that player
 * choice. It is deliberately NOT world authority:
 *
 *  - it never creates, moves or renames a resident;
 *  - it never decides whether a code exists (the caller resolves the code
 *    against the real Simulation and rejects unknown ones);
 *  - it stores a preference, so clearing it simply means "advise the nearest".
 *
 * The stored value is a canonical resident code, so it survives reloads without
 * inventing any new world state.
 */

/** Canonical SEED resident code: "<place code>/RESIDENT/<index>". */
const RESIDENT_CODE = /^.+?\/RESIDENT\/(0|[1-9][0-9]*)$/;

export const PROTAGONIST_STORAGE_KEY = "advisor.protagonist.v1";
/** Guards against a corrupt or hostile stored value being treated as identity. */
export const PROTAGONIST_MAX_CODE_LENGTH = 512;

export type ProtagonistChangeReason = "user" | "restore" | "clear";

export type ProtagonistListener = (code: string | undefined, reason: ProtagonistChangeReason) => void;

/** True only for a syntactically valid canonical resident code. */
export function isResidentCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= PROTAGONIST_MAX_CODE_LENGTH && RESIDENT_CODE.test(value);
}

let current: string | undefined;
const listeners = new Set<ProtagonistListener>();

function notify(reason: ProtagonistChangeReason): void {
  for (const listener of [...listeners]) {
    try { listener(current, reason); } catch { /* a broken UI listener must not break assignment */ }
  }
}

/** The assigned protagonist code, or undefined when none is chosen. */
export function getProtagonistCode(): string | undefined {
  return current;
}

/**
 * Assign a protagonist. `code` must already have been resolved against the real
 * world by the caller; `undefined` clears the choice. Invalid shapes are ignored
 * so a bad value can never become the advised identity.
 */
export function setProtagonistCode(code: string | undefined, reason: ProtagonistChangeReason = "user"): boolean {
  if (code !== undefined && !isResidentCode(code)) return false;
  if (code === current) return true;
  current = code;
  persist();
  notify(reason);
  return true;
}

/** Clears the assignment explicitly. */
export function clearProtagonist(): void {
  if (current === undefined) return;
  current = undefined;
  persist();
  notify("clear");
}

export function subscribeProtagonist(listener: ProtagonistListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reads the persisted choice. Validates shape only; existence is the caller's job. */
export function readStoredProtagonist(): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(PROTAGONIST_STORAGE_KEY);
    return isResidentCode(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Restores the persisted choice at startup. The caller must pass a resolver that
 * checks the code against the real world; an unresolvable code is dropped rather
 * than silently advising a resident who does not exist.
 */
export function restoreProtagonist(resolve: (code: string) => boolean): string | undefined {
  const stored = readStoredProtagonist();
  if (!stored) { current = undefined; return undefined; }
  let exists = false;
  try { exists = resolve(stored); } catch { exists = false; }
  if (!exists) {
    // Stale campaign or changed SEED: forget it, do not invent a replacement.
    try { globalThis.localStorage?.removeItem(PROTAGONIST_STORAGE_KEY); } catch { /* ignore */ }
    current = undefined;
    return undefined;
  }
  current = stored;
  notify("restore");
  return stored;
}

/** Test hook: reset module state without touching storage semantics. */
export function resetProtagonistForTest(): void {
  current = undefined;
  listeners.clear();
}

function persist(): void {
  try {
    if (current === undefined) globalThis.localStorage?.removeItem(PROTAGONIST_STORAGE_KEY);
    else globalThis.localStorage?.setItem(PROTAGONIST_STORAGE_KEY, current);
  } catch { /* storage disabled: the choice still works for this session */ }
}
