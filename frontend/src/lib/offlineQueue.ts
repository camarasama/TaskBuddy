/**
 * offlineQueue.ts — FR-13
 *
 * Children do chores in the garage, the garden, a friend's house — places the Wi-Fi does not reach.
 * Start and Complete must work there: the tap is recorded locally with the moment it happened, and
 * replayed against the API the next time the device is online.
 *
 * Design notes worth keeping:
 *
 *  - Scope is deliberately start + complete only. Photo evidence stays online-only (a queued blob
 *    is a different, much larger problem), so the UI offers "complete without photo" offline.
 *  - Storage is raw IndexedDB. `idb` would be nicer but this is ~80 lines and the queue must also
 *    work under SSR and in the node-based test environment, where an in-memory fallback is used.
 *  - Ordering is FIFO by a monotonic sequence number, and the flush stops at the first entry that
 *    must be retried. That single rule gives the property that actually matters: for a given
 *    assignment, `start` always replays before `complete`, because it was enqueued first and a
 *    stalled entry blocks the ones behind it rather than letting them overtake.
 *  - 409 is SUCCESS. The server rejects a completion for an assignment that is no longer
 *    pending/in_progress, which is exactly what a duplicate replay looks like. Treating it as an
 *    error would retry forever; treating it as done is correct — the state is already applied.
 *  - Other 4xx are permanent: drop and report. 5xx / network failures are transient: keep, bump the
 *    attempt count, and give up after MAX_ATTEMPTS so nothing retries for eternity.
 */

export type OfflineActionType = 'start' | 'complete';

export interface OfflineAction {
  /** Monotonic FIFO key. Also the IndexedDB primary key. */
  seq: number;
  type: OfflineActionType;
  assignmentId: string;
  /** When the CHILD acted, captured at enqueue time — not when this finally reaches the server. */
  clientTimestamp: string;
  /** Extra body fields for the replay, e.g. `{ note }` on a completion. */
  payload?: Record<string, unknown>;
  attempts: number;
}

export type FlushOutcome =
  | { seq: number; result: 'synced' }
  /** Applied earlier (409) — dropped without an error, the queue's whole replay-safety story. */
  | { seq: number; result: 'already-applied' }
  /** Permanent 4xx or attempts exhausted — dropped, and worth telling the child about. */
  | { seq: number; result: 'dropped'; reason: string }
  /** Transient failure — kept for a later flush. */
  | { seq: number; result: 'retry'; reason: string };

export interface FlushReport {
  outcomes: FlushOutcome[];
  /** Entries still queued after this pass. */
  remaining: number;
}

/** Replays one action. Must reject with something carrying a numeric `status` for HTTP failures. */
export type Replayer = (action: OfflineAction) => Promise<unknown>;

const DB_NAME = 'taskbuddy-offline';
const DB_VERSION = 1;
const STORE = 'actions';
export const MAX_ATTEMPTS = 5;

// ─── Storage ─────────────────────────────────────────────────────────────────
// One tiny interface over IndexedDB so the queue logic is testable without a browser.

interface QueueStore {
  all(): Promise<OfflineAction[]>;
  put(action: OfflineAction): Promise<void>;
  remove(seq: number): Promise<void>;
  clear(): Promise<void>;
}

function memoryStore(): QueueStore {
  let rows: OfflineAction[] = [];
  return {
    async all() {
      return rows.slice().sort((a, b) => a.seq - b.seq);
    },
    async put(action) {
      rows = rows.filter((r) => r.seq !== action.seq).concat({ ...action });
    },
    async remove(seq) {
      rows = rows.filter((r) => r.seq !== seq);
    },
    async clear() {
      rows = [];
    },
  };
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'seq' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbStore(): QueueStore {
  const run = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) =>
    openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => db.close();
        })
    );

  return {
    async all() {
      const rows = await run<OfflineAction[]>('readonly', (s) => s.getAll() as IDBRequest<OfflineAction[]>);
      return (rows ?? []).sort((a, b) => a.seq - b.seq);
    },
    async put(action) {
      await run('readwrite', (s) => s.put(action));
    },
    async remove(seq) {
      await run('readwrite', (s) => s.delete(seq));
    },
    async clear() {
      await run('readwrite', (s) => s.clear());
    },
  };
}

let store: QueueStore | null = null;

function getStore(): QueueStore {
  if (!store) store = hasIndexedDB() ? idbStore() : memoryStore();
  return store;
}

/** Test seam: swap in a fresh in-memory store. */
export function __resetOfflineQueue(): void {
  store = memoryStore();
  lastSeq = 0;
}

// ─── Queue API ───────────────────────────────────────────────────────────────

let lastSeq = 0;

/** Strictly increasing even when two taps land in the same millisecond. */
function nextSeq(): number {
  const now = Date.now();
  lastSeq = now > lastSeq ? now : lastSeq + 1;
  return lastSeq;
}

export async function enqueue(
  type: OfflineActionType,
  assignmentId: string,
  payload?: Record<string, unknown>
): Promise<OfflineAction> {
  const action: OfflineAction = {
    seq: nextSeq(),
    type,
    assignmentId,
    clientTimestamp: new Date().toISOString(),
    payload,
    attempts: 0,
  };
  await getStore().put(action);
  return action;
}

export async function pending(): Promise<OfflineAction[]> {
  return getStore().all();
}

export async function pendingIds(): Promise<Set<string>> {
  return new Set((await pending()).map((a) => a.assignmentId));
}

export async function clearQueue(): Promise<void> {
  await getStore().clear();
}

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Sync failed';
}

let flushing: Promise<FlushReport> | null = null;

/**
 * Drains the queue in FIFO order.
 *
 * Stops at the first entry that needs retrying, so a stalled `start` can never be overtaken by the
 * `complete` behind it. Concurrent calls (page load + an `online` event firing together) share the
 * one in-flight pass rather than replaying an action twice.
 */
export async function flush(replay: Replayer): Promise<FlushReport> {
  if (flushing) return flushing;
  flushing = (async () => {
    const outcomes: FlushOutcome[] = [];
    const queue = await getStore().all();

    for (const action of queue) {
      try {
        await replay(action);
        await getStore().remove(action.seq);
        outcomes.push({ seq: action.seq, result: 'synced' });
        continue;
      } catch (err) {
        const status = statusOf(err);

        // Already applied — a duplicate replay, not a failure. Drop it.
        if (status === 409) {
          await getStore().remove(action.seq);
          outcomes.push({ seq: action.seq, result: 'already-applied' });
          continue;
        }

        // Permanent client errors: the request will never succeed, so retrying is pure noise.
        // 408/429 are the exceptions — those mean "try again later".
        const permanent =
          status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;

        if (permanent) {
          await getStore().remove(action.seq);
          outcomes.push({ seq: action.seq, result: 'dropped', reason: messageOf(err) });
          continue;
        }

        // Transient: 5xx, offline, timeout. Keep it — but not forever.
        const attempts = action.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await getStore().remove(action.seq);
          outcomes.push({
            seq: action.seq,
            result: 'dropped',
            reason: `Gave up after ${attempts} attempts: ${messageOf(err)}`,
          });
          continue;
        }

        await getStore().put({ ...action, attempts });
        outcomes.push({ seq: action.seq, result: 'retry', reason: messageOf(err) });
        // FIFO integrity: everything behind this entry waits for it.
        break;
      }
    }

    return { outcomes, remaining: (await getStore().all()).length };
  })();

  try {
    return await flushing;
  } finally {
    flushing = null;
  }
}

/**
 * Wires the queue to the browser: drains now if already online, and again on every reconnect.
 * Returns an unsubscribe function for React effect cleanup.
 */
export function startAutoFlush(
  replay: Replayer,
  onReport?: (report: FlushReport) => void
): () => void {
  const run = () => {
    if (!isOnline()) return;
    flush(replay)
      .then((report) => {
        if (report.outcomes.length && onReport) onReport(report);
      })
      .catch(() => {});
  };

  run();

  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', run);
  return () => window.removeEventListener('online', run);
}
