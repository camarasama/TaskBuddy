/**
 * U20 — the cross-family referral loop (growth roadmap §7).
 *
 * §7 is the only section of the roadmap with nothing built behind it. Three properties matter more
 * than the mechanic itself:
 *
 *  - **A referral code is not a family code.** `familyCode` admits a child to a family; a referral
 *    code is meant to be posted in a group chat. If one field served both, every shared referral
 *    link would be an account-takeover vector.
 *  - **A bad code must never cost a signup.** This feature exists to produce registrations; failing
 *    one over a mistyped referral would defeat its entire purpose.
 *  - **The incentive is a badge and nothing else.** Anything with in-app value creates a reason to
 *    game it, and children are the only people here who could be gamed.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  },
}));

import {
  badgeFor,
  ensureReferralCode,
  generateReferralCode,
  getReferralSummary,
  resolveReferrer,
  REFERRAL_TIERS,
} from '../src/services/ReferralService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  family: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
};

const FAMILY = 'fam-1';
const OTHER = 'fam-2';

beforeEach(() => {
  jest.clearAllMocks();
  p.family.findUnique.mockResolvedValue({ id: OTHER, deletedAt: null, referralCode: 'ABC12345' });
  p.family.count.mockResolvedValue(0);
});

// ─── Codes ────────────────────────────────────────────────────────────────────

describe('generateReferralCode', () => {
  it('produces a short uppercase code', () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 200 }, generateReferralCode));
    expect(codes.size).toBe(200);
  });
});

// ─── AC-U20b / AC-U20c: resolving a code ──────────────────────────────────────

describe('resolveReferrer', () => {
  it('resolves a valid code to the referring family', async () => {
    expect(await resolveReferrer('ABC12345')).toBe(OTHER);
  });

  it('is case- and whitespace-insensitive', async () => {
    await resolveReferrer('  abc12345 ');
    expect(p.family.findUnique.mock.calls[0][0].where.referralCode).toBe('ABC12345');
  });

  it('looks up the REFERRAL code, never the family code', async () => {
    // The distinction this whole design rests on: family_code admits a child to a family, and a
    // referral code is meant to be public.
    await resolveReferrer('ABC12345');
    const where = p.family.findUnique.mock.calls[0][0].where;
    expect(where).toEqual({ referralCode: 'ABC12345' });
    expect(where).not.toHaveProperty('familyCode');
  });

  // AC-U20b — the property that protects the funnel.
  it('returns null for an unknown code rather than throwing', async () => {
    // A mistyped referral must never cost a signup; producing signups is the point of the feature.
    p.family.findUnique.mockResolvedValue(null);
    expect(await resolveReferrer('NOPE0000')).toBeNull();
  });

  it('returns null for a blank or missing code without querying', async () => {
    expect(await resolveReferrer(undefined)).toBeNull();
    expect(await resolveReferrer('   ')).toBeNull();
    expect(p.family.findUnique).not.toHaveBeenCalled();
  });

  it('ignores a deleted family', async () => {
    p.family.findUnique.mockResolvedValue({ id: OTHER, deletedAt: new Date() });
    expect(await resolveReferrer('ABC12345')).toBeNull();
  });

  // AC-U20c
  it('refuses self-referral', async () => {
    p.family.findUnique.mockResolvedValue({ id: FAMILY, deletedAt: null });
    expect(await resolveReferrer('ABC12345', FAMILY)).toBeNull();
  });
});

// ─── Badges ───────────────────────────────────────────────────────────────────

describe('badgeFor', () => {
  it('gives no badge at zero', () => {
    expect(badgeFor(0)).toBeNull();
  });

  it('awards each tier at its threshold', () => {
    for (const tier of REFERRAL_TIERS) {
      expect(badgeFor(tier.threshold)).toBe(tier.badge);
    }
  });

  it('keeps the highest tier reached, not the last one matched', () => {
    expect(badgeFor(100)).toBe(REFERRAL_TIERS[REFERRAL_TIERS.length - 1].badge);
  });

  // AC-U20h
  it('is a LABEL, carrying no points or in-app value', () => {
    // Anything spendable would create a reason to game this, and children are the only people here
    // to game. §11 already forbids purchases in the child experience.
    for (const tier of REFERRAL_TIERS) {
      expect(typeof tier.badge).toBe('string');
      expect(Object.keys(tier).sort()).toEqual(['badge', 'threshold']);
    }
  });
});

// ─── AC-U20e / AC-U20f: the summary ───────────────────────────────────────────

describe('getReferralSummary', () => {
  it('returns the code, a share link and a count', async () => {
    p.family.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });
    p.family.count.mockResolvedValue(2);

    const summary = await getReferralSummary(FAMILY);
    expect(summary.referralCode).toBe('ABC12345');
    expect(summary.shareUrl).toContain('/register?ref=ABC12345');
    expect(summary.referredCount).toBe(2);
  });

  // AC-U20f — the privacy line.
  it('returns a COUNT, never a list of who signed up', async () => {
    // Who joined is that family's business, not this one's.
    p.family.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });
    p.family.count.mockResolvedValue(3);

    const summary = await getReferralSummary(FAMILY);
    const serialised = JSON.stringify(summary);

    expect(typeof summary.referredCount).toBe('number');
    expect(serialised).not.toMatch(/@|familyName|email/i);
    expect(Object.keys(summary).sort()).toEqual(
      ['badge', 'nextBadgeAt', 'referralCode', 'referredCount', 'shareUrl'].sort(),
    );
  });

  it('counts only live families it actually referred', async () => {
    p.family.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });
    await getReferralSummary(FAMILY);
    expect(p.family.count.mock.calls[0][0].where).toEqual({
      referredByFamilyId: FAMILY,
      deletedAt: null,
    });
  });

  it('reports the next badge threshold, and null once every tier is earned', async () => {
    p.family.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });

    p.family.count.mockResolvedValue(0);
    expect((await getReferralSummary(FAMILY)).nextBadgeAt).toBe(REFERRAL_TIERS[0].threshold);

    p.family.count.mockResolvedValue(999);
    expect((await getReferralSummary(FAMILY)).nextBadgeAt).toBeNull();
  });
});

// ─── AC-U20a ──────────────────────────────────────────────────────────────────

describe('ensureReferralCode', () => {
  it('returns the existing code without writing', async () => {
    p.family.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });
    expect(await ensureReferralCode(FAMILY)).toBe('ABC12345');
    expect(p.family.update).not.toHaveBeenCalled();
  });

  it('generates one for a family the backfill missed', async () => {
    p.family.findUnique.mockResolvedValue({ referralCode: null });
    const code = await ensureReferralCode(FAMILY);

    expect(code).toMatch(/^[0-9A-F]{8}$/);
    expect(p.family.update.mock.calls[0][0].data.referralCode).toBe(code);
  });
});
