import bcrypt from 'bcrypt';

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    refreshSession: { create: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));

import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';
import { EmailService } from '../src/services/email';

const findFirst = prisma.user.findFirst as jest.Mock;
const findUnique = prisma.user.findUnique as jest.Mock;
const notify = EmailService.sendToFamilyParents as jest.Mock;

// THRESHOLD is 4: attempts 1-4 do not lock; attempt 5 (== threshold+1) is the lock transition.
function childUser(failedLoginAttempts: number) {
  return {
    id: 'child1',
    role: 'child',
    familyId: 'fam1',
    firstName: 'Sam',
    passwordHash: null,
    lockedUntil: null,
    failedLoginAttempts,
    lastFailedLoginAt: new Date(), // recent → not stale, so attempts accumulate
    childProfile: { pinHash: '$2b$12$abcabcabcabcabcabcabcuHASH', ageGroup: 'child' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.family.findFirst as jest.Mock).mockResolvedValue({ id: 'fam1' });
  (prisma.user.update as jest.Mock).mockResolvedValue({});
  jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never); // always wrong PIN/password
});

afterEach(() => jest.restoreAllMocks());

async function attemptChildLogin() {
  await expect(
    authService.childLogin({ familyCode: 'FAM-CODE-0001', childIdentifier: 'Sam', pin: '0000' }),
  ).rejects.toThrow(/invalid credentials/i);
}

describe('child lockout notifies parents by email (F-8)', () => {
  it('emails parents on the lock transition (5th consecutive failure)', async () => {
    findFirst.mockResolvedValue(childUser(4)); // this failure is attempt 5
    await attemptChildLogin();

    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.triggerType).toBe('child_locked');
    expect(arg.familyId).toBe('fam1');
    expect(arg.templateData.childName).toBe('Sam');
    expect(arg.templateData.lockMinutes).toBeGreaterThan(0);
  });

  it('does NOT email (or lock) on a single wrong PIN', async () => {
    findFirst.mockResolvedValue(childUser(0)); // attempt 1
    await attemptChildLogin();

    expect(notify).not.toHaveBeenCalled();
    // No lockedUntil written on a first failure.
    const updateData = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.lockedUntil).toBeUndefined();
  });

  it('does NOT re-email on failures once already locked', async () => {
    findFirst.mockResolvedValue(childUser(5)); // attempt 6 — still locked, but not a transition
    await attemptChildLogin();
    expect(notify).not.toHaveBeenCalled();
  });

  it('a failed PARENT login never sends the child_locked email', async () => {
    findUnique.mockResolvedValue({
      id: 'parent1',
      role: 'parent',
      familyId: 'fam1',
      firstName: 'Alex',
      passwordHash: '$2b$12$parentparentparentparentHASH',
      lockedUntil: null,
      failedLoginAttempts: 4, // next attempt is 5 (would lock a child)
      lastFailedLoginAt: new Date(),
      family: { id: 'fam1' },
      childProfile: null,
    });

    await expect(
      authService.login({ email: 'alex@example.com', password: 'wrong' }),
    ).rejects.toThrow(/invalid email or password/i);

    expect(notify).not.toHaveBeenCalled();
  });
});
