/**
 * services/SocketService.ts - M10 Phase 5
 *
 * Singleton wrapper around the Socket.io Server instance.
 * All backend route handlers import from here to emit typed events.
 *
 * Room conventions (joined automatically in the connection handler):
 *   family:{familyId}  - receives events relevant to the whole family
 *   user:{userId}      - receives events targeted at one specific user
 *
 * Fire-and-forget: every emit is synchronous (socket.io handles delivery);
 * routes do NOT await these calls.
 *
 * Event catalogue:
 *   task:approved        → family room + user:{childId} room
 *   task:rejected        → user:{childId} room
 *   points:updated       → user:{childId} room
 *   level:up             → user:{childId} room
 *   achievement:unlocked → user:{childId} room
 *   overlap:warning      → user:{childId} room
 *   notification:new     → user:{userId}  room  (targeted bell push)
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { TokenPayload } from '../middleware/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskApprovedPayload {
  assignmentId: string;
  taskTitle: string;
  childId: string;
  pointsAwarded: number;
  xpAwarded: number;
  newBalance: number;
}

export interface TaskRejectedPayload {
  assignmentId: string;
  taskTitle: string;
  childId: string;
  rejectionReason: string | null;
}

export interface PointsUpdatedPayload {
  childId: string;
  newBalance: number;
  delta: number;
  reason: 'task_approved' | 'reward_redeemed' | 'bonus' | 'penalty';
}

export interface LevelUpPayload {
  childId: string;
  newLevel: number;
  bonusPoints: number;
}

export interface AchievementUnlockedPayload {
  childId: string;
  achievementId: string;
  achievementName: string;
}

export interface OverlapWarningPayload {
  childId: string;
  overlappingTasks: Array<{ id: string; title: string }>;
}

export interface NotificationNewPayload {
  notificationType: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
}

export interface TaskSubmittedPayload {
  assignmentId: string;
  taskTitle: string;
  childId: string;
}

export interface StreakMilestonePayload {
  childId: string;
  streakCount: number;
  bonusPoints: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let io: SocketIOServer | null = null;

/**
 * initSocketService(ioInstance)
 *
 * Call once from index.ts after the Socket.io server is created.
 * Sets up the connection handler that joins users to their rooms.
 */
export function initSocketService(ioInstance: SocketIOServer): void {
  io = ioInstance;

  // Verify JWT on every socket connection - reject unauthenticated clients
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, config.jwt.secret) as TokenPayload;
      (socket as any).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as TokenPayload;
    const { userId, familyId } = user;

    // Join rooms so targeted emits work
    socket.join(`family:${familyId}`);
    socket.join(`user:${userId}`);

    if (config.env !== 'production') {
      console.debug(`[SocketService] Client connected: socket=${socket.id}`);
    }

    socket.on('disconnect', (reason) => {
      if (config.env !== 'production') {
        console.debug(`[SocketService] Client disconnected: socket=${socket.id} reason=${reason}`);
      }
    });
  });

  console.log('[SocketService] Initialized and listening for connections');
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

/** Guard: returns false and logs a warning if the socket server isn't ready yet */
function ready(label: string): boolean {
  if (!io) {
    console.warn(`[SocketService] ${label}: io not initialized, skipping emit`);
    return false;
  }
  return true;
}

/**
 * emitTaskApproved
 * Emitted to the family room (so parents see it) AND to the child's user room.
 */
export function emitTaskApproved(familyId: string, payload: TaskApprovedPayload): void {
  if (!ready('emitTaskApproved')) return;
  // Family room: parents' dashboards can update the pending-approval count
  io!.to(`family:${familyId}`).emit('task:approved', payload);
}

/**
 * emitTaskRejected
 * Emitted only to the child's user room - parents initiated the action.
 */
export function emitTaskRejected(familyId: string, payload: TaskRejectedPayload): void {
  if (!ready('emitTaskRejected')) return;
  io!.to(`user:${payload.childId}`).emit('task:rejected', payload);
}

/**
 * emitPointsUpdated
 * Sent to the child's user room so their header balance updates without a refresh.
 */
export function emitPointsUpdated(familyId: string, payload: PointsUpdatedPayload): void {
  if (!ready('emitPointsUpdated')) return;
  io!.to(`user:${payload.childId}`).emit('points:updated', payload);
}

/**
 * emitLevelUp
 * Sent to the child's user room - triggers the level-up celebration UI.
 */
export function emitLevelUp(familyId: string, payload: LevelUpPayload): void {
  if (!ready('emitLevelUp')) return;
  io!.to(`user:${payload.childId}`).emit('level:up', payload);
}

/**
 * emitAchievementUnlocked
 * Sent to the child's user room - triggers achievement toast/animation.
 */
export function emitAchievementUnlocked(
  familyId: string,
  payload: AchievementUnlockedPayload
): void {
  if (!ready('emitAchievementUnlocked')) return;
  io!.to(`user:${payload.childId}`).emit('achievement:unlocked', payload);
}

/**
 * emitOverlapWarning
 * Sent to the child's user room when a new task overlaps their schedule.
 */
export function emitOverlapWarning(familyId: string, payload: OverlapWarningPayload): void {
  if (!ready('emitOverlapWarning')) return;
  io!.to(`user:${payload.childId}`).emit('overlap:warning', payload);
}

/**
 * emitNotificationNew
 * Targeted push to a specific user room - used for instant bell updates
 * (e.g. reward fulfilled, custom admin message).
 */
export function emitNotificationNew(userId: string, payload: NotificationNewPayload): void {
  if (!ready('emitNotificationNew')) return;
  io!.to(`user:${userId}`).emit('notification:new', payload);
}

/**
 * emitTaskSubmitted
 * Emitted to the family room when a child submits a task for approval.
 * Parents' dashboards use this to increment the pending-approval badge in real-time.
 */
export function emitTaskSubmitted(familyId: string, payload: TaskSubmittedPayload): void {
  if (!ready('emitTaskSubmitted')) return;
  io!.to(`family:${familyId}`).emit('task:submitted', payload);
}

/**
 * emitStreakMilestone
 * Emitted to the child's user room when their streak hits a milestone (7/14/30/60/100 days).
 * Triggers the StreakMilestoneToast on the child dashboard.
 */
export function emitStreakMilestone(childId: string, payload: StreakMilestonePayload): void {
  if (!ready('emitStreakMilestone')) return;
  io!.to(`user:${childId}`).emit('streak:milestone', payload);
}

// ─── Re-export as namespace for convenient import ─────────────────────────────

export const SocketService = {
  emitTaskApproved,
  emitTaskRejected,
  emitTaskSubmitted,
  emitPointsUpdated,
  emitLevelUp,
  emitAchievementUnlocked,
  emitOverlapWarning,
  emitNotificationNew,
  emitStreakMilestone,
};
