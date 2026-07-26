/**
 * services/ReferralService.ts — the cross-family referral loop (growth roadmap §7).
 *
 * §7 is the only section of the roadmap with nothing built behind it, and this is the one row in it
 * that is code rather than marketing work.
 *
 * **A referral code is not a family code.** `familyCode` admits a child to an existing family. A
 * referral code is meant to be posted in a WhatsApp group. Sharing one field for both would turn
 * every shared referral link into an account-takeover vector the moment someone used it as intended.
 *
 * **The incentive is a badge and nothing else.** No points, no reward, no unlock. Anything with
 * in-app value creates a reason to game it, and the only people who could be gamed here are
 * children — §11 already forbids purchases in the child experience, and manufacturing a points
 * faucet for adult recruitment sits on the wrong side of the same line.
 *
 * **Referral lives on the family, never on a child.** No child data participates in acquisition,
 * which keeps this entirely outside the COPPA surface.
 */

import { randomUUID } from 'crypto';
import { prisma } from './database';

/** Uppercase, unambiguous-ish, short enough to read aloud. */
export function generateReferralCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Badge tiers. Deliberately cosmetic: a label, not a currency. */
export const REFERRAL_TIERS = [
  { threshold: 1, badge: 'Friend of TaskBuddy' },
  { threshold: 3, badge: 'Community Builder' },
  { threshold: 10, badge: 'TaskBuddy Champion' },
] as const;

export function badgeFor(referredCount: number): string | null {
  let badge: string | null = null;
  for (const tier of REFERRAL_TIERS) {
    if (referredCount >= tier.threshold) badge = tier.badge;
  }
  return badge;
}

export interface ReferralSummary {
  referralCode: string;
  shareUrl: string;
  /** COUNT ONLY. Never a name, an email, or anything identifying another family. */
  referredCount: number;
  badge: string | null;
  nextBadgeAt: number | null;
}

/**
 * Resolve a referral code typed at registration into the referring family's id.
 *
 * Returns null for anything unusable — unknown code, blank, or the family's own. **An invalid code
 * must never fail a signup**: the entire purpose of this feature is to produce registrations, and
 * rejecting one over a mistyped referral would defeat it.
 */
export async function resolveReferrer(
  code: string | undefined | null,
  selfFamilyId?: string,
): Promise<string | null> {
  const normalised = code?.trim().toUpperCase();
  if (!normalised) return null;

  const family = await prisma.family.findUnique({
    where: { referralCode: normalised },
    select: { id: true, deletedAt: true },
  });

  if (!family || family.deletedAt) return null;
  if (selfFamilyId && family.id === selfFamilyId) return null; // no self-referral

  return family.id;
}

/** Ensure a family has a code, generating one on first read for any row the backfill missed. */
export async function ensureReferralCode(familyId: string): Promise<string> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { referralCode: true },
  });
  if (family?.referralCode) return family.referralCode;

  const code = generateReferralCode();
  await prisma.family.update({ where: { id: familyId }, data: { referralCode: code } });
  return code;
}

export async function getReferralSummary(familyId: string): Promise<ReferralSummary> {
  const referralCode = await ensureReferralCode(familyId);

  // A count, not a list. Who signed up is the other family's business, not this one's.
  const referredCount = await prisma.family.count({
    where: { referredByFamilyId: familyId, deletedAt: null },
  });

  const nextTier = REFERRAL_TIERS.find((t) => referredCount < t.threshold);
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';

  return {
    referralCode,
    shareUrl: `${baseUrl}/register?ref=${referralCode}`,
    referredCount,
    badge: badgeFor(referredCount),
    nextBadgeAt: nextTier?.threshold ?? null,
  };
}

export const ReferralService = {
  generateReferralCode,
  resolveReferrer,
  ensureReferralCode,
  getReferralSummary,
  badgeFor,
  REFERRAL_TIERS,
};
