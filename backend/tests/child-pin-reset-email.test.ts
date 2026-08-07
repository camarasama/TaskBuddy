/**
 * Proves requestChildPinReset() emails EVERY parent in the family, not just one.
 *
 * Deliberately does NOT mock EmailService wholesale (child-pin-reset.test.ts does that, and covers
 * everything else). Here, EmailService.sendToFamilyParents runs for REAL — only its two edges are
 * stubbed: the parent list comes from mocked Prisma, and EmailService.send (the per-recipient
 * primitive it fans out to) is spied on so no SMTP call happens. That means this test would fail
 * if requestChildPinReset were changed to call EmailService.send directly for a single parent, or
 * if sendToFamilyParents itself regressed to only notifying the first parent it finds.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    childProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  },
}));

import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';
import { EmailService } from '../src/services/email';

const findFamily = prisma.family.findFirst as jest.Mock;
const findChild = prisma.user.findFirst as jest.Mock;
const findParents = prisma.user.findMany as jest.Mock;

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => jest.clearAllMocks());

describe('requestChildPinReset — every parent in the family gets the email', () => {
  it('sends one email per parent, addressed to each of them, not just the first', async () => {
    findFamily.mockResolvedValue({ id: 'fam-1' });
    findChild.mockResolvedValue({ id: 'child-1', firstName: 'Sam', childProfile: { id: 'cp-1' } });
    findParents.mockResolvedValue([
      { id: 'parent-1', firstName: 'Pat', lastName: 'One', email: 'pat@example.com' },
      { id: 'parent-2', firstName: 'Jo', lastName: 'Two', email: 'jo@example.com' },
    ]);
    const sendSpy = jest.spyOn(EmailService, 'send').mockResolvedValue(undefined);

    await authService.requestChildPinReset('FAM-CODE-0001', 'sam');
    await flush(); // the email is fire-and-forget — let its microtasks settle

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map(([arg]) => arg.toEmail).sort();
    expect(recipients).toEqual(['jo@example.com', 'pat@example.com']);
    // Every call is the same trigger, scoped to the same family — only the recipient differs.
    for (const [arg] of sendSpy.mock.calls) {
      expect(arg.triggerType).toBe('child_pin_reset_requested');
      expect(arg.familyId).toBe('fam-1');
    }

    sendSpy.mockRestore();
  });

  it('sends nothing extra for a family with only one parent — one email, not zero, not two', async () => {
    findFamily.mockResolvedValue({ id: 'fam-1' });
    findChild.mockResolvedValue({ id: 'child-1', firstName: 'Sam', childProfile: { id: 'cp-1' } });
    findParents.mockResolvedValue([
      { id: 'parent-1', firstName: 'Pat', lastName: 'One', email: 'pat@example.com' },
    ]);
    const sendSpy = jest.spyOn(EmailService, 'send').mockResolvedValue(undefined);

    await authService.requestChildPinReset('FAM-CODE-0001', 'sam');
    await flush();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});
