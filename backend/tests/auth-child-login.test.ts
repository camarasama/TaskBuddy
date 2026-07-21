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
    const pinHash = await bcrypt.hash('4321', 12);
    findUser.mockResolvedValue({
      id: 'child-1',
      familyId: 'family-1',
      role: 'child',
      lockedUntil: null,
      childProfile: { pinHash, ageGroup: 'child' },
    });

    await expect(authService.childLogin(CREDS)).rejects.toThrow('Invalid credentials');

    // Any failed attempt locks the account for 15 minutes.
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'child-1' } }),
    );
  });
});
