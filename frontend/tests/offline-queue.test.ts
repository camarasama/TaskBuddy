import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  MAX_ATTEMPTS,
  MAX_QUEUED,
  flushOfflineQueue,
  getQueuedCompletions,
  onOfflineQueueChange,
  queueCompletion,
  removeQueuedCompletion,
  resetOfflineQueueForTests,
  type QueuedCompletion,
} from '../src/lib/offlineQueue';

/**
 * FR-13. A child marking a chore done in the garage must not lose the tap. These tests pin the
 * parts that decide whether the tap survives: the queue itself, and — more importantly — the
 * replay's error classification. Retrying a completion the server has already refused would loop
 * forever; dropping one that failed on a dead socket loses the child's work. Both directions are
 * covered here.
 */

// A rejection produced by the API layer: `ApiError` always carries an HTTP status.
class ApiErrorStub extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
// A rejection produced by the transport: `fetch` throws a bare TypeError when offline.
const offlineError = () => new TypeError('Failed to fetch');

beforeEach(() => {
  // Each test gets a clean IndexedDB — fake-indexeddb keeps state across tests otherwise.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetOfflineQueueForTests();
  // No service worker in the node environment; registerBackgroundSync must no-op, not throw.
  delete (globalThis as { navigator?: unknown }).navigator;
  jest.restoreAllMocks();
});

describe('queueing', () => {
  it('stores a completion and reads it back', async () => {
    expect(await queueCompletion('a1', 'Take out the bins')).toBe(true);

    const queued = await getQueuedCompletions();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      assignmentId: 'a1',
      taskTitle: 'Take out the bins',
      attempts: 0,
    });
  });

  it('never queues the same assignment twice', async () => {
    await queueCompletion('a1', 'Take out the bins');
    await queueCompletion('a1', 'Take out the bins');

    expect(await getQueuedCompletions()).toHaveLength(1);
  });

  it('returns entries oldest first so completions replay in tap order', async () => {
    // A controlled clock, not `mockReturnValueOnce` — fake-indexeddb calls Date.now internally and
    // would eat the queued values.
    let clock = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    clock = 1_000_200;
    await queueCompletion('later', 'Second tap');
    clock = 1_000_000;
    await queueCompletion('earlier', 'First tap');

    expect((await getQueuedCompletions()).map((q) => q.assignmentId)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('refuses new entries past the cap instead of growing without bound', async () => {
    for (let i = 0; i < MAX_QUEUED; i++) {
      expect(await queueCompletion(`a${i}`, `Task ${i}`)).toBe(true);
    }
    expect(await queueCompletion('one-too-many', 'Overflow')).toBe(false);
    // An assignment already in the queue can still be re-saved at the cap.
    expect(await queueCompletion('a0', 'Task 0')).toBe(true);
    expect(await getQueuedCompletions()).toHaveLength(MAX_QUEUED);
  });

  it('notifies subscribers on queue and removal', async () => {
    const seen: number[] = [];
    const unsubscribe = onOfflineQueueChange((q) => seen.push(q.length));

    await queueCompletion('a1', 'Take out the bins');
    await removeQueuedCompletion('a1');
    unsubscribe();
    await queueCompletion('a2', 'Feed the cat');

    expect(seen).toEqual([1, 0]); // nothing after unsubscribe
  });
});

describe('flush', () => {
  it('sends each queued completion and clears them', async () => {
    await queueCompletion('a1', 'Bins');
    await queueCompletion('a2', 'Dishes');
    const send = jest.fn().mockResolvedValue(undefined);

    const result = await flushOfflineQueue(send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.synced.map((s) => s.assignmentId)).toEqual(['a1', 'a2']);
    expect(result.remaining).toBe(0);
    expect(await getQueuedCompletions()).toHaveLength(0);
  });

  it('drops an entry the server refuses — replaying it would never succeed', async () => {
    await queueCompletion('a1', 'Bins');
    // 409: the assignment was already completed from another device.
    const send = jest.fn().mockRejectedValue(new ApiErrorStub('Already completed', 409));

    const result = await flushOfflineQueue(send);

    expect(result.dropped.map((d) => d.assignmentId)).toEqual(['a1']);
    expect(result.synced).toHaveLength(0);
    expect(await getQueuedCompletions()).toHaveLength(0);
  });

  it('keeps an entry when the connection is still down', async () => {
    await queueCompletion('a1', 'Bins');
    const send = jest.fn().mockRejectedValue(offlineError());

    const result = await flushOfflineQueue(send);

    expect(result.synced).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
    expect(result.remaining).toBe(1);
    expect((await getQueuedCompletions())[0].attempts).toBe(1);
  });

  it('retries a 5xx later — the server is reachable but broken', async () => {
    await queueCompletion('a1', 'Bins');
    const send = jest.fn().mockRejectedValue(new ApiErrorStub('Bad gateway', 502));

    const result = await flushOfflineQueue(send);

    expect(result.dropped).toHaveLength(0);
    expect(result.remaining).toBe(1);
  });

  it('stops the pass on the first transport failure rather than hammering a dead link', async () => {
    await queueCompletion('a1', 'Bins');
    await queueCompletion('a2', 'Dishes');
    const send = jest.fn().mockRejectedValue(offlineError());

    await flushOfflineQueue(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await getQueuedCompletions()).toHaveLength(2);
  });

  it('gives up on an entry that has failed too many times', async () => {
    await queueCompletion('a1', 'Bins');
    const send = jest.fn().mockRejectedValue(offlineError());

    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOfflineQueue(send);

    expect(await getQueuedCompletions()).toHaveLength(0);
  });

  it('re-tapping a failed task restores its full retry budget', async () => {
    await queueCompletion('a1', 'Bins');
    await flushOfflineQueue(jest.fn().mockRejectedValue(offlineError()));
    expect((await getQueuedCompletions())[0].attempts).toBe(1);

    await queueCompletion('a1', 'Bins');

    expect((await getQueuedCompletions())[0].attempts).toBe(0);
  });

  it('shares one in-flight pass between concurrent callers', async () => {
    await queueCompletion('a1', 'Bins');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = jest.fn((_: QueuedCompletion) => gate);

    const first = flushOfflineQueue(send);
    const second = flushOfflineQueue(send);
    release();
    await Promise.all([first, second]);

    // The `online` event and a service-worker ping can land together; the completion must be
    // submitted once, not twice.
    expect(send).toHaveBeenCalledTimes(1);
  });
});
