'use client';

/**
 * app/child/tasks/[id]/page.tsx: the task detail page a child never had on the web.
 *
 * The list at `/child/tasks` shows a title, a status word and a button. That is enough to act on a
 * task and not enough to understand one: a returned task shows the parent's reason only in a small
 * callout on one tab, a finished task shows no history at all, and a pool task the child has not
 * claimed shows nothing but its points. This page is the read-first surface, mirroring
 * `mobile/app/(child)/task-detail.tsx` so the two apps say the same things in the same order.
 *
 * ## The id in the URL is an ASSIGNMENT id, falling back to a TASK id
 *
 * Four things a child can open, and they are not all the same kind of row:
 *   - a task assigned to them (pending / in_progress)   → an assignment
 *   - one they finished themselves (completed/approved) → an assignment
 *   - one sent back (rejected)                          → an assignment
 *   - an open task nobody has claimed                   → a TASK, with no assignment yet
 *
 * So the segment is resolved as an assignment first and as a claimable pool task second. Both come
 * from the two endpoints the list page already calls, which keeps one description of "what this
 * child may see" rather than two.
 *
 * ## Why it does not fetch the assignment directly
 *
 * `GET /tasks/assignments/:id` is `requireParent`. Widening it so a child could read one row would
 * put a child-reachable path onto a parent-scoped endpoint for a convenience, so this pages forward
 * through `GET /tasks/assignments/me` instead, the same choice (and the same reasoning) as the
 * mobile screen. A child a year in has more than one page of history and an assignment from last
 * month is not on page one, so "not on the first page" must never render as "not found".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Confetti from 'react-confetti';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Gift,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Star,
  Trophy,
} from 'lucide-react';

import { ChildLayout } from '@/components/layouts/ChildLayout';
import { TaskCommentThread } from '@/components/tasks/TaskCommentThread';
import { PhotoUploadModal } from '@/components/tasks/PhotoUploadModal';
import { TeamBadge, type TeamSummary } from '@/components/tasks/TeamBadge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { tasksApi } from '@/lib/api';
import { cn, formatDateTime, getDifficultyColor } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * `Stamp` rather than `string`, everywhere a date appears.
 *
 * `@taskbuddy/shared` annotates these as `Date` because they are `Date` in Prisma, but they cross
 * the wire as JSON and arrive as strings. The drift is long-standing and not this page's to fix.
 * `formatDateTime` accepts either, so widening here is honest about what can actually turn up
 * instead of asserting one of the two away.
 */
type Stamp = string | Date;

interface Evidence {
  id: string;
  evidenceType?: string;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  note?: string | null;
}

interface TaskShape {
  id: string;
  title: string;
  description?: string | null;
  difficulty: string;
  pointsValue: number;
  requiresPhotoEvidence: boolean;
  taskTag: 'primary' | 'secondary';
  status: string;
  dueDate?: Stamp | null;
  category?: string | null;
  estimatedMinutes?: number | null;
  isRecurring?: boolean;
}

interface ChildAssignment {
  id: string;
  childId?: string;
  status: string;
  rejectionReason?: string | null;
  instanceDate?: Stamp | null;
  completedAt?: Stamp | null;
  approvedAt?: Stamp | null;
  pointsAwarded?: number | null;
  evidence?: Evidence[];
  team?: TeamSummary | null;
  task: TaskShape;
}

interface PoolTask extends TaskShape {
  canSelfAssign?: boolean;
  claimsRemaining?: number | null;
}

/** What the URL segment resolved to, or that it resolved to nothing. */
type Subject =
  | { kind: 'assignment'; assignment: ChildAssignment }
  | { kind: 'pool'; task: PoolTask }
  | { kind: 'missing' };

/**
 * How many pages of history to walk before giving up.
 *
 * At the endpoint's maximum page size this is 10,000 assignments, which is years of daily chores.
 * A bound rather than an open `while` because a paging bug on the server side would otherwise turn
 * this page into an infinite request loop against a rate-limited API.
 */
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

/** What the child is told the task is currently doing. Words, never colour alone. */
const STATUS_LINE: Record<string, string> = {
  pending: 'Not started yet.',
  in_progress: 'Started. Finish it when you are ready.',
  completed: 'Done, waiting for a grown-up to check it.',
  approved: 'Approved. Nice work.',
  rejected: 'Sent back, have another go.',
  expired: 'This one ran out of time.',
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChildTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [hasPendingPrimaries, setHasPendingPrimaries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Resolve the id ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!id) return;
    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const res = await tasksApi.getMyAssignments({ page, limit: PAGE_SIZE });
        const data = res.data as {
          assignments: ChildAssignment[];
          pagination?: { hasMore?: boolean };
        };
        const match = data.assignments.find((a) => a.id === id);
        if (match) {
          // An archived task is one a parent has withdrawn. The list hides those rows, and letting
          // this page offer Start on one would produce a 409 the child cannot act on.
          setSubject(match.task.status === 'archived' ? { kind: 'missing' } : { kind: 'assignment', assignment: match });
          return;
        }
        if (!data.pagination?.hasMore) break;
      }

      // Not one of theirs. It may be an unclaimed task from the pool, addressed by task id.
      const tasksRes = await tasksApi.getAll();
      const tasksData = tasksRes.data as { tasks: PoolTask[]; hasPendingPrimaries?: boolean };
      setHasPendingPrimaries(tasksData.hasPendingPrimaries ?? false);
      const pooled = tasksData.tasks.find((t) => t.id === id && t.status !== 'archived');
      setSubject(pooled ? { kind: 'pool', task: pooled } : { kind: 'missing' });
    } catch {
      showError('Failed to load task');
      setSubject({ kind: 'missing' });
    }
  }, [id, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Runs an action and reloads. Deliberately reloads rather than patching state from the response:
   * approving, returning and expiring all happen elsewhere, so the server is the only thing that
   * knows what this row looks like afterwards.
   */
  const run = useCallback(
    async (action: () => Promise<unknown>, done: string) => {
      setBusy(true);
      try {
        await action();
        showSuccess(done);
        await load();
        return true;
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Something went wrong');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, showError, showSuccess]
  );

  const assignment = subject?.kind === 'assignment' ? subject.assignment : null;

  const handleComplete = async () => {
    if (!assignment) return;
    // Photo-required tasks go through the modal, which uploads first and completes with the URL.
    if (assignment.task.requiresPhotoEvidence) {
      setPhotoOpen(true);
      return;
    }
    const ok = await run(
      () => tasksApi.completeAssignment(assignment.id),
      assignment.status === 'rejected' ? 'Task resubmitted!' : 'Task submitted for approval! 🎉'
    );
    if (ok) celebrate();
  };

  const handlePhotoSubmit = async (file: File) => {
    if (!assignment) return;
    setUploading(true);
    try {
      const evidenceRes = await tasksApi.uploadEvidence(assignment.id, file);
      const evidence = (evidenceRes as { data?: { evidence?: { fileUrl?: string } } }).data?.evidence;
      // Upload first, complete second, and never complete if the upload threw: a photo-required
      // task that reads as finished with no photo is worse for a parent than one not submitted.
      await tasksApi.completeAssignment(assignment.id, evidence?.fileUrl);
      showSuccess('Task submitted with photo! 🎉');
      setPhotoOpen(false);
      celebrate();
      await load();
    } catch {
      showError('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const celebrate = () => {
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3000);
  };

  // ── Loading / not found ───────────────────────────────────────────────────

  if (subject === null) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  if (subject.kind === 'missing') {
    return (
      <ChildLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <BackLink />
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <h1 className="font-bold text-slate-900 mb-2">We couldn&apos;t find that task</h1>
            <p className="text-slate-500 text-sm">A grown-up may have removed it.</p>
          </div>
        </div>
      </ChildLayout>
    );
  }

  // ── Pool task (not claimed yet) ───────────────────────────────────────────

  if (subject.kind === 'pool') {
    const task = subject.task;
    const locked = hasPendingPrimaries && task.canSelfAssign === false;
    return (
      <ChildLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <BackLink />
          <Header task={task} badge={{ label: 'Up for grabs', className: 'text-gold-600 bg-gold-50' }} />
          <div className="bg-white rounded-2xl p-5 border border-gold-200 shadow-sm space-y-3">
            <p className="text-sm text-slate-600 flex items-center gap-2">
              <Gift className="w-4 h-4 text-gold-500" />
              Nobody has taken this one yet.
              {task.claimsRemaining != null && (
                <span className="text-slate-400">
                  {task.claimsRemaining} spot{task.claimsRemaining !== 1 ? 's' : ''} left
                </span>
              )}
            </p>
            {locked && (
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <Lock className="w-4 h-4" /> Finish your current primary task first.
              </p>
            )}
            <Button
              fullWidth
              disabled={busy || locked}
              onClick={() =>
                run(() => tasksApi.selfAssign(task.id), 'Added to your tasks!').then((ok) => {
                  // Once claimed it is an assignment, and the id in the URL is the task's. Send the
                  // child back to the list rather than leaving them on a page that no longer
                  // describes what they are looking at.
                  if (ok) router.push('/child/tasks');
                })
              }
              className="bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-40"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add to my tasks
              </span>
            </Button>
          </div>
        </div>
      </ChildLayout>
    );
  }

  // ── An assignment of their own ────────────────────────────────────────────

  const a = subject.assignment;
  const { task, status } = a;
  const isFinished = ['completed', 'approved'].includes(status);
  const isReturned = status === 'rejected';
  const isExpired = status === 'expired';
  const photos = (a.evidence ?? []).filter((e) => e.fileUrl || e.thumbnailUrl);
  const notes = (a.evidence ?? []).filter((e) => e.note);

  return (
    <ChildLayout>
      {showConfetti && <Confetti recycle={false} numberOfPieces={200} />}

      {photoOpen && (
        <PhotoUploadModal
          title={task.title}
          onClose={() => setPhotoOpen(false)}
          onSubmit={handlePhotoSubmit}
          uploading={uploading}
          fileInputRef={fileInputRef}
        />
      )}

      <div className="max-w-2xl mx-auto space-y-4">
        <BackLink />

        <Header
          task={task}
          badge={
            isReturned
              ? { label: 'Returned', className: 'text-amber-700 bg-amber-50' }
              : status === 'approved'
              ? { label: 'Approved', className: 'text-success-700 bg-success-50' }
              : status === 'completed'
              ? { label: 'Awaiting approval', className: 'text-warning-700 bg-warning-50' }
              : task.taskTag === 'primary'
              ? { label: 'Primary', className: 'text-xp-600 bg-xp-50' }
              : { label: 'Bonus', className: 'text-gold-600 bg-gold-50' }
          }
          statusLine={STATUS_LINE[status] ?? status}
        />

        {/*
          The single most important thing on a returned task, and the list has only ever shown it in
          passing. First on the page, before the task's own details: the child is here to find out
          what to change.
        */}
        {isReturned && a.rejectionReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <p className="font-semibold text-xs uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> What to fix
            </p>
            <p className="text-sm text-amber-800">{a.rejectionReason}</p>
          </div>
        )}

        {a.team && (
          <div className="bg-white rounded-2xl p-4 border border-slate-200">
            <TeamBadge team={a.team} meId={a.childId} />
          </div>
        )}

        {/* Facts, in one place. The list has room for none of these. */}
        <dl className="bg-white rounded-2xl p-5 border border-slate-200 grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
          <Fact label="Worth" value={`${task.pointsValue} points`} />
          {task.dueDate && <Fact label="Due" value={formatDateTime(task.dueDate)} />}
          {a.instanceDate && <Fact label="For" value={formatDateTime(a.instanceDate)} />}
          {task.estimatedMinutes != null && <Fact label="Should take" value={`${task.estimatedMinutes} min`} />}
          {task.category && <Fact label="Kind" value={task.category} />}
          {a.completedAt && <Fact label="You finished" value={formatDateTime(a.completedAt)} />}
          {a.approvedAt && <Fact label="Approved" value={formatDateTime(a.approvedAt)} />}
          {status === 'approved' && a.pointsAwarded != null && (
            <Fact label="You earned" value={`${a.pointsAwarded} points`} />
          )}
        </dl>

        {photos.length > 0 && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200">
            <p className="font-semibold text-xs uppercase tracking-wide text-slate-500 mb-2">Your photo</p>
            <div className="flex flex-wrap gap-3">
              {photos.map((e) => (
                <a
                  key={e.id}
                  // Opens the FULL image, not the thumbnail already on screen. Both URLs are
                  // presigned server-side and short-lived (private R2 bucket), used exactly as
                  // received, never rebuilt from an object key.
                  href={(e.fileUrl || e.thumbnailUrl) as string}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={(e.thumbnailUrl || e.fileUrl) as string}
                    alt="The photo you sent"
                    className="w-24 h-24 object-cover rounded-xl border border-slate-200"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {notes.length > 0 && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200">
            <p className="font-semibold text-xs uppercase tracking-wide text-slate-500 mb-2">Your note</p>
            {notes.map((e) => (
              <p key={e.id} className="text-sm text-slate-700 italic">&ldquo;{e.note}&rdquo;</p>
            ))}
          </div>
        )}

        {/* Actions only where there is one to take. A finished task is a thing to read. */}
        {status === 'completed' && (
          <p className="flex items-center gap-2 text-warning-700 text-sm font-medium bg-warning-50 border border-warning-200 rounded-2xl px-4 py-3">
            <Clock className="w-4 h-4" /> Waiting for a grown-up to check it.
          </p>
        )}

        {status === 'approved' && (
          <p className="flex items-center gap-2 text-success-700 text-sm font-medium bg-success-50 border border-success-200 rounded-2xl px-4 py-3">
            <Trophy className="w-4 h-4" /> All done. Nice work.
          </p>
        )}

        {isExpired && (
          <p className="flex items-center gap-2 text-slate-600 text-sm bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
            <Clock className="w-4 h-4" /> This one ran out of time.
          </p>
        )}

        {!isFinished && !isExpired && (
          <div className="space-y-3">
            {status === 'pending' && (
              <Button
                fullWidth
                disabled={busy}
                onClick={() => run(() => tasksApi.startAssignment(a.id), 'Task started!')}
                className="bg-xp-600 hover:bg-xp-700 text-white"
              >
                <span className="flex items-center gap-2">
                  <Play className="w-4 h-4" /> Start Task
                </span>
              </Button>
            )}
            <Button
              fullWidth
              disabled={busy}
              onClick={handleComplete}
              className={cn(
                'text-white',
                isReturned ? 'bg-amber-500 hover:bg-amber-600' : 'bg-success-600 hover:bg-success-700'
              )}
            >
              <span className="flex items-center gap-2">
                {task.requiresPhotoEvidence ? <Camera className="w-4 h-4" /> : isReturned ? <RotateCcw className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {isReturned
                  ? task.requiresPhotoEvidence ? 'Resubmit with Photo' : 'Resubmit Task'
                  : task.requiresPhotoEvidence ? 'Submit with Photo' : 'Mark Complete'}
              </span>
            </Button>
          </div>
        )}

        {/* FR-11: the same thread as the list card, so a comment read here is read there too. */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200">
          <TaskCommentThread assignmentId={a.id} />
        </div>
      </div>
    </ChildLayout>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/child/tasks"
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft className="w-4 h-4" /> Back to my tasks
    </Link>
  );
}

function Header({
  task,
  badge,
  statusLine,
}: {
  task: TaskShape;
  badge: { label: string; className: string };
  statusLine?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', badge.className)}>
              {badge.label}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', getDifficultyColor(task.difficulty.toUpperCase()))}>
              {task.difficulty}
            </span>
            {task.requiresPhotoEvidence && (
              <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Camera className="w-3 h-3" /> Photo needed
              </span>
            )}
            {task.isRecurring && (
              <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Repeats
              </span>
            )}
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">{task.title}</h1>
          {task.description && <p className="text-sm text-slate-600 mt-2">{task.description}</p>}
          {statusLine && <p className="text-sm text-slate-500 mt-2">{statusLine}</p>}
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold shrink-0">
          <Star className="w-4 h-4" />
          <span>{task.pointsValue}</span>
        </div>
      </div>
    </motion.div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
