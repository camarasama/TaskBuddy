import { setToken, getToken } from '../src/lib/api';

/** Minimal in-memory Web Storage stand-in (frontend jest runs in node). */
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe('CSP + security headers (F-5, Phase 4)', () => {
  it('emits a Report-Only CSP (not enforcing) with the expected directives, on all routes', async () => {
    // NODE_ENV=test → next.config exports the plain config (no next-pwa wrapper).
    const config = require('../next.config.js');
    const rules = await config.headers();

    expect(rules[0].source).toBe('/(.*)');
    const map: Record<string, string> = Object.fromEntries(
      rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
    );

    const csp = map['Content-Security-Policy-Report-Only'];
    expect(csp).toBeDefined();
    expect(map['Content-Security-Policy']).toBeUndefined(); // report-only first, not enforcing
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('https://*.r2.cloudflarestorage.com'); // presigned evidence host (F-4)
    expect(csp).toContain('https://cdn.gettaskbuddy.com');
    expect(csp).toContain('wss://api.gettaskbuddy.com');

    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Permissions-Policy']).toContain('geolocation=()');
    expect(map['Permissions-Policy']).toContain('camera=(self)'); // evidence capture still allowed
  });
});

describe('access-token storage policy (F-5): parent/admin memory-only, child persisted', () => {
  beforeEach(() => {
    (global as unknown as { window: object }).window = {};
    (global as unknown as { localStorage: FakeStorage }).localStorage = new FakeStorage();
    (global as unknown as { sessionStorage: FakeStorage }).sessionStorage = new FakeStorage();
    setToken(null); // reset module memory + remembered role
  });

  const ls = () => (global as unknown as { localStorage: FakeStorage }).localStorage;
  const ss = () => (global as unknown as { sessionStorage: FakeStorage }).sessionStorage;

  it('parent tokens are held in memory but NEVER written to web storage', () => {
    setToken('ptok', 'parent');
    expect(getToken()).toBe('ptok');
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
  });

  it('admin tokens are also memory-only', () => {
    setToken('atok', 'admin');
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
  });

  it('child tokens persist to localStorage', () => {
    setToken('ctok', 'child');
    expect(ls().getItem('accessToken')).toBe('ctok');
  });

  it('a roleless refresh keeps persisting to localStorage for a child session', () => {
    setToken('ctok', 'child'); // remembers role=child for the session
    setToken('ctok2');         // refresh carries no role
    expect(ls().getItem('accessToken')).toBe('ctok2');
  });

  it('a roleless refresh does NOT persist for a parent session', () => {
    setToken('ptok', 'parent');
    setToken('ptok2'); // refresh carries no role → stays memory-only
    expect(ls().getItem('accessToken')).toBeNull();
    expect(getToken()).toBe('ptok2');
  });

  it('clearing the token wipes storage and the remembered role', () => {
    setToken('ctok', 'child');
    setToken(null);
    expect(ls().getItem('accessToken')).toBeNull();
    // role forgotten: a subsequent roleless set must not re-persist
    setToken('x');
    expect(ls().getItem('accessToken')).toBeNull();
  });
});
