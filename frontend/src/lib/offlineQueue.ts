/**
 * FR-13 — offline task completion.
 *
 * A child doing chores in the garage or the garden routinely drops off Wi-Fi. This queues their
 * "mark complete" taps in IndexedDB and replays them once the connection comes back, so the tap is
 * never silently lost.
 *
 * **The replay runs in the page, not in the service worker.** The child's access token lives in
 * `localStorage` (F-5 storage policy), which a service worker cannot read, and copying it into
 * IndexedDB purely to let the worker POST would widen token exposure for no real gain. The worker's
 * `sync` handler therefore only pings open clients (see `src/service-worker/index.js`); the actual
 * flush is `flushOfflineQueue`, driven by the `online` event and by page load.
 *
 * Photo-evidence tasks are deliberately NOT queueable — the upload is a multipart request against a
 * presigned URL with a short TTL, so a deferred replay would fail anyway.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'taskbuddy-offline';
const DB_VERSION = 1;
const STORE = 'completions';

/** Hard cap so a long offline stretch can't grow the store without bound. */
export const MAX_QUEUED = 50;
/** A entry that keeps failing on the network is dropped rather than retried forever. */
export const MAX_ATTEMPTS = 5;

/** Background-sync tag registered when an entry is queued. */
export const SYNC_TAG = 'taskbuddy-completions';
/** Message a service worker posts to clients to ask them to flush. */
export const FLUSH_MESSAGE = 'taskbuddy:flush-completions';

export interface QueuedCompletion {
  /** Key path. One queued completion per assignment — re-tapping replaces, never duplicates. */
  assignmentId: string;
  /** Kept so the UI can name the task in a toast without a network round trip. */
  taskTitle: string;
  queuedAt: number;
  attempts: number;
}

export interface FlushResult {
  /** Accepted by the server. */
  synced: QueuedCompletion[];
  /** Permanently rejected (already completed, expired, no longer the child's task…) — removed. */
  dropped: QueuedCompletion[];
  /** Still queued: the network is down again, or a retryable server error. */
  remaining: number;
}

// ── Store ────────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null;

export function isOfflineQueueSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'assignmentId' });
        }
      },
    });
  }
  return dbPromise;
}

/** Test seam — drops the cached connection so a fresh IndexedDB is opened. */
export function resetOfflineQueueForTests(): void {
  dbPromise = null;
  listeners.clear();
  flushing = null;
}

// ── Change notification ──────────────────────────────────────────────────────

type Listener = (queued: QueuedCompletion[]) => void;
const listeners = new Set<Listener>();

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function onOfflineQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const queued = await getQueuedCompletions();
  listeners.forEach((l) => l(queued));
}

// ── Queue operations ─────────────────────────────────────────────────────────

/**
 * Queue a completion for later replay. Returns false when the queue is unavailable or full, so the
 * caller can surface a real failure instead of pretending the tap was saved.
 */
export async function queueCompletion(
  assignmentId: string,
  taskTitle: string
): Promise<boolean> {
  if (!isOfflineQueueSupported()) return false;
  try {
    const database = await db();
    const existing = await database.get(STORE, assignmentId);
    if (!existing) {
      const count = await database.count(STORE);
      if (count >= MAX_QUEUED) return false;
    }
    const entry: QueuedCompletion = {
      assignmentId,
      taskTitle,
      queuedAt: existing?.queuedAt ?? Date.now(),
      attempts: 0, // a fresh tap earns a fresh retry budget
    };
    await database.put(STORE, entry);
    await notify();
    void registerBackgroundSync();
    return true;
  } catch {
    return false;
  }
}

/** Oldest first — completions replay in the order the child tapped them. */
export async function getQueuedCompletions(): Promise<QueuedCompletion[]> {
  if (!isOfflineQueueSupported()) return [];
  try {
    const all: QueuedCompletion[] = await (await db()).getAll(STORE);
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

export async function removeQueuedCompletion(assignmentId: string): Promise<void> {
  if (!isOfflineQueueSupported()) return;
  try {
    await (await db()).delete(STORE, assignmentId);
    await notify();
  } catch {
    /* nothing useful to do — the entry stays and is retried */
  }
}

// ── Replay ───────────────────────────────────────────────────────────────────

/**
 * A rejection the server actually produced (any HTTP status) is terminal: replaying a completion
 * the API refused — already completed, assignment expired, task archived, token gone — will be
 * refused again, so the entry is dropped rather than retried forever. 5xx is the exception: the
 * server is reachable but broken, which is worth another attempt later.
 *
 * A rejection with no status is a transport failure (`fetch` throws a TypeError when offline), so
 * the entry stays queued.
 */
function isTerminal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status < 500;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Replay every queued completion through `send`. Concurrent calls (the `online` event and a service
 * worker ping can land together) share one in-flight pass.
 */
export function flushOfflineQueue(
  send: (entry: QueuedCompletion) => Promise<unknown>
): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = runFlush(send).finally(() => {
    flushing = null;
  }) as Promise<FlushResult>;
  return flushing;
}

async function runFlush(
  send: (entry: QueuedCompletion) => Promise<unknown>
): Promise<FlushResult> {
  const synced: QueuedCompletion[] = [];
  const dropped: QueuedCompletion[] = [];

  const queued = await getQueuedCompletions();
  for (const entry of queued) {
    try {
      await send(entry);
      await removeQueuedCompletion(entry.assignmentId);
      synced.push(entry);
    } catch (err) {
      if (isTerminal(err)) {
        await removeQueuedCompletion(entry.assignmentId);
        dropped.push(entry);
        continue;
      }
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await removeQueuedCompletion(entry.assignmentId);
        dropped.push(entry);
        continue;
      }
      try {
        await (await db()).put(STORE, { ...entry, attempts });
      } catch {
        /* the attempt counter is best-effort */
      }
      // The transport is down — the rest of the queue would fail identically. Stop and let the
      // next `online` event pick it up.
      break;
    }
  }

  if (synced.length || dropped.length) await notify();
  return { synced, dropped, remaining: (await getQueuedCompletions()).length };
}

// ── Background sync (progressive enhancement) ────────────────────────────────

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

/**
 * Ask the browser to wake the service worker when connectivity returns. Chromium-only, and the
 * worker can only ping open clients (it has no token), so this is strictly a nudge on top of the
 * `online` listener — never the primary path.
 */
async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as SyncRegistration;
    await reg.sync?.register(SYNC_TAG);
  } catch {
    /* unsupported or permission-denied — the online listener still covers it */
  }
}
