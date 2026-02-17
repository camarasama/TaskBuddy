import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import { prisma } from './database';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../middleware/errorHandler';
import { authService } from './auth';

const SALT_ROUNDS = 12;
const INVITE_EXPIRES_HOURS = parseInt(process.env.INVITE_TOKEN_EXPIRES_HOURS || '168', 10); // 7 days

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SendInviteInput {
  familyId: string;
  invitedByUserId: string;
  email: string;
}

export interface AcceptInviteInput {
  token: string;
  firstName: string;
  lastName: string;
  password: string;
  dateOfBirth?: string;
  phone?: string;
}

// ─── Email transport (plain nodemailer; replaced by EmailService in M9) ─────

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class InviteService {
  // POST /families/me/invite
  async sendInvite(input: SendInviteInput): Promise<void> {
    const { familyId, invitedByUserId, email } = input;

    // 1. Verify caller is a parent in this family
    const caller = await prisma.user.findUnique({
      where: { id: invitedByUserId },
      include: { family: true },
    });

    if (!caller || caller.familyId !== familyId || caller.role !== 'parent') {
      throw new UnauthorizedError('Only parents can send co-parent invitations');
    }

    // 2. Check the email isn't already a member of this family
    const existingMember = await prisma.user.findFirst({
      where: {
        familyId,
        email: email.toLowerCase(),
        deletedAt: null,
      },
    });

    if (existingMember) {
      throw new ConflictError('This email address is already a member of your family');
    }

    // 3. Check there's no unexpired pending invite for this email+family combo
    const existingInvite = await prisma.familyInvitation.findFirst({
      where: {
        familyId,
        email: email.toLowerCase(),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      throw new ConflictError('An active invitation has already been sent to this email address');
    }

    // 4. Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);

    // 5. Persist the invitation record
    await prisma.familyInvitation.create({
      data: {
        familyId,
        invitedByUserId,
        email: email.toLowerCase(),
        token,
        expiresAt,
      },
    });

    // 6. Send the invite email (best-effort — don't throw if SMTP not configured in dev)
    const frontendUrl = process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000';
    const acceptUrl = `${frontendUrl}/invite/accept?token=${token}`;
    const familyName = caller.family.familyName;
    const inviterName = `${caller.firstName} ${caller.lastName}`;

    try {
      const transporter = createTransport();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'TaskBuddy <noreply@taskbuddy.app>',
        to: email,
        subject: `${inviterName} invited you to join ${familyName} on TaskBuddy`,
        html: buildInviteEmail({ inviterName, familyName, acceptUrl, expiresHours: INVITE_EXPIRES_HOURS }),
      });
    } catch (err) {
      // Log but don't block — in development SMTP is often not configured
      console.warn('[InviteService] Failed to send invite email (SMTP not configured?):', err);
    }
  }

  // POST /auth/accept-invite
  async acceptInvite(input: AcceptInviteInput) {
    const { token, firstName, lastName, password, dateOfBirth, phone } = input;

    // 1. Look up the invitation
    const invitation = await prisma.familyInvitation.findUnique({
      where: { token },
      include: { family: true, invitedBy: true },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found or has already been used');
    }

    // 2. Check expiry
    if (invitation.expiresAt < new Date()) {
      throw new ValidationError('This invitation link has expired. Ask the primary parent to send a new one.');
    }

    // 3. Check not already accepted
    if (invitation.acceptedAt) {
      throw new ConflictError('This invitation has already been accepted');
    }

    // 4. Check the email isn't already a user in this family (edge-case: they registered independently)
    const existingUser = await prisma.user.findFirst({
      where: { email: invitation.email, familyId: invitation.familyId, deletedAt: null },
    });

    if (existingUser) {
      throw new ConflictError('An account with this email already exists in this family');
    }

    // 5. Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 6. Create the co-parent user and mark invitation accepted — both in one transaction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          familyId: invitation.familyId,
          email: invitation.email,
          passwordHash,
          role: 'parent',
          isPrimaryParent: false,
          firstName,
          lastName,
        },
      });

      await tx.familyInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return user;
    });

    // 7. Generate JWT tokens using the shared helper on authService
    const tokens = (authService as any).generateTokens({
      userId: result.id,
      familyId: result.familyId,
      role: result.role,
    });

    const { passwordHash: _, ...userWithoutPassword } = result;

    return {
      user: userWithoutPassword,
      family: { id: invitation.family.id, familyName: invitation.family.familyName },
      tokens,
    };
  }

  // GET /families/me/parents
  async listParents(familyId: string) {
    const parents = await prisma.user.findMany({
      where: {
        familyId,
        role: 'parent',
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isPrimaryParent: true,
        avatarUrl: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isPrimaryParent: 'desc' }, { createdAt: 'asc' }],
    });

    // Also surface pending (not yet accepted) invitations
    const pendingInvites = await prisma.familyInvitation.findMany({
      where: {
        familyId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return { parents, pendingInvites };
  }

  // DELETE /families/me/parents/:id
  async removeParent(familyId: string, callerId: string, targetId: string): Promise<void> {
    // Fetch both users
    const [caller, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: callerId } }),
      prisma.user.findUnique({ where: { id: targetId } }),
    ]);

    if (!caller || caller.familyId !== familyId || caller.role !== 'parent') {
      throw new UnauthorizedError('Not authorized');
    }

    if (!target || target.familyId !== familyId || target.role !== 'parent') {
      throw new NotFoundError('Parent not found in this family');
    }

    // Co-parents cannot remove anyone; only the primary parent can remove co-parents
    if (!caller.isPrimaryParent) {
      throw new UnauthorizedError('Only the primary parent can remove co-parents');
    }

    // Primary parent cannot remove themselves
    if (target.isPrimaryParent) {
      throw new UnauthorizedError('The primary parent account cannot be removed');
    }

    // Soft-delete the co-parent (invalidates their JWT on next request via isActive check)
    await prisma.user.update({
      where: { id: targetId },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
}

export const inviteService = new InviteService();

// ─── Email template ──────────────────────────────────────────────────────────

function buildInviteEmail(opts: {
  inviterName: string;
  familyName: string;
  acceptUrl: string;
  expiresHours: number;
}): string {
  const expiresDays = Math.round(opts.expiresHours / 24);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">TaskBuddy</h1>
            <p style="margin:8px 0 0;color:#e0e7ff;font-size:14px;">Family Task Management</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 24px;">
            <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;">You've been invited!</h2>
            <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
              <strong>${opts.inviterName}</strong> has invited you to join the
              <strong>${opts.familyName}</strong> family on TaskBuddy as a co-parent.
            </p>
            <p style="margin:0 0 32px;color:#475569;font-size:16px;line-height:1.6;">
              As a co-parent you'll have full access to manage tasks, approve completions,
              and create rewards for your family.
            </p>
            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="${opts.acceptUrl}"
                     style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 40px;border-radius:8px;">
                    Accept Invitation
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer note -->
        <tr>
          <td style="padding:24px 40px 40px;">
            <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
              This invitation expires in <strong>${expiresDays} days</strong>.
              If you didn't expect this email you can safely ignore it.
            </p>
            <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;">
              Or copy this link: <a href="${opts.acceptUrl}" style="color:#6366f1;">${opts.acceptUrl}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
