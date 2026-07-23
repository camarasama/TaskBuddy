import crypto from 'crypto';
import { VALIDATION } from '@taskbuddy/shared';
import { pruneExpired } from '../src/utils/rateLimitSweep';
import { socketTtlMs } from '../src/utils/socketTtl';
import { isPasswordBreached } from '../src/utils/passwordBreach';

describe('password length floors are pinned (F-10i)', () => {
  // Two constants exist on purpose: raising the floor for everyone would have locked out every
  // parent holding a valid 8- or 9-character password. Neither value was pinned by a test, so a
  // refactor collapsing them — in either direction — was silent. It is not silent now.
  it('keeps the legacy floor at 8 for existing passwords / login', () => {
    expect(VALIDATION.PASSWORD.MIN_LENGTH).toBe(8);
  });

  it('requires 10 characters for NEW passwords (register, change, reset)', () => {
    expect(VALIDATION.PASSWORD.NEW_MIN_LENGTH).toBe(10);
  });

  it('never lets the new-password floor slip below the legacy one', () => {
    expect(VALIDATION.PASSWORD.NEW_MIN_LENGTH).toBeGreaterThanOrEqual(
      VALIDATION.PASSWORD.MIN_LENGTH,
    );
  });
});

describe('pruneExpired — rate-limit map sweep (F-10)', () => {
  it('drops entries past their reset and keeps live ones, returning the count removed', () => {
    const now = 1_000_000;
    const map = new Map<string, { resetAt: number }>([
      ['old1', { resetAt: now - 1 }],
      ['old2', { resetAt: now - 5000 }],
      ['live', { resetAt: now + 5000 }],
    ]);
    const removed = pruneExpired(map, now);
    expect(removed).toBe(2);
    expect([...map.keys()]).toEqual(['live']);
  });
});

describe('socketTtlMs — socket dies with its token (F-10)', () => {
  it('returns null when there is no exp', () => {
    expect(socketTtlMs(undefined)).toBeNull();
  });
  it('returns remaining ms for a future expiry', () => {
    const now = 1_000_000;
    expect(socketTtlMs(1_000 + 60, now)).toBe((1_000 + 60) * 1000 - now); // exp is in seconds
  });
  it('clamps an already-expired token to 0 (disconnect now)', () => {
    const now = 2_000_000;
    expect(socketTtlMs(1_000, now)).toBe(0);
  });
});

describe('isPasswordBreached — HIBP k-anonymity (F-10)', () => {
  const suffixOf = (pw: string) =>
    crypto.createHash('sha1').update(pw).digest('hex').toUpperCase().slice(5);

  afterEach(() => jest.restoreAllMocks());

  it('sends only the 5-char hash prefix, never the password', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;
    await isPasswordBreached('hunter2hunter2');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain('hunter2');
  });

  it('returns true when the suffix appears with a non-zero count', async () => {
    const pw = 'password';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `${suffixOf(pw)}:1337\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0`,
    }) as unknown as typeof fetch;
    expect(await isPasswordBreached(pw)).toBe(true);
  });

  it('returns false when the suffix is absent or padded (count 0)', async () => {
    const pw = 'password';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `${suffixOf(pw)}:0\r\nDEADBEEF:5`,
    }) as unknown as typeof fetch;
    expect(await isPasswordBreached(pw)).toBe(false);
  });

  it('fails OPEN (false) on a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await isPasswordBreached('whatever-long-pass')).toBe(false);
  });

  it('fails OPEN (false) on a non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' }) as unknown as typeof fetch;
    expect(await isPasswordBreached('whatever-long-pass')).toBe(false);
  });
});
