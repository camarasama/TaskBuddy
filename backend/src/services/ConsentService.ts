/**
 * services/ConsentService.ts — COPPA verifiable parental consent (growth roadmap §3.2).
 *
 * What already existed was NOT this. `AuditLog` rows with `action: 'CONSENT'` record that a parent
 * accepted the ToS and privacy policy — a GDPR-K trail. COPPA additionally requires a **verification
 * method**, and requires child data collection to be **blocked until verification completes**. This
 * module is that layer; the audit events stay and serve their own purpose.
 *
 * **The method is pluggable on purpose.** The FTC accepts several (signed form, credit/debit card
 * transaction, phone or video with trained personnel, government ID, or email-plus). Card-based
 * verification needs a payment rail, which this product deliberately does not have. Email-plus is
 * the only accepted method requiring no new commercial infrastructure, and it is permitted only
 * where personal data is not disclosed to third parties — true here. If that ever changes, or if
 * counsel prefers a stricter method, implement `ConsentMethod` and swap the registry entry; no call
 * site moves.
 *
 * ⚠️ The METHOD choice is an engineering decision enabling a legal requirement, not legal advice.
 * It needs the same review already pending on PRIVACY.md / TERMS.md.
 */

import crypto from 'crypto';
import { prisma } from './database';
import { EmailService } from './email';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler';
import { CONSENT_VERSIONS } from '@taskbuddy/shared';

/** How long an unverified consent request stays usable. */
export const CONSENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ConsentStatus = 'pending' | 'verified' | 'revoked' | 'none';

/**
 * A verification method. Implement this to add a stricter one (ID check, card transaction, signed
 * form) without touching the gate or any route.
 */
export interface ConsentMethod {
  /** Stored on the record so a later audit can tell which method was used. */
  id: string;
  /** Shown to the parent. */
  label: string;
  /**
   * Start verification. Receives the raw token; must deliver it to the PARENT out of band.
   * Returning normally means "delivery attempted", not "verified".
   */
  initiate(input: {
    familyId: string;
    parentEmail: string;
    parentFirstName: string;
    rawToken: string;
  }): Promise<void>;
  /**
   * The "plus" step, run AFTER the link is followed. For email-plus this is a second notice to the
   * same address, so a child who reached a parent's inbox cannot complete consent without leaving
   * the parent a visible record. That second contact is what distinguishes email-plus from plain
   * email consent under the FTC rule.
   */
  confirm(input: { parentEmail: string; parentFirstName: string }): Promise<void>;
}

function appUrl(): string {
  return (
    process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'
  );
}

const emailPlus: ConsentMethod = {
  id: 'email_plus',
  label: 'Email confirmation',

  async initiate({ parentEmail, parentFirstName, rawToken }) {
    await EmailService.send({
      triggerType: 'parental_consent',
      toEmail: parentEmail,
      toUserId: null,
      familyId: null,
      subject: 'Confirm you are the parent — TaskBuddy',
      templateData: {
        parentFirstName,
        confirmUrl: `${appUrl()}/parent/consent/confirm?token=${rawToken}`,
        expiryDays: Math.round(CONSENT_TOKEN_TTL_MS / 86_400_000),
        isConfirmation: false,
      },
      // The parent may not have a verified email yet; this IS the verification.
      skipPreferenceCheck: true,
    });
  },

  async confirm({ parentEmail, parentFirstName }) {
    await EmailService.send({
      triggerType: 'parental_consent',
      toEmail: parentEmail,
      toUserId: null,
      familyId: null,
      subject: 'Parental consent recorded — TaskBuddy',
      templateData: { parentFirstName, isConfirmation: true },
      skipPreferenceCheck: true,
    });
  },
};

/** Registered methods. Exactly one is active today; see the header for why. */
const METHODS: Record<string, ConsentMethod> = { [emailPlus.id]: emailPlus };
export const ACTIVE_METHOD_ID = emailPlus.id;

export function getMethod(id: string = ACTIVE_METHOD_ID): ConsentMethod {
  const method = METHODS[id];
  if (!method) throw new ValidationError(`Unknown consent method "${id}"`);
  return method;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Whether this family may create child accounts.
 *
 * The single question the gate asks. Deliberately a positive check — an absent record means NOT
 * consented, so a failure to write one can never accidentally permit collection.
 */
export async function hasVerifiedConsent(familyId: string): Promise<boolean> {
  const record = await prisma.parentalConsent.findUnique({
    where: { familyId },
    select: { status: true },
  });
  return record?.status === 'verified';
}

export async function getStatus(familyId: string): Promise<{
  status: ConsentStatus;
  method: string | null;
  verifiedAt: Date | null;
  requestedAt: Date | null;
}> {
  const record = await prisma.parentalConsent.findUnique({ where: { familyId } });
  if (!record) return { status: 'none', method: null, verifiedAt: null, requestedAt: null };

  // A pending request past its TTL is reported as 'none' so the UI offers a fresh start rather than
  // a dead "check your email".
  const expired =
    record.status === 'pending' && record.expiresAt !== null && record.expiresAt < new Date();

  return {
    status: expired ? 'none' : (record.status as ConsentStatus),
    method: record.method,
    verifiedAt: record.verifiedAt,
    requestedAt: record.requestedAt,
  };
}

/**
 * Start (or restart) verification for a family.
 *
 * Idempotent from the parent's point of view: requesting again replaces any pending record and
 * re-sends, which is what someone who lost the email will do. Requesting when already verified is a
 * conflict rather than a silent no-op — re-consenting should be deliberate.
 */
export async function requestConsent(params: {
  familyId: string;
  parentId: string;
  methodId?: string;
}): Promise<{ status: 'pending'; method: string }> {
  const { familyId, parentId, methodId } = params;

  const existing = await prisma.parentalConsent.findUnique({ where: { familyId } });
  if (existing?.status === 'verified') {
    throw new ConflictError('Parental consent has already been verified for this family.');
  }

  const parent = await prisma.user.findFirst({
    where: { id: parentId, familyId, role: 'parent', deletedAt: null },
    select: { email: true, firstName: true },
  });
  if (!parent?.email) throw new NotFoundError('Parent email not found');

  const method = getMethod(methodId);
  const rawToken = crypto.randomBytes(32).toString('hex');

  await prisma.parentalConsent.upsert({
    where: { familyId },
    create: {
      familyId,
      parentId,
      method: method.id,
      status: 'pending',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + CONSENT_TOKEN_TTL_MS),
      tosVersion: CONSENT_VERSIONS.tos,
      privacyVersion: CONSENT_VERSIONS.privacy,
    },
    update: {
      parentId,
      method: method.id,
      status: 'pending',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + CONSENT_TOKEN_TTL_MS),
      requestedAt: new Date(),
      verifiedAt: null,
      tosVersion: CONSENT_VERSIONS.tos,
      privacyVersion: CONSENT_VERSIONS.privacy,
    },
  });

  await method.initiate({
    familyId,
    parentEmail: parent.email,
    parentFirstName: parent.firstName,
    rawToken,
  });

  return { status: 'pending', method: method.id };
}

/**
 * Complete verification from the emailed token.
 *
 * Looks the record up BY TOKEN HASH rather than by family, so possessing the link is the whole
 * proof — no family id in the URL to tamper with.
 */
export async function verifyConsent(params: {
  rawToken: string;
  ipAddress?: string;
}): Promise<{ familyId: string }> {
  const record = await prisma.parentalConsent.findFirst({
    where: { tokenHash: hashToken(params.rawToken) },
  });

  if (!record) throw new NotFoundError('That confirmation link is not valid.');
  if (record.status === 'verified') return { familyId: record.familyId }; // idempotent re-click
  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new ConflictError('That confirmation link has expired. Please request a new one.');
  }

  await prisma.parentalConsent.update({
    where: { id: record.id },
    data: {
      status: 'verified',
      verifiedAt: new Date(),
      ipAddress: params.ipAddress ?? null,
      // Burn the token so the link is single-use.
      tokenHash: null,
      expiresAt: null,
    },
  });

  // The "plus" step. Failure here must not un-verify a consent the parent has legitimately given.
  const parent = await prisma.user.findUnique({
    where: { id: record.parentId },
    select: { email: true, firstName: true },
  });
  if (parent?.email) {
    await getMethod(record.method)
      .confirm({ parentEmail: parent.email, parentFirstName: parent.firstName })
      .catch((err) =>
        console.error('[ConsentService] confirmation notice failed:', (err as Error)?.message),
      );
  }

  return { familyId: record.familyId };
}

export const ConsentService = {
  hasVerifiedConsent,
  getStatus,
  requestConsent,
  verifyConsent,
  getMethod,
  ACTIVE_METHOD_ID,
};
