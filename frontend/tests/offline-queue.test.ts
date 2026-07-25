import {
  enqueue,
  flush,
  pending,
  pendingIds,
  isOnline,
  clearQueue,
  MAX_ATTEMPTS,
  __resetOfflineQueue,
  type OfflineAction,
} from '../src/lib/offlineQueue';

/**
 * FR-13 — the offline start/complete queue.
 *
 * The queue is the only thing standing between "child did a chore in the garage" and "the chore
 * never happened". Three rules carry all the risk and all three are pinned here:
 *
 *   ordering  — a `complete` must never reach the server before its own `start`, or the server
 *               409s the completion and the work is silently lost.
 *   409       — a duplicate replay is SUCCESS, not a failure. Retrying it would loop forever.
 *   bounded   — transient failures retry, but a finite number of times.
 */

/** An error shaped like the app's ApiError: message plus a numeric HTTP status. */
class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** A replayer that records call order and answers per action type/id. */
function recorder(responses: Record<string, () => Promise<unknown>> = {}) {
  const calls: string[] = [];
  const replay = jest.fn(async (action: OfflineAction) => {
    const key = `${action.type}:${action.assignmentId}`;
    calls.push(key);
    const handler = responses[key] ?? responses[action.type];
    if (handler) return handler();
    return { ok: true };
  });
  return { calls, replay };
}

const setOnline = (value: boolean | undefined) => {
  (global as unknown as { navigator?: { onLine?: boolean } }).navigator =
    value === undefined ? undefined : ({ onLine: value } as { onLine: boolean });
};

beforeEach(() => {
  __resetOfflineQueue();
  setOnline(true);
});

describe('enqueue — capturing an action taken with no connection', () => {
  it('stores type, assignment and the moment the child acted', async () => {
    setOnline(false);
    const before = Date.now();

    await enqueue('start', 'a1');
    await enqueue('complete', 'a1', { note: 'all done' });

    const queued = await pending();
    expect(queued.map((a) => a.type)).toEqual(['start', 'complete']);
    expect(queued[0].assignmentId).toBe('a1');
    expect(queued[1].payload).toEqual({ note: 'all done' });

    const captured = new Date(queued[0].clientTimestamp).getTime();
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(Date.now());
    expect(queued[0].attempts).toBe(0);
  });

  it('exposes the queued assignment ids so the card can show a "Queued" badge', async () => {
    await enqueue('start', 'a1');
    await enqueue('complete', 'a2');
    expect(await pendingIds()).toEqual(new Set(['a1', 'a2']));
  });

  it('gives every entry a distinct increasing seq, even within one millisecond', async () => {
    const a = await enqueue('start', 'a1');
    const b = await enqueue('complete', 'a1');
    const c = await enqueue('start', 'a2');
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it('survives a missing navigator (SSR) by reporting online', () => {
    setOnline(undefined);
    expect(isOnline()).toBe(true);
  });

  it('reports offline from navigator.onLine', () => {
    setOnline(false);
    expect(isOnline()).toBe(false);
  });
});

describe('flush — FIFO, and start before complete for the same assignment', () => {
  it('replays in enqueue order and empties the queue', async () => {
    await enqueue('start', 'a1');
    await enqueue('complete', 'a1');
    await enqueue('start', 'a2');

    const { calls, replay } = recorder();
    const report = await flush(replay);

    expect(calls).toEqual(['start:a1', 'complete:a1', 'start:a2']);
    expect(report.outcomes.every((o) => o.result === 'synced')).toBe(true);
    expect(report.remaining).toBe(0);
    expect(await pending()).toEqual([]);
  });

  it('does NOT let a complete overtake its own stalled start', async () => {
    await enqueue('start', 'a1');
    await enqueue('complete', 'a1');

    // The start hits a 500; the completion behind it must wait, not race ahead.
    const first = recorder({ 'start:a1': async () => { throw new HttpError('boom', 500); } });
    const report = await flush(first.replay);

    expect(first.calls).toEqual(['start:a1']); // complete was never attempted
    expect(report.outcomes).toEqual([
      { seq: expect.any(Number), result: 'retry', reason: 'boom' },
    ]);
    expect(report.remaining).toBe(2);

    // Next flush, the server is healthy: both go, still in order.
    const second = recorder();
    await flush(second.replay);
    expect(second.calls).toEqual(['start:a1', 'complete:a1']);
    expect(await pending()).toEqual([]);
  });

  it('counts attempts on the retried entry so it cannot spin forever', async () => {
    await enqueue('start', 'a1');
    const { replay } = recorder({ start: async () => { throw new HttpError('down', 503); } });

    await flush(replay);
    expect((await pending())[0].attempts).toBe(1);

    await flush(replay);
    expect((await pending())[0].attempts).toBe(2);
  });

  it('gives up and drops the entry once MAX_ATTEMPTS is reached', async () => {
    await enqueue('start', 'a1');
    const { replay } = recorder({ start: async () => { throw new HttpError('down', 503); } });

    let report = await flush(replay);
    for (let i = 1; i < MAX_ATTEMPTS; i++) report = await flush(replay);

    expect(report.outcomes[0].result).toBe('dropped');
    expect(await pending()).toEqual([]);
    expect(replay).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('treats a bare network failure (no status) as transient', async () => {
    await enqueue('complete', 'a1');
    const { replay } = recorder({
      complete: async () => { throw new TypeError('Failed to fetch'); },
    });

    const report = await flush(replay);
    expect(report.outcomes[0].result).toBe('retry');
    expect(report.remaining).toBe(1);
  });
});

describe('flush — 409 means already applied, which is SUCCESS', () => {
  it('drops a 409 entry without an error and without retrying', async () => {
    await enqueue('complete', 'a1');
    const { replay } = recorder({
      complete: async () => { throw new HttpError('Task is already completed or approved', 409); },
    });

    const report = await flush(replay);

    expect(report.outcomes).toEqual([{ seq: expect.any(Number), result: 'already-applied' }]);
    expect(report.remaining).toBe(0);
    expect(await pending()).toEqual([]);

    // A second flush must not re-attempt it — the entry is gone for good.
    await flush(replay);
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it('keeps draining the entries behind a 409 rather than stalling on it', async () => {
    await enqueue('start', 'a1');
    await enqueue('complete', 'a1');

    const { calls, replay } = recorder({
      'start:a1': async () => { throw new HttpError('already in_progress', 409); },
    });

    const report = await flush(replay);

    expect(calls).toEqual(['start:a1', 'complete:a1']);
    expect(report.outcomes.map((o) => o.result)).toEqual(['already-applied', 'synced']);
    expect(report.remaining).toBe(0);
  });
});

describe('flush — permanent client errors are dropped, not retried', () => {
  it('drops a 400 (e.g. a rejected future timestamp) and surfaces the reason', async () => {
    await enqueue('complete', 'a1');
    const { replay } = recorder({
      complete: async () => { throw new HttpError('completedAt cannot be in the future', 400); },
    });

    const report = await flush(replay);

    expect(report.outcomes[0]).toEqual({
      seq: expect.any(Number),
      result: 'dropped',
      reason: 'completedAt cannot be in the future',
    });
    expect(await pending()).toEqual([]);
  });

  it('drops a 404/403 the same way', async () => {
    await enqueue('start', 'gone');
    await enqueue('complete', 'not-mine');
    const { replay } = recorder({
      start: async () => { throw new HttpError('Assignment not found', 404); },
      complete: async () => { throw new HttpError('Forbidden', 403); },
    });

    const report = await flush(replay);
    expect(report.outcomes.map((o) => o.result)).toEqual(['dropped', 'dropped']);
    expect(report.remaining).toBe(0);
  });

  it('RETRIES 408 and 429 — those mean "later", not "never"', async () => {
    await enqueue('start', 'a1');
    const { replay } = recorder({ start: async () => { throw new HttpError('slow down', 429); } });

    const report = await flush(replay);
    expect(report.outcomes[0].result).toBe('retry');
    expect(report.remaining).toBe(1);
  });
});

describe('flush — concurrency and housekeeping', () => {
  it('shares one in-flight pass so a reconnect + page load cannot double-submit', async () => {
    await enqueue('complete', 'a1');
    const { replay } = recorder({
      complete: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 10)),
    });

    const [first, second] = await Promise.all([flush(replay), flush(replay)]);

    expect(replay).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('clearQueue empties everything', async () => {
    await enqueue('start', 'a1');
    await clearQueue();
    expect(await pending()).toEqual([]);
  });

  it('a flush with nothing queued is a no-op', async () => {
    const { replay } = recorder();
    const report = await flush(replay);
    expect(replay).not.toHaveBeenCalled();
    expect(report).toEqual({ outcomes: [], remaining: 0 });
  });
});
