/**
 * Durable browser storage for immutable, SEED-derived world foundations (WP-S009-006-001).
 *
 * The cache is an OPTIMIZATION ONLY. Nothing here is allowed to become a second
 * authority for world truth: every read is keyed by the accepted Campaign SEED,
 * a foundation family and a generator version, and every payload carries a
 * content digest that must match the bytes actually read back. A missing,
 * stale, corrupt, quota-evicted or disabled entry always resolves to
 * `undefined`, and the caller regenerates the foundation deterministically.
 *
 * This persistent target (up to 1,000,000,000 bytes of browser storage) is
 * deliberately separate from the combined application CPU+GPU runtime ceiling
 * owned by WP-S009-003-001.
 */

export type FoundationFamily = "settlements";

export type FoundationKey = {
  readonly seed: string;
  readonly family: FoundationFamily | string;
  readonly version: string;
};

/** Persistent browser-storage target from the WP (independent of runtime memory). */
export const FOUNDATION_STORAGE_TARGET_BYTES = 1_000_000_000;

export function foundationStorageKey(key: FoundationKey): string {
  return `${key.seed}|${key.family}|${key.version}`;
}

/**
 * Canonical JSON: object keys are sorted so a payload hashes identically after
 * an IndexedDB structured-clone round trip or a JSON transport.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const walk = (input: unknown): string => {
    if (input === null || input === undefined) return "null";
    const type = typeof input;
    if (type === "number") return Number.isFinite(input as number) ? String(input) : "null";
    if (type === "boolean" || type === "string") return JSON.stringify(input);
    if (type === "function" || type === "symbol") return "null";
    if (Array.isArray(input)) return `[${input.map(walk).join(",")}]`;
    const object = input as Record<string, unknown>;
    if (seen.has(object)) throw new Error("canonicalJson: cyclic value");
    seen.add(object);
    const keys = Object.keys(object).sort();
    const body = keys.filter((key) => object[key] !== undefined).map((key) => `${JSON.stringify(key)}:${walk(object[key])}`).join(",");
    seen.delete(object);
    return `{${body}}`;
  };
  return walk(value);
}

/** Two independent FNV-1a lanes; stable across engines and restarts. */
export function foundationDigest(value: unknown): string {
  const text = canonicalJson(value);
  let a = 2166136261;
  let b = 3166136261;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ (code + 31 * index), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** Byte cost of a stored payload, measured on the canonical text. */
export function foundationBytes(value: unknown): number {
  return canonicalJson(value).length;
}

export type StoredFoundation<T = unknown> = {
  readonly key: string;
  readonly seed: string;
  readonly family: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
  readonly savedAt: number;
  readonly payload: T;
};

export type FoundationBackend = {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
  readonly durable: boolean;
};

/** In-memory backend: unit tests and a safe fallback when IndexedDB is unavailable. */
export function createMemoryBackend(): FoundationBackend {
  const records = new Map<string, unknown>();
  return {
    durable: false,
    async read(key) { return records.get(key); },
    async write(key, value) { records.set(key, value); },
    async remove(key) { records.delete(key); },
    async list() { return [...records.keys()]; },
  };
}

type IndexedDbFactory = () => IDBFactory | undefined;

/**
 * IndexedDB backend. Every failure mode (no API, private mode, blocked upgrade,
 * quota) degrades to a no-op so startup can never hang or crash on storage.
 */
export function createIndexedDbBackend(
  databaseName = "advisor-world-foundations",
  storeName = "foundations",
  factory: IndexedDbFactory = () => (typeof indexedDB === "undefined" ? undefined : indexedDB),
): FoundationBackend {
  let opening: Promise<IDBDatabase | undefined> | undefined;
  const open = (): Promise<IDBDatabase | undefined> => {
    opening ??= new Promise((resolve) => {
      let idb: IDBFactory | undefined;
      try { idb = factory(); } catch { resolve(undefined); return; }
      if (!idb) { resolve(undefined); return; }
      let request: IDBOpenDBRequest;
      try { request = idb.open(databaseName, 1); } catch { resolve(undefined); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    });
    return opening;
  };
  const run = async <R>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> => {
    const db = await open();
    if (!db) return undefined;
    return new Promise<R | undefined>((resolve) => {
      let request: IDBRequest<R>;
      try { request = work(db.transaction(storeName, mode).objectStore(storeName)); } catch { resolve(undefined); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  };
  return {
    durable: true,
    read: (key) => run<unknown>("readonly", (store) => store.get(key)),
    write: async (key, value) => { await run("readwrite", (store) => store.put(value, key)); },
    remove: async (key) => { await run("readwrite", (store) => store.delete(key)); },
    list: async () => (await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys()))?.map(String) ?? [],
  };
}

export type FoundationCacheOptions = {
  readonly maxBytes?: number;
  readonly now?: () => number;
};

export type FoundationCacheStats = {
  readonly durable: boolean;
  readonly entries: number;
  readonly bytes: number;
};

/**
 * Validating, size-bounded store over a backend. A record is only returned when
 * its key, SEED, family, version and content digest all still match.
 */
export class FoundationCache {
  private readonly backend: FoundationBackend;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private lastError: string | undefined;

  constructor(backend: FoundationBackend, options: FoundationCacheOptions = {}) {
    this.backend = backend;
    this.maxBytes = options.maxBytes ?? FOUNDATION_STORAGE_TARGET_BYTES;
    this.now = options.now ?? (() => Date.now());
  }

  get durable() { return this.backend.durable; }
  get storageError() { return this.lastError; }

  /** Returns a payload only if every key and digest check passes. */
  async load<T>(key: FoundationKey, validate?: (payload: T) => boolean): Promise<T | undefined> {
    const storageKey = foundationStorageKey(key);
    let record: unknown;
    try {
      record = await this.backend.read(storageKey);
    } catch (error) {
      this.lastError = `read: ${String(error)}`;
      return undefined;
    }
    if (!record || typeof record !== "object") return undefined;
    const stored = record as Partial<StoredFoundation<T>>;
    if (stored.key !== storageKey || stored.seed !== key.seed || stored.family !== key.family || stored.version !== key.version) return undefined;
    if (typeof stored.digest !== "string" || stored.digest !== foundationDigest(stored.payload)) return undefined;
    if (validate && !validate(stored.payload as T)) return undefined;
    return stored.payload as T;
  }

  /** Persists a payload; returns false on any quota/backend failure (never throws). */
  async save<T>(key: FoundationKey, payload: T): Promise<boolean> {
    let bytes: number;
    let digest: string;
    try {
      bytes = foundationBytes(payload);
      digest = foundationDigest(payload);
    } catch (error) {
      this.lastError = `serialize: ${String(error)}`;
      return false;
    }
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.maxBytes) return false;
    const record: StoredFoundation<T> = {
      key: foundationStorageKey(key), seed: key.seed, family: key.family, version: key.version,
      digest, bytes, savedAt: this.now(), payload,
    };
    try {
      await this.makeRoom(bytes, record.key);
      await this.backend.write(record.key, record);
      return true;
    } catch (error) {
      this.lastError = `write: ${String(error)}`;
      return false;
    }
  }

  async remove(key: FoundationKey): Promise<void> {
    try { await this.backend.remove(foundationStorageKey(key)); } catch { /* ignore */ }
  }

  async stats(): Promise<FoundationCacheStats> {
    let entries = 0;
    let bytes = 0;
    try {
      for (const storageKey of await this.backend.list()) {
        const record = await this.backend.read(storageKey);
        if (!record || typeof record !== "object") continue;
        entries += 1;
        const size = (record as Partial<StoredFoundation>).bytes;
        if (typeof size === "number" && Number.isFinite(size)) bytes += size;
      }
    } catch { /* ignore */ }
    return { durable: this.backend.durable, entries, bytes };
  }

  /** Deterministic, oldest-first retirement until the incoming record fits. */
  private async makeRoom(incomingBytes: number, incomingKey: string): Promise<void> {
    const candidates: { key: string; bytes: number; savedAt: number }[] = [];
    let total = 0;
    for (const storageKey of await this.backend.list()) {
      if (storageKey === incomingKey) continue;
      const record = await this.backend.read(storageKey);
      if (!record || typeof record !== "object") continue;
      const stored = record as Partial<StoredFoundation>;
      const bytes = typeof stored.bytes === "number" ? stored.bytes : 0;
      total += bytes;
      candidates.push({ key: storageKey, bytes, savedAt: typeof stored.savedAt === "number" ? stored.savedAt : 0 });
    }
    if (total + incomingBytes <= this.maxBytes) return;
    candidates.sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));
    for (const candidate of candidates) {
      if (total + incomingBytes <= this.maxBytes) break;
      await this.backend.remove(candidate.key);
      total -= candidate.bytes;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Settlement foundation family (the one family wired for this WP)     */
/* ------------------------------------------------------------------ */

export const SETTLEMENT_FOUNDATION_VERSION = "settlements-v1";

export type SettlementFoundationPayload = {
  readonly cities: unknown[];
  readonly villages: unknown[];
  readonly cityParents: [string, string][];
  readonly summary: unknown;
};

/** Shape + digest validation; a malformed entry falls back to regeneration. */
export function validateSettlementFoundation(payload: SettlementFoundationPayload): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (!Array.isArray(payload.cities) || !Array.isArray(payload.villages)) return false;
  if (!payload.cities.length || !payload.villages.length) return false;
  if (!Array.isArray(payload.cityParents)) return false;
  if (!payload.summary || typeof payload.summary !== "object") return false;
  for (const place of [...payload.cities, ...payload.villages]) {
    const candidate = place as { id?: unknown; code?: unknown; x?: unknown; z?: unknown; canonicalPosition?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.code !== "string") return false;
    if (typeof candidate.x !== "number" || typeof candidate.z !== "number") return false;
    if (!candidate.canonicalPosition || typeof candidate.canonicalPosition !== "object") return false;
  }
  return true;
}

let activeCache: FoundationCache | undefined;

/**
 * The cache key for the settlement foundation. SEED and the geography/foundation
 * generator versions are both part of the key, so any generator change
 * invalidates old entries instead of reusing incompatible data.
 */
export function settlementFoundationKey(seed: string, foundationVersion: string): FoundationKey {
  return { seed: `${seed}/${foundationVersion}`, family: "settlements", version: SETTLEMENT_FOUNDATION_VERSION };
}

/** Browser default: IndexedDB when available, otherwise a session-only memory cache. */
export function foundationCache(): FoundationCache {
  activeCache ??= new FoundationCache(createIndexedDbBackend());
  return activeCache;
}

/** Test/embedding hook. */
export function setFoundationCache(cache: FoundationCache | undefined): void {
  activeCache = cache;
}

let hydratedSettlements: SettlementFoundationPayload | undefined;
let settlementsHydrated = false;

/** Set once by the bootstrap before the world modules are imported. */
export function provideHydratedSettlements(payload: SettlementFoundationPayload | undefined): void {
  hydratedSettlements = payload && validateSettlementFoundation(payload) ? payload : undefined;
  settlementsHydrated = true;
}

/**
 * Returns the hydrated foundation at most once per page load, so a later
 * consumer can never silently read a stale object graph twice.
 */
export function takeHydratedSettlements(): SettlementFoundationPayload | undefined {
  if (!settlementsHydrated) return undefined;
  const payload = hydratedSettlements;
  hydratedSettlements = undefined;
  return payload;
}

/** Persists the freshly generated foundation in the background; never blocks startup. */
export function queueSettlementFoundationSave(key: FoundationKey, payload: SettlementFoundationPayload): void {
  const cache = foundationCache();
  const write = () => { void cache.save(key, payload); };
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof idle === "function") idle(write, { timeout: 4000 });
  else setTimeout(write, 1200);
}
