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
    // The full policy is report-only; the enforced header carries frame-ancestors and nothing else.
    expect(map['Content-Security-Policy']).toBe("frame-ancestors 'none'");
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

describe('CSP connect-src carries the Sentry ingest origin (OI-2 prep)', () => {
  const config = require('../next.config.js');
  const original = process.env.NEXT_PUBLIC_SENTRY_DSN;

  const cspWithDsn = async (dsn: string | undefined) => {
    if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
    const rules = await config.headers();
    const map: Record<string, string> = Object.fromEntries(
      rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
    );
    return map['Content-Security-Policy-Report-Only'];
  };

  const connectSrcOf = (csp: string) =>
    csp.split('; ').find((d) => d.startsWith('connect-src')) as string;

  afterAll(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = original;
  });

  it('adds the ingest origin to connect-src when a DSN is configured', async () => {
    const csp = await cspWithDsn('https://abc123publickey@o4507.ingest.sentry.io/4508');
    expect(connectSrcOf(csp)).toContain('https://o4507.ingest.sentry.io');
  });

  it('never leaks the DSN public key or path into the header', async () => {
    const csp = await cspWithDsn('https://abc123publickey@o4507.ingest.sentry.io/4508');
    expect(csp).not.toContain('abc123publickey');
    expect(csp).not.toContain('/4508');
  });

  it('adds nothing when Sentry is disabled (DSN unset)', async () => {
    const csp = await cspWithDsn(undefined);
    expect(connectSrcOf(csp)).toBe(
      "connect-src 'self' https://api.gettaskbuddy.com wss://api.gettaskbuddy.com",
    );
  });

  it('adds nothing for an unparseable or non-https DSN rather than poisoning connect-src', async () => {
    for (const bad of ['not-a-url', 'http://o1.ingest.sentry.io/2', '']) {
      const csp = await cspWithDsn(bad);
      expect(connectSrcOf(csp)).toBe(
        "connect-src 'self' https://api.gettaskbuddy.com wss://api.gettaskbuddy.com",
      );
    }
  });

  it('keeps the full policy Report-Only; the only ENFORCED CSP is frame-ancestors', async () => {
    // The OI-2 enforce flip of the whole policy is still deliberately not taken. Framing is the
    // exception (security audit 2026-09-14): enforced on its own, it cannot break scripts or images.
    const rules = await config.headers();
    const map: Record<string, string> = Object.fromEntries(
      rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
    );
    expect(map['Content-Security-Policy-Report-Only']).toContain("script-src 'self'");
    expect(map['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(map['X-Frame-Options']).toBe('DENY');
  });

  it('sends a 180-day HSTS in production only, and never on localhost', async () => {
    const prev = process.env.NODE_ENV;
    const read = async () => {
      const rules = await config.headers();
      return rules[0].headers.find((h: { key: string }) => h.key === 'Strict-Transport-Security');
    };
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      expect((await read())?.value).toBe('max-age=15552000');
      (process.env as Record<string, string>).NODE_ENV = 'development';
      expect(await read()).toBeUndefined();
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev as string;
    }
  });

  it('does not advertise the framework', () => {
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('access-token storage policy (F-5/F-01): every role is memory-only', () => {
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

  it('child tokens are memory-only too (F-01: children joined the memory-only policy)', () => {
    setToken('ctok', 'child');
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
  });

  it('a roleless refresh still does not persist for a child session', () => {
    setToken('ctok', 'child'); // remembers role=child for the session
    setToken('ctok2');         // refresh carries no role
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
    expect(getToken()).toBe('ctok2');
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

  it('a child token is readable via getToken() from memory while absent from both storages', () => {
    setToken('ctok3', 'child');
    expect(getToken()).toBe('ctok3');
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
  });

  it('the legacy purge removes a pre-existing localStorage.accessToken value', () => {
    // Simulate a pre-F-01 build that had already persisted a child token to localStorage.
    ls().setItem('accessToken', 'stale-legacy-child-token');
    ss().setItem('accessToken', 'stale-legacy-session-token');

    // getToken() must never resurrect the stale value, and must purge it from storage.
    expect(getToken()).toBeNull(); // in-memory accessToken is null after the beforeEach reset
    expect(ls().getItem('accessToken')).toBeNull();
    expect(ss().getItem('accessToken')).toBeNull();
  });
});
