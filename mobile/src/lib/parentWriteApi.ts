/**
 * Parent create/update/delete for tasks, rewards and children.
 *
 * Every endpoint here already existed and is gated by `requireParent` on the server — none of this
 * needed backend work. The app simply had no way to reach them, which is why a parent could read
 * their family on a phone but not change anything.
 *
 * ## The input shapes are the server's Zod schemas, restated
 *
 * Deliberately restated rather than inferred from `shared`, because the *create* bodies are not the
 * models: `difficulty` is derived server-side from `pointsValue` and must not be sent, `dueDate` is
 * an ISO string rather than a Date, and several fields exist only on the way in. A screen typed
 * against the model would compile and then be rejected at runtime.
 *
 * The validation rules that bite are noted on each field. They are the server's, and the forms
 * pre-check the cheap ones so a parent gets an inline message instead of a round trip.
 */
import type { Reward, Task, TaskAssignment, TaskComment, TaskEvidence, User } from '@taskbuddy/shared';

import { api } from './api';
import { APPROVALS_KEY } from './approvalsApi';
import { PARENT_DASHBOARD_KEY } from './dashboardApi';
import { REWARDS_KEY } from './rewardsApi';
import { TASKS_KEY } from './tasksApi';

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface TaskInput {
  /** 3–200 characters. */
  title: string;
  description?: string;
  category?: string;
  /** 5–1000. Difficulty is derived from this server-side — never send `difficulty`. */
  pointsValue: number;
  /** ISO 8601, and the server rejects anything not in the future. */
  dueDate: string;
  /** `primary` counts against the daily cap; `secondary` is bonus work. Defaults to primary. */
  taskTag?: 'primary' | 'secondary';
  requiresPhotoEvidence?: boolean;
  estimatedMinutes?: number;
  /** Child ids. An empty array creates an unassigned pool task, which is legitimate. */
  assignedTo?: string[];
  isRecurring?: boolean;
  recurrencePattern?: string;
  /**
   * ISO 8601. Optional, and only used for overlap detection (M5 CR-09) — a task without one is
   * scheduled for "some time on the due date" and cannot clash with anything.
   */
  startTime?: string;
  /**
   * How many different children may claim this from the pool. `null` is unlimited, which is NOT the
   * same as omitting it; the server distinguishes them.
   */
  maxClaimsTotal?: number | null;
  /**
   * U17 team-up. The server refuses a team task with fewer than two children assigned, and refuses
   * one with a zero bonus — a team task with no bonus is just a shared task with extra words on the
   * form. Both are surfaced client-side so a parent finds out before submitting.
   */
  isTeamTask?: boolean;
  /** ON TOP of each member's full base points, never a split. 0–500. */
  teamBonusPoints?: number;
}

/**
 * A single task, as `GET /tasks/:id` actually returns it.
 *
 * Widened from the original `{ id, childId, status }` assignment shape — that was enough for the edit
 * form (which only needs `childId` to prefill the picker), but the same query now backs the read-only
 * detail screen, which needs the full assignment: who has it, evidence (photos/notes, presigned by
 * `withEvidenceUrlsList()` server-side — never re-derive a URL client-side), and the child's display
 * name. A wider type is a safe superset for the form's narrower usage.
 */
export type TaskDetail = Task & {
  creator: { id: string; firstName: string; lastName: string };
  assignments: (TaskAssignment & {
    child: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
    evidence: TaskEvidence[];
  })[];
};

/**
 * Fetch one task.
 *
 * Deliberately a real request rather than digging the row out of the paginated list cache. The list
 * is an infinite query keyed by its filters, so a cache read would only work when the form happened
 * to be opened from a list loaded under exactly matching filters — correct by accident, and silently
 * empty the rest of the time.
 */
export function fetchTask(id: string, signal?: AbortSignal): Promise<{ task: TaskDetail }> {
  return api.get<{ task: TaskDetail }>(`/tasks/${id}`, { signal });
}

export function taskDetailQuery(id: string) {
  return {
    queryKey: ['tasks', 'detail', id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTask(id, signal),
  };
}

export function createTask(input: TaskInput): Promise<{ task: Task }> {
  return api.post<{ task: Task }>('/tasks', input);
}

export function updateTask(id: string, input: Partial<TaskInput>): Promise<{ task: Task }> {
  return api.put<{ task: Task }>(`/tasks/${id}`, input);
}

/**
 * Archive and restore, which is what the web has always done and mobile did not.
 *
 * ⚠️ `DELETE /tasks/:id` still exists and is deliberately NOT called from anywhere in this app.
 * It is a soft delete: it stamps `deletedAt`, and every list query filters on `deletedAt: null`, so
 * the task disappears from both apps with no route back short of a database edit. The web parent
 * page has only ever offered archive (`status: 'archived'`, restorable from its own list), and a
 * mobile button labelled "Delete" that quietly did something stronger and irreversible was the whole
 * defect this replaces.
 *
 * Both go through the same `PUT /tasks/:id` the edit form uses, so there is no new endpoint and no
 * new permission surface.
 */
export function archiveTask(id: string): Promise<{ task: Task }> {
  return api.put<{ task: Task }>(`/tasks/${id}`, { status: 'archived' });
}

export function restoreTask(id: string): Promise<{ task: Task }> {
  return api.put<{ task: Task }>(`/tasks/${id}`, { status: 'active' });
}

/**
 * Put a completed/approved/rejected assignment back to `pending`, clearing its completion, approval
 * and any points/xp already awarded. The server only allows this from those three statuses — a
 * `pending`/`in_progress` one is a 409, which the caller surfaces rather than swallows.
 */
export function resetAssignment(assignmentId: string): Promise<{ assignment: TaskAssignment }> {
  return api.put<{ assignment: TaskAssignment }>(`/tasks/assignments/${assignmentId}/reset`);
}

/**
 * Every query key a reset can invalidate.
 *
 * Wider than just the task detail: a reset can pull a `completed` assignment back out of the
 * approvals queue (nothing left to approve) and always changes what the list/dashboard show for that
 * task, so all three go stale the same way an approve/reject does (see `INVALIDATED_BY_APPROVAL`).
 */
export const INVALIDATED_BY_RESET = [APPROVALS_KEY, ['dashboard', 'parent'], ['tasks']] as const;

// ── Rewards ──────────────────────────────────────────────────────────────────

export interface RewardInput {
  /** 2–100 characters. */
  name: string;
  description?: string;
  /** 1–100000. */
  pointsCost: number;
  tier?: 'small' | 'medium' | 'large';
  /** Must be a valid absolute URL — the server validates with `z.string().url()`. */
  iconUrl?: string;
  maxRedemptionsPerChild?: number;
  maxRedemptionsTotal?: number;
  /** ISO 8601 in the future, or null to clear. */
  expiresAt?: string | null;
  isCollaborative?: boolean;
}

export function createReward(input: RewardInput): Promise<{ reward: Reward }> {
  return api.post<{ reward: Reward }>('/rewards', input);
}

export function updateReward(
  id: string,
  input: Partial<RewardInput> & { isActive?: boolean }
): Promise<{ reward: Reward }> {
  return api.put<{ reward: Reward }>(`/rewards/${id}`, input);
}

export function deleteReward(id: string): Promise<unknown> {
  return api.delete(`/rewards/${id}`);
}

// ── Children ─────────────────────────────────────────────────────────────────

export interface ChildInput {
  firstName: string;
  lastName: string;
  /**
   * The server enforces **10–16 years old** and rejects anything outside it. That is a product rule
   * tied to the Families policy, not a typo guard, so the form states it rather than letting a
   * parent discover it on submit.
   */
  dateOfBirth: string;
  /**
   * 3–20 characters, `[a-zA-Z0-9_]` only, and **unique within the family**. This is what the child
   * types to sign in — two siblings called Sam need different handles, which is the whole reason the
   * field exists separately from `firstName`.
   */
  username: string;
  /** Exactly four digits. Optional on update; omit to leave the existing PIN alone. */
  pin?: string;
  email?: string;
  gender?: 'boy' | 'girl';
}

/**
 * Add a child.
 *
 * ⚠️ Can fail with **`CONSENT_REQUIRED`** rather than a generic 403. COPPA verifiable parental
 * consent gates all child-data collection, and the code exists so the UI can route to the consent
 * flow instead of showing "forbidden" to a parent who has done nothing wrong.
 */
/**
 * Create a child.
 *
 * `consentFormAccepted` is required and must be literally `true`: the server validates it with
 * `z.literal(true)`, so a missing or false value is a 400 and no child is created. It is passed
 * explicitly by the caller rather than defaulted here — a default would mean this module asserting
 * consent on the parent's behalf, which is the one thing the field exists to prevent.
 */
export function addChild(input: ChildInput & { consentFormAccepted: true }): Promise<{ child: User }> {
  return api.post<{ child: User }>('/families/me/children', input);
}

export function updateChild(id: string, input: Partial<ChildInput>): Promise<{ child: User }> {
  return api.put<{ child: User }>(`/families/me/children/${id}`, input);
}

/** Set or replace a child's avatar. Pass the URL returned by `uploadImage`. */
export function setChildAvatar(id: string, avatarUrl: string): Promise<{ child: User }> {
  return api.put<{ child: User }>(`/families/me/children/${id}`, { avatarUrl });
}

// ── Comments (FR-11) ─────────────────────────────────────────────────────────
//
// One thread per assignment, visible to any parent in the family and to the child who owns it. No
// socket wiring here the way the web has (`useSocket`) — mobile has no socket client at all, so the
// detail screen re-fetches after posting instead of listening for a live event. That means a
// co-parent's comment typed at the same moment will not appear until the next visit, which is a real
// gap against the web, not an oversight.

/** Server caps a comment at 1000 characters; the client trims before sending. */
export function fetchComments(
  assignmentId: string,
  signal?: AbortSignal
): Promise<{ comments: TaskComment[] }> {
  return api.get<{ comments: TaskComment[] }>(`/tasks/assignments/${assignmentId}/comments`, {
    signal,
  });
}

export function postComment(
  assignmentId: string,
  content: string
): Promise<{ comment: TaskComment }> {
  return api.post<{ comment: TaskComment }>(`/tasks/assignments/${assignmentId}/comments`, {
    content,
  });
}

// ── Invalidation ─────────────────────────────────────────────────────────────

/**
 * Creating or editing anything moves the dashboard as well as its own list — task counts, the
 * children summary and the week's totals all live there. Listed once so no screen has to remember.
 */
export const INVALIDATED_BY_PARENT_WRITE = [
  [TASKS_KEY],
  REWARDS_KEY,
  PARENT_DASHBOARD_KEY,
  ['children'],
] as const;

/**
 * True when the server refused because parental consent is outstanding.
 *
 * Checked by code rather than by message: the text is user-facing and may be reworded, but
 * `CONSENT_REQUIRED` is the contract.
 */
export function isConsentRequired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'CONSENT_REQUIRED'
  );
}
