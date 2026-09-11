import { readFileSync } from 'fs';
import { join } from 'path';

import { familyApi, setToken } from '../src/lib/api';

/**
 * Self-service account deletion on the web (Play's data-deletion policy; the mobile app has the
 * matching screen). These pin the contract the settings page depends on.
 *
 * The verbs are the part worth pinning. `POST /families/me/deletion` schedules and
 * `DELETE /families/me/deletion` cancels, rather than `DELETE /families/me` doing both: the
 * destructive verb stays off the family resource, cancellation gets a spelling of its own, and the
 * password can ride in a body. Getting that backwards would send a deletion where a cancel was
 * meant, which is the one mistake in this feature that cannot be undone after the retention window.
 *
 * There is no render test here for the same reason the rest of `frontend/tests` has none: jest
 * resolves React 18.3.1 while the browser runs Next's vendored React 19, so a passing render test
 * would not be testing what ships. The component is source-guarded at the bottom instead.
 */

function mockFetch(body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: body }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const SCHEDULED = {
  scheduled: true,
  requestedAt: '2026-09-11T09:00:00.000Z',
  purgeAfter: '2026-10-11T09:00:00.000Z',
  graceDays: 30,
};

beforeEach(() => {
  // `request()` broadcasts a CustomEvent after every successful mutation and does token bookkeeping
  // against web storage, neither of which exists in the node test environment.
  (global as unknown as { window: object }).window = { dispatchEvent: jest.fn() };
  if (typeof (global as unknown as { CustomEvent?: unknown }).CustomEvent === 'undefined') {
    (global as unknown as { CustomEvent: unknown }).CustomEvent = class {
      constructor(public type: string) {}
    };
  }
  (global as unknown as { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  } as unknown as Storage;
  (global as unknown as { sessionStorage: Storage }).sessionStorage = (
    global as unknown as { localStorage: Storage }
  ).localStorage;
  setToken('parent-token');
  jest.restoreAllMocks();
});

describe('familyApi deletion endpoints', () => {
  it('reads the status with GET', async () => {
    const fetchMock = mockFetch(SCHEDULED);

    const res = await familyApi.getDeletionStatus();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/families/me/deletion');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(res.data).toEqual(SCHEDULED);
  });

  it('schedules with POST and sends both gates', async () => {
    const fetchMock = mockFetch(SCHEDULED);

    await familyApi.scheduleDeletion({ password: 'hunter2', confirm: 'DELETE' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/families/me/deletion');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'hunter2', confirm: 'DELETE' });
  });

  it('cancels with DELETE and never sends the password back', async () => {
    const fetchMock = mockFetch({ ...SCHEDULED, scheduled: false, purgeAfter: null });

    await familyApi.cancelDeletion();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/families/me/deletion');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('does not point cancellation at the family resource itself', async () => {
    // A DELETE on /families/me would be a different, unimplemented operation. This asserts the
    // sub-resource path survives any future tidying of the api module.
    const fetchMock = mockFetch({ scheduled: false });

    await familyApi.cancelDeletion();

    expect(fetchMock.mock.calls[0][0]).not.toMatch(/\/families\/me$/);
  });
});

// ─── Source guards on the settings section ────────────────────────────────────

const source = readFileSync(
  join(__dirname, '..', 'src', 'components', 'settings', 'DeleteAccountSection.tsx'),
  'utf8'
);

describe('DeleteAccountSection keeps its guards', () => {
  it('requires both a password and the typed word before enabling the button', () => {
    expect(source).toMatch(
      /disabled=\{!password \|\| confirm\.trim\(\)\.toUpperCase\(\) !== 'DELETE'\}/
    );
  });

  it('renders nothing when the status could not be read', () => {
    // Failing open would show a deletion form to a parent whose session is broken, and failing loud
    // would put an error card on a settings page opened for something else entirely.
    expect(source).toMatch(/if \(isLoading \|\| !status\) return null;/);
  });

  it('is mounted with the primary-parent flag the page already derives', () => {
    const page = readFileSync(
      join(__dirname, '..', 'src', 'app', 'parent', 'settings', 'page.tsx'),
      'utf8'
    );
    expect(page).toContain('<DeleteAccountSection isPrimaryParent={currentUserIsPrimary} />');
  });

  it('stays outside the page-level Save flow', () => {
    // Scheduling a deletion must be its own confirmed action. If this section ever moved inside the
    // block that `handleSave` submits, pressing Save could schedule one.
    const page = readFileSync(
      join(__dirname, '..', 'src', 'app', 'parent', 'settings', 'page.tsx'),
      'utf8'
    );
    const section = page.indexOf('<DeleteAccountSection');
    const save = page.indexOf('onClick={handleSave}');
    expect(section).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(section);
  });
});
