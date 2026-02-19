/**
 * services/invite.ts — Updated M9 (Email Notifications)
 *
 * Changes from M8:
 *  - The inline nodemailer createTransport(), buildFromAddress(), and
 *    buildInviteEmail() helpers have been removed. The co-parent invite
 *    email is now sent via EmailService.send() with
 *    triggerType='co_parent_invite', which handles SMTP transport, retry
 *    logic, preference checks, and email_logs in one consistent place.
 *    The HTML template moves to backend/src/emails/coParentInvite.ts.
 *  - sendInvite() still returns { acceptUrl, emailSent } so the API
 *    contract is unchanged and callers need no updates.
 *
 * Everything else is identical to M8.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma } from './database';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../middleware/errorHandler';
import { authService } from './auth';
// M9 — Replaces the inline nodemailer call that was here in M4-M8
import { EmailService } from './email';

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

// ─── Service ─────────────────────────────────────────────────────────────────

export class InviteService {
  // POST /families/me/invite
  async sendInvite(input: SendInviteInput): Promise<{ acceptUrl: string; emailSent: boolean }> {
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
    // FRONTEND_URL takes priority — set this to your ngrok URL when testing remotely:
    //   FRONTEND_URL=https://xxxx-xx-xx-xx-xx.ngrok-free.app
    // Falls back to CLIENT_URL (comma-separated list), then localhost.
    const frontendUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL?.split(',')[0] ||
      'http://localhost:3000'
    ).replace(/\/$/, ''); // strip trailing slash
    const acceptUrl = `${frontendUrl}/invite/accept?token=${token}`;
    const familyName = caller.family!.familyName;
    const inviterName = `${caller.firstName} ${caller.lastName}`;
    const expiresDays = Math.round(INVITE_EXPIRES_HOURS / 24);

    // M9 — Send via EmailService (replaces inline nodemailer from M4-M8).
    // Fire-and-forget so SMTP issues never block the API response.
    // EmailService logs the attempt to email_logs regardless of outcome.
    // skipPreferenceCheck=true because the invitee has no family prefs record yet.
    let emailSent = false;
    try {
      await EmailService.send({
        triggerType: 'co_parent_invite',
        toEmail: email,
        toUserId: null,          // invitee has no user record yet
        familyId,
        subject: `${inviterName} invited you to join ${familyName} on TaskBuddy`,
        templateData: {
          inviterName,
          familyName,
          acceptUrl,
          expiresDays,
        },
        referenceType: 'family_invitation',
        referenceId: token,
        // Skip the notificationPreferences check for invite emails —
        // the invitee is not yet a family member so they have no prefs record.
        skipPreferenceCheck: true,
      });
      emailSent = true;
    } catch (err: any) {
      // Log the real error so it's visible in the backend console
      // (EmailService already wrote the failure to email_logs)
      console.error('[InviteService] Failed to send invite email:');
      console.error('  Code:', err?.code);
      console.error('  Message:', err?.message);
      console.error('  Response:', err?.response);
      console.warn('[InviteService] Fallback invite link (share manually):');
      console.warn(`  ${acceptUrl}`);
    }

    return { acceptUrl, emailSent };
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

    // 4. Check the email isn't already registered anywhere in the system
    const existingUser = await prisma.user.findFirst({
      where: { email: invitation.email, deletedAt: null },
    });

    if (existingUser) {
      // If they're already in THIS family, it's a clean conflict
      if (existingUser.familyId === invitation.familyId) {
        throw new ConflictError('An account with this email already exists in this family. Try logging in instead.');
      }
      // Email used in another family — also a conflict (emails are globally unique)
      throw new ConflictError('An account with this email already exists. If this is your email, please log in and contact support to be added to this family.');
    }

    // 5. Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 6. Create the co-parent user and mark invitation accepted — both in one transaction
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            familyId: invitation.familyId,
            email: invitation.email,
            passwordHash,
            role: 'parent',
            isPrimaryParent: false,
            firstName,
            lastName,
            ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
            ...(phone ? { phone } : {}),
          },
        });

        await tx.familyInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        return user;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictError(
          'An account with this email address already exists. ' +
          'If this is your email, try logging in instead. ' +
          'Contact the person who invited you if you need help.'
        );
      }
      throw err;
    }

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

  // GET /auth/invite-preview?token=... — public, no auth required
  // Returns just enough info to render the accept page (family name, inviter name, email)
  async getInvitePreview(token: string) {
    const invitation = await prisma.familyInvitation.findUnique({
      where: { token },
      include: {
        family: { select: { familyName: true } },
        invitedBy: { select: { firstName: true, lastName: true } },
      },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found. The link may be invalid or already used.');
    }

    if (invitation.acceptedAt) {
      throw new NotFoundError('This invitation has already been accepted.');
    }

    if (invitation.expiresAt < new Date()) {
      throw new NotFoundError('This invitation link has expired. Please ask to be invited again.');
    }

    return {
      familyName: invitation.family.familyName,
      inviterName: `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  }

  // DELETE /families/me/invitations/:id — cancel a pending invite
  async cancelInvite(familyId: string, callerId: string, invitationId: string): Promise<void> {
    // Verify caller is a parent in this family
    const caller = await prisma.user.findUnique({ where: { id: callerId } });
    if (!caller || caller.familyId !== familyId || caller.role !== 'parent') {
      throw new UnauthorizedError('Not authorized');
    }

    // Find the invitation — must belong to same family and still be pending
    const invitation = await prisma.familyInvitation.findFirst({
      where: {
        id: invitationId,
        familyId,
        acceptedAt: null,
      },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found or already accepted');
    }

    // Hard-delete the invitation record so the token is fully revoked
    await prisma.familyInvitation.delete({ where: { id: invitationId } });
  }
}

export const inviteService = new InviteService();