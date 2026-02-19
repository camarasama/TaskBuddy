/**
 * emails/base.ts — M9 Email Notifications
 *
 * Provides:
 *  - baseLayout(content, title?) — wraps inner HTML in the branded shell
 *  - renderTemplate(triggerType, data) — dispatches to the correct template
 *
 * All per-trigger template files export a single function:
 *   export function buildXxx(data: XxxData): string
 * that returns the <inner content> HTML only (no <html>/<body> wrapper).
 * baseLayout() adds the shell so every email looks consistent.
 */

import { EmailTriggerType } from '../services/email';

// Per-trigger template imports
import { buildWelcome } from './welcome';
import { buildTaskSubmitted } from './taskSubmitted';
import { buildTaskApproved } from './taskApproved';
import { buildTaskRejected } from './taskRejected';
import { buildTaskExpiring } from './taskExpiring';
import { buildTaskExpired } from './taskExpired';
import { buildRewardRedeemed } from './rewardRedeemed';
import { buildLevelUp } from './levelUp';
import { buildStreakAtRisk } from './streakAtRisk';
import { buildCoParentInvite } from './coParentInvite';

// ─── Branding constants ───────────────────────────────────────────────────────

const BRAND_COLOR = '#6366f1';       // indigo-500
const BRAND_GRADIENT = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
const BRAND_NAME = 'TaskBuddy';
const BRAND_TAGLINE = 'Family Task Management';

// ─── Base layout ─────────────────────────────────────────────────────────────

/**
 * Wraps inner content HTML in the full branded email shell.
 * Inner content should be one or more <tr> rows that go inside the
 * main content table (already inside the white card).
 */
export function baseLayout(innerContent: string, previewText = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${BRAND_NAME}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preview text (hidden) -->
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌</div>` : ''}

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND_GRADIENT};padding:32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">${BRAND_NAME}</h1>
              <p style="margin:8px 0 0;color:#e0e7ff;font-size:14px;">${BRAND_TAGLINE}</p>
            </td>
          </tr>

          <!-- Dynamic content rows -->
          ${innerContent}

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center;">
                You're receiving this because you are a parent in a ${BRAND_NAME} family.<br>
                To change notification preferences, visit your
                <a href="${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/settings"
                   style="color:${BRAND_COLOR};text-decoration:none;">Family Settings</a>.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->
</body>
</html>`;
}

// ─── CTA button helper ────────────────────────────────────────────────────────

export function ctaButton(label: string, url: string): string {
  return `
  <table cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
    <tr>
      <td align="center">
        <a href="${url}"
           style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;
                  font-size:15px;font-weight:600;padding:13px 36px;border-radius:8px;
                  mso-padding-alt:0;text-underline-color:${BRAND_COLOR};">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

// ─── Info row helper ──────────────────────────────────────────────────────────

/** A single labelled data row, e.g. "Points awarded: 50" */
export function infoRow(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:4px 0;">
      <span style="color:#64748b;font-size:14px;">${label}:</span>
      <span style="color:#1e293b;font-size:14px;font-weight:600;margin-left:6px;">${value}</span>
    </td>
  </tr>`;
}

/** Wraps multiple infoRow() calls in a shaded table */
export function infoTable(rows: string): string {
  return `
  <table width="100%" cellpadding="12" cellspacing="0" border="0"
    style="background:#f8fafc;border-radius:8px;margin:16px 0;">
    ${rows}
  </table>`;
}

// ─── Template dispatcher ─────────────────────────────────────────────────────

export async function renderTemplate(
  triggerType: EmailTriggerType,
  data: Record<string, any>,
): Promise<string> {
  switch (triggerType) {
    case 'welcome':
      return buildWelcome(data as any);
    case 'task_submitted':
      return buildTaskSubmitted(data as any);
    case 'task_approved':
      return buildTaskApproved(data as any);
    case 'task_rejected':
      return buildTaskRejected(data as any);
    case 'task_expiring':
      return buildTaskExpiring(data as any);
    case 'task_expired':
      return buildTaskExpired(data as any);
    case 'reward_redeemed':
      return buildRewardRedeemed(data as any);
    case 'level_up':
      return buildLevelUp(data as any);
    case 'streak_at_risk':
      return buildStreakAtRisk(data as any);
    case 'co_parent_invite':
      return buildCoParentInvite(data as any);
    default:
      throw new Error(`[renderTemplate] Unknown triggerType: ${triggerType}`);
  }
}
