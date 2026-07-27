// Child usernames: mandatory, unique per family, and the ONLY thing childLogin matches on.
//
// The bug these guard: childLogin resolved a child with findFirst() matching
// `firstName OR username`, and `username` carried no unique constraint. Two siblings sharing a
// first name resolved to whichever row Postgres returned first — so the other child could never
// log in, and each of her attempts recorded a failed login against her SIBLING's account until
// that sibling was locked out.

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    childProfile: { create: jest.fn() },
    refreshSession: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  },
}));

import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';

const findFamily = prisma.family.findFirst as jest.Mock;
const findUser = prisma.user.findFirst as jest.Mock;
const findUserById = prisma.user.findUnique as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;

/** A date of birth that lands inside the supported 10-16 band regardless of when this runs. */
function dobAged(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.update = jest.fn().mockResolvedValue({});
});

describe('childLogin — username is the only identifier', () => {
  beforeEach(() => {
    findFamily.mockResolvedValue({ id: 'family-1' });
    findUser.mockResolvedValue(null);
  });

  it('never matches on first name', async () => {
    await expect(
      authService.childLogin({ familyCode: 'BRAVE-OTTER-4417', childIdentifier: 'Sam', pin: '1234' }),
    ).rejects.toThrow('Invalid credentials');

    const where = findUser.mock.calls[0][0].where;
    expect(where.username).toBe('sam');
    // The regression itself: an OR across firstName re-introduces the ambiguity.
    expect(where.OR).toBeUndefined();
    expect(JSON.stringify(where)).not.toContain('firstName');
  });

  it('normalises the typed identifier so casing and stray spaces still sign in', async () => {
    await expect(
      authService.childLogin({ familyCode: 'BRAVE-OTTER-4417', childIdentifier: '  SaM  ', pin: '1234' }),
    ).rejects.toThrow('Invalid credentials');

    expect(findUser.mock.calls[0][0].where.username).toBe('sam');
  });

  it('scopes the lookup to the resolved family', async () => {
    await expect(
      authService.childLogin({ familyCode: 'BRAVE-OTTER-4417', childIdentifier: 'sam', pin: '1234' }),
    ).rejects.toThrow('Invalid credentials');

    expect(findUser.mock.calls[0][0].where.familyId).toBe('family-1');
  });
});

describe('addChild — username is mandatory and unique within the family', () => {
  const PARENT = { id: 'parent-1', familyId: 'family-1', role: 'parent' };

  const input = (over: Record<string, unknown> = {}) => ({
    familyId: 'family-1',
    firstName: 'Sam',
    lastName: 'Jones',
    dateOfBirth: dobAged(12),
    username: 'sam',
    createdBy: 'parent-1',
    ...over,
  }) as Parameters<typeof authService.addChild>[0];

  beforeEach(() => {
    findUserById.mockResolvedValue(PARENT);
    findUser.mockResolvedValue(null);
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: jest.fn().mockResolvedValue({ id: 'child-1', username: 'sam' }) },
        childProfile: { create: jest.fn().mockResolvedValue({ id: 'profile-1', pinHash: null }) },
      }),
    );
  });

  it('rejects a child created without a username', async () => {
    await expect(authService.addChild(input({ username: undefined }))).rejects.toThrow(
      'Username is required',
    );
  });

  it('rejects a username that breaks the format rule', async () => {
    await expect(authService.addChild(input({ username: 'a b!' }))).rejects.toThrow(
      /Username must be 3-20 characters/,
    );
  });

  it('rejects a username already used by a sibling', async () => {
    findUser.mockResolvedValue({ id: 'child-existing' });

    await expect(authService.addChild(input())).rejects.toThrow(
      'That username is already taken in this family',
    );
  });

  it('checks uniqueness within the family only, so other families may reuse the name', async () => {
    await authService.addChild(input());

    // Previously this query had no familyId, making usernames globally unique — one family
    // taking "sam" locked every other family out of it forever.
    expect(findUser).toHaveBeenCalledWith({
      where: { familyId: 'family-1', username: 'sam' },
    });
  });

  it('stores the username lowercased and trimmed', async () => {
    let created: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: {
          create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            created = args.data;
            return Promise.resolve({ id: 'child-1' });
          }),
        },
        childProfile: { create: jest.fn().mockResolvedValue({ id: 'profile-1', pinHash: null }) },
      }),
    );

    await authService.addChild(input({ username: '  SaM_01  ' }));

    expect(created?.username).toBe('sam_01');
  });
});
