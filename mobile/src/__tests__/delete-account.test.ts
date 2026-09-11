/**
 * The in-app deletion flow: its API contract, and the guards on the screen that uses it.
 *
 * ## Why this is not a render test
 *
 * It started as one. Every case passes in isolation, but from roughly the fifth render onwards in a
 * single file the tree comes back empty and React reports overlapping `act()` calls, so a result
 * depends on a test's POSITION in the file rather than on the code under test. That reproduces with
 * this screen and not with a plain component or a bare `useQuery` probe, so it is something in the
 * screen's own tree (`Field` subscribes to AppState to re-mask on blur, which is the leading
 * suspect) rather than anything about deletion. A suite whose fifth test always fails is worse than
 * no suite: it teaches people to ignore it.
 *
 * So the split is deliberate. The API surface is pure and gets real behavioural tests below. The
 * screen gets a source guard, the same tool `settings-legal-links-wiring.test.ts` already applies to
 * this screen's neighbour, and for the same reason. A render test should replace the second half
 * once the act problem is understood; the issue register carries it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

/* eslint-disable import/first -- these must sit BELOW jest.mock: the factory is hoisted above the
   imports, and importing familyApi first would bind the real `api` before the mock replaces it. */
import { api } from '@/lib/api';
import {
  cancelDeletion,
  DELETION_KEY,
  deletionQuery,
  fetchDeletionStatus,
  scheduleDeletion,
  type DeletionStatus,
} from '@/lib/familyApi';

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;

const SCHEDULED: DeletionStatus = {
  scheduled: true,
  requestedAt: '2026-09-11T09:00:00.000Z',
  purgeAfter: '2026-10-11T09:00:00.000Z',
  graceDays: 30,
};

beforeEach(() => jest.clearAllMocks());

describe('the deletion API calls the endpoints the server actually exposes', () => {
  it('reads the status from GET /families/me/deletion', async () => {
    get.mockResolvedValue(SCHEDULED);

    await expect(fetchDeletionStatus()).resolves.toEqual(SCHEDULED);
    expect(get).toHaveBeenCalledWith('/families/me/deletion', { signal: undefined });
  });

  it('schedules with POST, carrying both gates in the body', async () => {
    post.mockResolvedValue(SCHEDULED);

    await scheduleDeletion({ password: 'hunter2', confirm: 'DELETE' });

    // POST rather than DELETE is load-bearing: `api.delete` sends no body, so a DELETE here would
    // drop the password and the server would reject every request.
    expect(post).toHaveBeenCalledWith('/families/me/deletion', {
      password: 'hunter2',
      confirm: 'DELETE',
    });
  });

  it('cancels with DELETE and sends no body', async () => {
    del.mockResolvedValue({ ...SCHEDULED, scheduled: false });

    await cancelDeletion();

    expect(del).toHaveBeenCalledWith('/families/me/deletion');
    expect(post).not.toHaveBeenCalled();
  });

  it('passes the abort signal through, so a screen leaving mid-flight cancels the read', async () => {
    const controller = new AbortController();
    get.mockResolvedValue(SCHEDULED);

    await fetchDeletionStatus(controller.signal);

    expect(get).toHaveBeenCalledWith('/families/me/deletion', { signal: controller.signal });
  });

  it('exposes a query whose key matches the one the screen writes back to', () => {
    // A mismatch here is silent: the mutation would seed a key nothing is subscribed to, and the
    // screen would keep showing a deletion that had already been cancelled.
    expect(deletionQuery().queryKey).toBe(DELETION_KEY);
  });
});

// ─── Source guards on the screen ──────────────────────────────────────────────

const source = readFileSync(
  join(__dirname, '..', '..', 'app', '(parent)', 'delete-account.tsx'),
  'utf8'
);

describe('the screen keeps its guards', () => {
  it('disables the destructive button until both gates pass', () => {
    // Password non-empty AND the confirmation word. Losing either half turns a two-step confirmation
    // into a single tap, on a screen whose whole purpose is to be hard to trigger by accident.
    expect(source).toMatch(/disabled=\{password\.length === 0 \|\| !confirmed\(confirm\)\}/);
  });

  it('matches the confirmation word the server checks, trimmed and case-insensitively', () => {
    expect(source).toMatch(/text\.trim\(\)\.toUpperCase\(\) === 'DELETE'/);
  });

  it('treats "not yet known" as different from "not the primary parent"', () => {
    // `isPrimary` is deliberately `boolean | undefined`. Collapsing it to false would flash a
    // refusal at the account owner while the parents query is still in flight.
    expect(source).toContain('isPrimary !== true');
    expect(source).toContain('canCancel={isPrimary === true}');
  });

  it('routes every write through familyApi rather than calling the API itself', () => {
    // An inline api.post/api.delete here would bypass the contract the tests above pin down.
    expect(source).not.toMatch(/\bapi\.(delete|post|put|patch)\(/);
    expect(source).toContain('scheduleDeletion');
    expect(source).toContain('cancelDeletion');
  });
});
