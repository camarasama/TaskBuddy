import { readFileSync } from 'fs';
import { join } from 'path';

import { setToken } from '../src/lib/api';
import { adminInsightsApi, TRACK_INFO } from '../src/lib/adminInsightsApi';

/**
 * Admin insights + re-engagement (2026-10-26). Pins the API contract the Overview and
 * Re-engagement pages depend on, and source-guards the two pages whose failure would be silent
 * (no render tests here: jest runs React 18 while the browser runs Next's React 19).
 */

function mockFetch(body: unknown = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: body }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
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
  setToken('admin-token');
});

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('adminInsightsApi', () => {
  it('asks for the overview with range and the testers switch', async () => {
    const f = mockFetch();
    await adminInsightsApi.overview('90d', true);
    expect(f.mock.calls[0][0]).toContain('/admin/insights/overview?range=90d&includeTesters=true');
  });

  it('filters the nudge list by stage and page', async () => {
    const f = mockFetch();
    await adminInsightsApi.nudges({ stage: 'dormant', page: 2 });
    expect(f.mock.calls[0][0]).toContain('/admin/insights/nudges?stage=dormant&page=2');
  });

  it('uses the right verbs for the controls', async () => {
    const f = mockFetch();
    await adminInsightsApi.sendNext('fam1');
    await adminInsightsApi.setFamilyPause('fam1', true);
    await adminInsightsApi.setGlobalPause(false);
    await adminInsightsApi.setTestAccount('fam1', true);
    const calls = f.mock.calls.map(([url, init]) => [String(url).replace(/^.*\/api\/v1|^\/api\/v1/, ''), init.method, init.body]);
    expect(calls).toEqual([
      ['/admin/reengagement/families/fam1/send-next', 'POST', undefined],
      ['/admin/reengagement/families/fam1/pause', 'PATCH', JSON.stringify({ paused: true })],
      ['/admin/reengagement/settings', 'PATCH', JSON.stringify({ paused: false })],
      ['/admin/families/fam1/test-account', 'PATCH', JSON.stringify({ isTestAccount: true })],
    ]);
  });

  it('unsubscribe POSTs the signed pair', async () => {
    const f = mockFetch();
    await adminInsightsApi.unsubscribe('user-1', 'abc');
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/email/unsubscribe');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ u: 'user-1', t: 'abc' });
  });

  it('track schedule matches the backend policy (2/5/10/21 and 14/21/35/60)', () => {
    const policy = read('../backend/src/services/reengagementPolicy.ts');
    expect(policy).toContain('setup: [2, 5, 10, 21]');
    expect(policy).toContain('lapsed: [14, 21, 35, 60]');
    expect(TRACK_INFO.setup.days).toEqual([2, 5, 10, 21]);
    expect(TRACK_INFO.lapsed.days).toEqual([14, 21, 35, 60]);
  });
});

describe('source guards', () => {
  it('the unsubscribe page waits for a click instead of unsubscribing on load', () => {
    const src = read('src/app/unsubscribe/page.tsx');
    expect(src).not.toMatch(/useEffect/);
    expect(src).toContain('onClick={confirm}');
  });

  it('the admin nav links the new Re-engagement page', () => {
    expect(read('src/components/layouts/AdminLayout.tsx')).toContain("href: '/admin/reengagement'");
  });
});
