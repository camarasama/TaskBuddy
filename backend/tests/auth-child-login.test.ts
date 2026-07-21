import bcrypt from 'bcrypt';

// Mock the Prisma singleton so childLogin can be exercised without a real database.
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), update: jest.fn() },
  },
}));

import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';

const findFamily = prisma.family.findFirst as jest.Mock;
const findUser = prisma.user.findFirst as jest.Mock;
const updateUser = prisma.user.update as jest.Mock;

const CREDS = { familyCode: 'BRAVE-OTTER-4417', childIdentifier: 'sam', pin: '1234' };

describe('AuthService.childLogin — PIN comparison is constant-work', () => {
  let compareSpy: jest.SpyInstance;

  beforeEach(() => {
    compareSpy = jest.spyOn(bcrypt, 'compare');
    findFamily.mockResolvedValue({ id: 'family-1' });
    updateUser.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  // Regression guard: childLogin used to short-circuit with
  //   !!(user?.childProfile) && await bcrypt.compare(...)
  // which skipped the compare entirely for an unknown child, returning ~190ms faster and
  // leaking which (familyCode, childIdentifier) pairs exist. The compare must run either way.
  it('still runs bcrypt.compare when no child matches the identifier', async () => {
    findUser.mockResolvedValue(null);

    await expect(authService.childLogin(CREDS)).rejects.toThrow('Invalid credentials');

    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('runs bcrypt.compare against a valid hash, so the dummy costs real work', async () => {
    findUser.mockResolvedValue(null);

    await authService.childLogin(CREDS).catch(() => undefined);

    // A malformed placeholder can be rejected before any key derivation happens, which would
    // reintroduce the timing signal the dummy exists to remove.
    const [, hashUsed] = compareSpy.mock.calls[0] as [string, string];
    expect(hashUsed).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });

  it('rejects a wrong PIN for a child that does exist', async () => {
    findUser.mockResolvedValue(await childWith({ failedPinAttempts: 0 }));

    await expect(authService.childLogin(CREDS)).rejects.toThrow('Invalid credentials');

    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'child-1' } }),
    );
  });
});

async function childWith(overrides: Record<string, unknown>) {
  return {
    id: 'child-1',
    familyId: 'family-1',
    role: 'child',
    lockedUntil: null,
    failedPinAttempts: 0,
    lastFailedPinAt: null,
    childProfile: { pinHash: await bcrypt.hash('4321', 12), ageGroup: 'child' },
    ...overrides,
  };
}

/** The `data:` payload of the most recent prisma.user.update call. */
function lastUpdate() {
  return updateUser.mock.calls.at(-1)![0].data;
}

describe('AuthService.childLogin — lockout is progressive, not instant', () => {
  beforeEach(() => {
    findFamily.mockResolvedValue({ id: 'family-1' });
    updateUser.mockResolvedValue({});
  });

  afterEach(() => jest.clearAllMocks());

  // Regression guard: a single failed PIN used to set lockedUntil = now + 15min. Anyone who
  // knew a family code and a child's first name could keep that child permanently locked out
  // with one request every 15 minutes — a DoS against a real kid, from an unauthenticated
  // endpoint. Early failures must count without locking.
  it.each([1, 2, 3, 4])('does not lock on failure #%i', async (n) => {
    findUser.mockResolvedValue(await childWith({ failedPinAttempts: n - 1, lastFailedPinAt: new Date() }));

    await authService.childLogin(CREDS).catch(() => undefined);

    expect(lastUpdate()).not.toHaveProperty('lockedUntil');
    expect(lastUpdate().failedPinAttempts).toBe(n);
  });

  it('locks once failures pass the threshold, with escalating duration', async () => {
    const durations: number[] = [];

    for (const prior of [4, 5, 6, 7, 8]) {
      jest.clearAllMocks();
      findUser.mockResolvedValue(await childWith({ failedPinAttempts: prior, lastFailedPinAt: new Date() }));

      await authService.childLogin(CREDS).catch(() => undefined);

      const { lockedUntil } = lastUpdate();
      expect(lockedUntil).toBeInstanceOf(Date);
      durations.push(Math.round((lockedUntil.getTime() - Date.now()) / 60_000));
    }

    // 1min → 5min → 15min → 60min, then held at the 60min ceiling.
    expect(durations).toEqual([1, 5, 15, 60, 60]);
  });

  it('starts counting fresh when the previous failure has decayed', async () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60_000);
    findUser.mockResolvedValue(await childWith({ failedPinAttempts: 9, lastFailedPinAt: longAgo }));

    await authService.childLogin(CREDS).catch(() => undefined);

    // A child who fumbled their PIN months ago is not an attacker mid-run.
    expect(lastUpdate().failedPinAttempts).toBe(1);
    expect(lastUpdate()).not.toHaveProperty('lockedUntil');
  });

  it('clears the counter and the lock on a successful login', async () => {
    findUser.mockResolvedValue(await childWith({ failedPinAttempts: 3, lastFailedPinAt: new Date() }));

    await authService.childLogin({ ...CREDS, pin: '4321' });

    expect(lastUpdate()).toMatchObject({
      lockedUntil: null,
      failedPinAttempts: 0,
      lastFailedPinAt: null,
    });
  });

  it('still refuses a login while an active lock is in force', async () => {
    findUser.mockResolvedValue(
      await childWith({ lockedUntil: new Date(Date.now() + 10 * 60_000) }),
    );

    await expect(authService.childLogin({ ...CREDS, pin: '4321' }))
      .rejects.toThrow('Account is temporarily locked');
    expect(updateUser).not.toHaveBeenCalled();
  });
});
