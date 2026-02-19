/**
 * services/email.ts — M9 Email Notifications
 *
 * Central email sender for all TaskBuddy notification triggers.
 * Responsibilities:
 *  - Check family notification preferences before sending
 *  - Render the correct HTML template for each trigger type
 *  - Send via nodemailer with up to 2 retries on transient SMTP failures
 *  - Log every attempt (sent / failed) to the email_logs table
 *
 * All callers use fire-and-forget:
 *   EmailService.send({...}).catch(err => console.error(...));
 *
 * EmailService.sendToFamilyParents() is a convenience wrapper that
 * queries all parent-role users in a family and calls send() for each.
 */

import nodemailer from 'nodemailer';
import { prisma } from './database';
import { renderTemplate } from '../emails/base';

// ─── Trigger types (must match FamilySettings.notificationPreferences keys) ──

export type EmailTriggerType =
  | 'welcome'
  | 'task_submitted'
  | 'task_approved'
  | 'task_rejected'
  | 'task_expiring'
  | 'task_expired'
  | 'reward_redeemed'
  | 'level_up'
  | 'streak_at_risk'
  | 'co_parent_invite';

// ─── Input types ─────────────────────────────────────────────────────────────

export interface SendEmailInput {
  triggerType: EmailTriggerType;
  toEmail: string;
  toUserId: string | null;   // null for pre-registration recipients (invitees)
  familyId: string;
  subject: string;
  templateData: Record<string, any>;
  referenceType?: string;    // e.g. 'task_assignment', 'reward_redemption'
  referenceId?: string;
  /** Skip the notificationPreferences check (used for invite emails where
   *  the invitee has no family record yet) */
  skipPreferenceCheck?: boolean;
}

export interface SendToParentsInput {
  familyId: string;
  triggerType: EmailTriggerType;
  /** Called once per parent to build a personalised subject line */
  subjectBuilder: (parent: { firstName: string; lastName: string; email: string }) => string;
  templateData: Record<string, any>;
  referenceType?: string;
  referenceId?: string;
}

// ─── SMTP transport ───────────────────────────────────────────────────────────

function createTransport() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    // port 465 = implicit TLS (secure:true), port 587 = STARTTLS (secure:false)
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    tls: {
      // Reject self-signed certs in production; allow in dev for local SMTP
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
}

// Gmail requires the "from" address to exactly match the authenticated SMTP_USER.
// This helper builds a safe from address that won't be rejected.
function buildFromAddress(): string {
  const user = process.env.SMTP_USER || '';
  const smtpFrom = process.env.SMTP_FROM || '';
  const fromEmailMatch = smtpFrom.match(/<([^>]+)>/);
  const fromEmail = fromEmailMatch ? fromEmailMatch[1] : smtpFrom;
  if (fromEmail && fromEmail.toLowerCase() === user.toLowerCase()) {
    return smtpFrom; // safe to use the display-name version
  }
  // Gmail rejects mismatched from — fall back to bare auth user
  return user;
}

// ─── Preference check ────────────────────────────────────────────────────────

/**
 * Returns true if the family's notification preferences allow this trigger.
 * Defaults to true if the preferences key is absent (safe default = opt-in).
 */
async function isNotificationEnabled(
  familyId: string,
  triggerType: EmailTriggerType,
): Promise<boolean> {
  const settings = await prisma.familySettings.findUnique({
    where: { familyId },
    select: { notificationPreferences: true },
  });

  if (!settings) return true; // no settings record → allow

  const prefs = (settings.notificationPreferences as Record<string, boolean>) ?? {};
  // If the key is missing default to true (opt-in)
  return prefs[triggerType] !== false;
}

// ─── Core send logic ─────────────────────────────────────────────────────────

const MAX_RETRIES = 2;

export class EmailService {
  /**
   * Send a single email.
   * Checks notification preferences (unless skipPreferenceCheck is true),
   * renders the HTML template, attempts delivery with retries,
   * and records the result in email_logs.
   */
  static async send(input: SendEmailInput): Promise<void> {
    const {
      triggerType,
      toEmail,
      toUserId,
      familyId,
      subject,
      templateData,
      referenceType,
      referenceId,
      skipPreferenceCheck = false,
    } = input;

    // 1. Check notification preferences
    if (!skipPreferenceCheck) {
      const enabled = await isNotificationEnabled(familyId, triggerType);
      if (!enabled) {
        // Preference is off — do not queue or log (T3 requirement: not queued, not dropped)
        console.log(
          `[EmailService] ${triggerType} suppressed by family prefs (familyId=${familyId})`,
        );
        return;
      }
    }

    // 2. Render HTML
    let html: string;
    try {
      html = await renderTemplate(triggerType, templateData);
    } catch (renderErr: any) {
      console.error(`[EmailService] Template render failed for ${triggerType}:`, renderErr?.message);
      // Log as failed and re-throw so callers know
      await logEmail({ toEmail, toUserId, familyId, triggerType, subject, status: 'failed', errorMessage: renderErr?.message, referenceType, referenceId });
      throw renderErr;
    }

    // 3. Send with retry
    const transporter = createTransport();
    let lastError: any;
    let sent = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await transporter.sendMail({
          from: buildFromAddress(),
          to: toEmail,
          subject,
          html,
        });
        sent = true;
        break;
      } catch (err: any) {
        lastError = err;
        const isTransient =
          err?.responseCode >= 500 || // SMTP 5xx
          err?.code === 'ECONNRESET' ||
          err?.code === 'ETIMEDOUT';

        if (!isTransient || attempt === MAX_RETRIES) break;

        // Wait before retry: 2s, 4s
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      }
    }

    // 4. Log result
    await logEmail({
      toEmail,
      toUserId,
      familyId,
      triggerType,
      subject,
      status: sent ? 'sent' : 'failed',
      errorMessage: sent ? undefined : lastError?.message,
      referenceType,
      referenceId,
    });

    if (!sent) {
      throw lastError;
    }
  }

  /**
   * Send the same email to all parent-role users in a family.
   * Each parent gets their own send() call (separate log entry, separate subject if personalised).
   * Parents whose individual notification prefs block the trigger are skipped.
   */
  static async sendToFamilyParents(input: SendToParentsInput): Promise<void> {
    const { familyId, triggerType, subjectBuilder, templateData, referenceType, referenceId } = input;

    // Fetch all active parents in the family
    const parents = await prisma.user.findMany({
      where: { familyId, role: 'parent', deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (parents.length === 0) {
      console.warn(`[EmailService] sendToFamilyParents: no active parents found for familyId=${familyId}`);
      return;
    }

    // Send concurrently; don't let one failure block others
    await Promise.allSettled(
      parents.map((parent) =>
        EmailService.send({
          triggerType,
          toEmail: parent.email,
          toUserId: parent.id,
          familyId,
          subject: subjectBuilder(parent),
          templateData,
          referenceType,
          referenceId,
        }).catch((err) =>
          console.error(
            `[EmailService] ${triggerType} failed for parent ${parent.email}:`,
            err?.message,
          ),
        ),
      ),
    );
  }
}

// ─── Email log helper ─────────────────────────────────────────────────────────

interface LogEmailInput {
  toEmail: string;
  toUserId: string | null;
  familyId: string;
  triggerType: EmailTriggerType;
  subject: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  referenceType?: string;
  referenceId?: string;
}

async function logEmail(input: LogEmailInput): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        toEmail: input.toEmail,
        toUserId: input.toUserId,
        familyId: input.familyId,
        triggerType: input.triggerType,
        subject: input.subject,
        status: input.status === 'sent' ? 'sent' : 'failed',
        errorMessage: input.errorMessage,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });
  } catch (logErr: any) {
    // Never let a logging failure crash the caller
    console.error('[EmailService] Failed to write email_log:', logErr?.message);
  }
}
