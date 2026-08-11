'use client';
import { useDataRefresh } from '@/hooks/useDataRefresh';

/**
 * app/child/tasks/page.tsx - updated (Bug fix: rejected task resubmission)
 *
 * Changes from previous version:
 *  - Added "Returned" tab that shows rejected assignments
 *  - Rejected assignments now surface with a "Resubmit" button so the child
 *    can mark them complete again (calls PUT /assignments/:id/complete)
 *  - Rejection reason shown in a amber callout on each returned task card
 *
 * All other behaviour (primary/secondary split, photo evidence, confetti,
 * self-assign, available pool) unchanged.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TaskCommentThread } from '@/components/tasks/TaskCommentThread';
import {
  CheckCircle2,
  Clock,
  Star,
  Zap,
  Camera,
  Trophy,
  Upload,
  X,
  Image as ImageIcon,
  Lock,
  Gift,
  Plus,
  RotateCcw,
  AlertCircle,
  Play,
  Calendar,
  CloudOff,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { tasksApi } from '@/lib/api';
import {
  enqueue as enqueueOffline,
  isOnline,
  pendingIds as offlinePendingIds,
  startAutoFlush,
  type OfflineAction,
  type FlushReport,
} from '@/lib/offlineQueue';
import { useToast } from '@/components/ui/Toast';
import { useSocket } from '@/contexts/SocketContext';
import { cn, getDifficultyColor, formatPoints, formatDate, formatDateTime } from '@/lib/utils';
import Confetti from 'react-confetti';
import { TeamBadge, type TeamSummary } from '@/components/tasks/TeamBadge';

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskAssignment {
  id: string;
  /** U17: on this page every assignment belongs to the signed-in child, so this IS "me". */
  childId?: string;
  status: string;
  rejectionReason?: string | null;
  canSelfAssign?: boolean;
  claimsRemaining?: number | null;
  // U17 — present only on team-up tasks; the server derives it from the same helper the payout uses.
  team?: TeamSummary | null;
  task: {
    id: string;
    title: string;
    description?: string;
    difficulty: string;
    pointsValue: number;
    requiresPhotoEvidence: boolean;
    taskTag: 'primary' | 'secondary';
    status: string;
    dueDate?: string;
  };
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = 'active' | 'completed' | 'returned';

/** Which tab an assignment is filed under. Kept beside the tab type so the two cannot drift. */
function tabForStatus(status: string): Tab {
  if (status === 'rejected') return 'returned';
  if (['completed', 'approved'].includes(status)) return 'completed';
  return 'active';
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChildTasksPage() {
  const { socket } = useSocket();
  const { error: showError, success: showSuccess } = useToast();
  const [assignments, setAssignments]           = useState<TaskAssignment[]>([]);
  const [availableTasks, setAvailableTasks]     = useState<any[]>([]);
  const [isLoading, setIsLoading]               = useState(true);
  const [activeTab, setActiveTab]               = useState<Tab>('active');
  const [startingId, setStartingId]             = useState<string | null>(null);
  const [completingId, setCompletingId]         = useState<string | null>(null);
  const [resubmittingId, setResubmittingId]     = useState<string | null>(null);
  const [selfAssigningId, setSelfAssigningId]   = useState<string | null>(null);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [showConfetti, setShowConfetti]         = useState(false);
  const [photoAssignment, setPhotoAssignment]   = useState<TaskAssignment | null>(null);
  const [hasPendingPrimaries, setHasPendingPrimaries] = useState(false);
  // FR-13 — offline queue. `queuedIds` drives the "Queued" badge; `offline` drives the banner and
  // the photo-evidence fallback. Both are refreshed from the queue itself, never guessed.
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);

  // ── Load tasks ────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const [assignmentsRes, tasksRes] = await Promise.all([
        tasksApi.getMyAssignments(),
        tasksApi.getAll(),
      ]);

      const assignmentsData = assignmentsRes.data as { assignments: TaskAssignment[] };
      // Filter out assignments whose task has been archived - child can't act on them
      const visibleAssignments = assignmentsData.assignments.filter(
        (a) => a.task.status !== 'archived'
      );
      setAssignments(visibleAssignments);

      const tasksData = tasksRes.data as {
        tasks: any[];
        hasPendingPrimaries?: boolean;
      };
      // Pool = tasks the backend says this child can still claim.
      // Deduplicate by id (Prisma OR can produce duplicates).
      const seen = new Set<string>();
      const unassignedPool = tasksData.tasks.filter((t: any) => {
        if (seen.has(t.id)) return false;
        if (t.status === 'archived') return false;
        // Exclude tasks this child has a non-expired assignment for.
        // Expired assignments should not block re-claiming a pool task.
        const myAssignmentIds = new Set(
          visibleAssignments
            .filter((a: any) => a.status !== 'expired')
            .map((a: any) => a.task?.id ?? a.taskId)
        );
        if (myAssignmentIds.has(t.id)) return false;
        seen.add(t.id);
        // Show if claims are still available
        if (t.claimsRemaining !== undefined) return t.claimsRemaining === null || t.claimsRemaining > 0;
        return t.assignments?.length === 0;
      });
      setAvailableTasks(unassignedPool);
      setHasPendingPrimaries(tasksData.hasPendingPrimaries ?? false);
    } catch {
      showError('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);
  useDataRefresh(loadTasks);

  /**
   * Deep link: `/child/tasks?assignment=<id>`.
   *
   * A notification is about ONE assignment — a comment on it, an approval, a return. Landing the
   * child on the bare list makes them hunt for it, and the thing they were told about (the comment
   * thread) lives inside that assignment's own card, on one tab only. So the link carries the id and
   * this page does three things with it: switch to the tab the assignment is actually on, scroll the
   * card into view, and ring it briefly so the eye lands in the right place.
   *
   * Read from `window.location.search` rather than `useSearchParams()` on purpose: the hook forces
   * this page under a Suspense boundary at build time, and a query string that only ever matters
   * after mount does not need to participate in rendering at all.
   */
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('assignment');
    if (id) setFocusedId(id);
  }, []);

  /**
   * Live updates for the two things a PARENT can do to this list.
   *
   * ⚠️ This page subscribed to nothing at all, which is why a returned task did not appear: the
   * notification sends the child here (`actionUrl: '/child/tasks'`), and the list they landed on was
   * whatever had been fetched on mount. The server has always emitted both of these to
   * `user:{childId}`.
   *
   * Both handlers just reload, deliberately. Patching a single row from a socket payload means two
   * descriptions of task state that can disagree; refetching keeps the server as the only authority,
   * and the payload is small.
   */
  useEffect(() => {
    if (!socket) return;

    const reload = () => { void loadTasks(); };

    socket.on('task:rejected', reload);
    socket.on('task:approved', reload);

    return () => {
      socket.off('task:rejected', reload);
      socket.off('task:approved', reload);
    };
  }, [socket, loadTasks]);

  // ── FR-13: offline queue plumbing ─────────────────────────────────────────

  const refreshQueued = useCallback(async () => {
    setQueuedIds(await offlinePendingIds());
  }, []);

  /** Replays one queued action against the API, passing the timestamp captured on the device. */
  const replay = useCallback(
    (action: OfflineAction) =>
      action.type === 'start'
        ? tasksApi.startAssignment(action.assignmentId, action.clientTimestamp)
        : tasksApi.completeAssignment(
            action.assignmentId,
            undefined,
            action.payload?.note as string | undefined,
            action.clientTimestamp
          ),
    []
  );

  const handleFlushReport = useCallback(
    (report: FlushReport) => {
      const synced = report.outcomes.filter((o) => o.result === 'synced').length;
      // 'already-applied' is a 409: the server had it all along. Silent success, never an error.
      const dropped = report.outcomes.filter((o) => o.result === 'dropped');

      if (synced > 0) showSuccess(`Synced ${synced} offline task${synced > 1 ? 's' : ''} ✓`);
      dropped.forEach((o) =>
        showError(`Couldn't sync one task: ${'reason' in o ? o.reason : 'unknown error'}`)
      );

      refreshQueued();
      loadTasks();
    },
    [showSuccess, showError, refreshQueued, loadTasks]
  );

  useEffect(() => {
    refreshQueued();
    setOffline(!isOnline());

    const syncConnection = () => setOffline(!isOnline());
    window.addEventListener('online', syncConnection);
    window.addEventListener('offline', syncConnection);

    // Drains now if we are already online, and again on every reconnect.
    const stopAutoFlush = startAutoFlush(replay, handleFlushReport);

    return () => {
      window.removeEventListener('online', syncConnection);
      window.removeEventListener('offline', syncConnection);
      stopAutoFlush();
    };
  }, [replay, handleFlushReport, refreshQueued]);

  /**
   * Queues an action taken with no connection. Deliberately does NOT raise a network-error toast —
   * from the child's point of view the tap worked; it is just waiting for signal.
   */
  const queueOffline = useCallback(
    async (type: 'start' | 'complete', assignment: TaskAssignment, note?: string) => {
      await enqueueOffline(type, assignment.id, note ? { note } : undefined);
      await refreshQueued();
      setOffline(true);
      showSuccess(
        type === 'start'
          ? 'Started offline — we’ll sync it when you’re back online 📶'
          : 'Saved offline — we’ll sync it when you’re back online 📶'
      );
    },
    [refreshQueued, showSuccess]
  );

  /** A thrown value with no HTTP status is a transport failure, i.e. we are effectively offline. */
  const isNetworkFailure = (err: unknown) =>
    typeof (err as { status?: unknown } | null)?.status !== 'number';

  // ── Derive tab lists ──────────────────────────────────────────────────────

  const activeAssignments    = assignments.filter(a =>
    ['pending', 'in_progress'].includes(a.status)
  );
  const completedAssignments = assignments.filter(a =>
    ['completed', 'approved'].includes(a.status)
  );
  // Bug fix: rejected tasks now show in "Returned" tab
  const returnedAssignments  = assignments.filter(a => a.status === 'rejected');

  /**
   * Second half of the deep link: put the linked assignment on screen.
   *
   * Split from the effect that reads the query string because it can only run once the list has
   * arrived — the tab is chosen from the assignment's status, and the element to scroll to does not
   * exist until that tab is rendered. `focusedId` is cleared at the end so a later tab change by the
   * child is never yanked back.
   */
  const focused = focusedId ? assignments.find((a) => a.id === focusedId) : undefined;

  useEffect(() => {
    if (!focused) return;
    setActiveTab(tabForStatus(focused.status));

    // A beat, so the tab's cards have mounted before we look for the element.
    const scroll = window.setTimeout(() => {
      document
        .getElementById(`assignment-${focused.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    const unhighlight = window.setTimeout(() => setFocusedId(null), 2500);

    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(unhighlight);
    };
  }, [focused]);

  // ── Start a task (pending → in_progress) ─────────────────────────────────

  const handleStart = async (assignment: TaskAssignment) => {
    setStartingId(assignment.id);
    try {
      // FR-13: known-offline never even attempts the request — no failed fetch, no error toast.
      if (!isOnline()) {
        await queueOffline('start', assignment);
        return;
      }
      await tasksApi.startAssignment(assignment.id);
      await loadTasks();
    } catch (err) {
      // The connection can drop between the check and the request; queue rather than complain.
      if (isNetworkFailure(err)) {
        await queueOffline('start', assignment);
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to start task';
      showError(message);
    } finally {
      setStartingId(null);
    }
  };

  // ── Complete (submit) a task ──────────────────────────────────────────────

  const handleComplete = async (assignment: TaskAssignment) => {
    // Photo evidence is online-only by design (queueing image blobs is a different problem), so
    // offline the photo modal is skipped entirely — the card offers "complete without photo".
    if (assignment.task.requiresPhotoEvidence && isOnline()) {
      setPhotoAssignment(assignment);
      return;
    }
    setCompletingId(assignment.id);
    try {
      if (!isOnline()) {
        await queueOffline(
          'complete',
          assignment,
          assignment.task.requiresPhotoEvidence ? 'Completed offline — photo to follow' : undefined
        );
        return;
      }
      await tasksApi.completeAssignment(assignment.id);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      showSuccess('Task submitted for approval! 🎉');
      await loadTasks();
    } catch (err) {
      if (isNetworkFailure(err)) {
        await queueOffline('complete', assignment);
        return;
      }
      showError('Failed to submit task');
    } finally {
      setCompletingId(null);
    }
  };

  // ── Resubmit a rejected task ──────────────────────────────────────────────
  // Calls the same complete endpoint - parent must approve again.

  const handleResubmit = async (assignment: TaskAssignment) => {
    if (assignment.task.requiresPhotoEvidence) {
      setPhotoAssignment(assignment);
      return;
    }
    setResubmittingId(assignment.id);
    try {
      await tasksApi.completeAssignment(assignment.id);
      showSuccess('Task resubmitted for approval!');
      await loadTasks();
    } catch {
      showError('Failed to resubmit task');
    } finally {
      setResubmittingId(null);
    }
  };

  // ── Photo upload submit ───────────────────────────────────────────────────

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoSubmit = async (file: File) => {
    if (!photoAssignment) return;
    setUploading(true);
    try {
      // Step 1: upload the photo file and get back the stored URL
      const evidenceRes = await tasksApi.uploadEvidence(photoAssignment.id, file);
      const evidence = (evidenceRes as any).data?.evidence ?? (evidenceRes as any).evidence;
      const photoUrl: string | undefined = evidence?.fileUrl;

      // Step 2: mark the assignment complete, attaching the photo URL
      await tasksApi.completeAssignment(photoAssignment.id, photoUrl);

      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      showSuccess('Task submitted with photo! 🎉');
      setPhotoAssignment(null);
      await loadTasks();
    } catch {
      showError('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  // ── Self-assign secondary task ────────────────────────────────────────────

  const handleSelfAssign = async (taskId: string) => {
    setSelfAssigningId(taskId);
    try {
      await tasksApi.selfAssign(taskId);
      showSuccess('Bonus task added!');
      await loadTasks();
    } catch (err) {
      const code = (err as any)?.data?.error?.code;
      if (code === 'CONFLICT') {
        const msg = (err as any)?.message ?? '';
        if (msg.toLowerCase().includes('primary task today')) {
          setDailyLimitReached(true);
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to self-assign task';
      showError(message);
    } finally {
      setSelfAssigningId(null);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ChildLayout>
      {showConfetti && <Confetti recycle={false} numberOfPieces={200} />}

      {/* Photo upload modal */}
      <AnimatePresence>
        {photoAssignment && (
          <PhotoUploadModal
            task={photoAssignment}
            onClose={() => setPhotoAssignment(null)}
            onSubmit={handlePhotoSubmit}
            uploading={uploading}
            fileInputRef={fileInputRef}
          />
        )}
      </AnimatePresence>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">My Tasks</h1>
          <p className="text-slate-600 mt-1">Complete tasks to earn points and level up</p>
        </div>

        {/* FR-13: offline banner — sets expectations before the child taps anything */}
        {offline && (
          <p
            data-testid="offline-banner"
            className="text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-2"
          >
            <WifiOff className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
            You&apos;re offline. Start and Complete still work — we&apos;ll send them the moment
            you&apos;re back online.
          </p>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(
            [
              { key: 'active',    label: 'Active',    count: activeAssignments.length },
              { key: 'completed', label: 'Completed',  count: completedAssignments.length },
              { key: 'returned',  label: 'Returned',   count: returnedAssignments.length },
            ] as { key: Tab; label: string; count: number }[]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all',
                activeTab === key
                  ? key === 'returned'
                    ? 'bg-white text-amber-700 shadow-sm'
                    : 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold',
                  activeTab === key
                    ? key === 'returned'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-xp-100 text-xp-700'
                    : 'bg-slate-200 text-slate-600'
                )}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Active tab ── */}
        {activeTab === 'active' && (
          <div className="space-y-4">
            {activeAssignments.length === 0 ? (
              <EmptyState icon={<Zap className="w-8 h-8 text-xp-400" />}
                title="No active tasks" message="You're all caught up!" />
            ) : (
              activeAssignments.map((a) => (
                <DeepLinkTarget key={a.id} assignmentId={a.id} highlighted={focusedId === a.id}>
                <TaskCard
                  assignment={a}
                  onStart={() => handleStart(a)}
                  onComplete={() => handleComplete(a)}
                  isStarting={startingId === a.id}
                  isCompleting={completingId === a.id}
                  isQueued={queuedIds.has(a.id)}
                  offline={offline}
                  meId={a.childId}
                />
                </DeepLinkTarget>
              ))
            )}

            {/* Available bonus tasks pool */}
            {availableTasks.length > 0 && (
              <div className="mt-6">
                <h2 className="font-display font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                  <Gift className="w-5 h-5 text-gold-500" />
                  Available Tasks
                  {hasPendingPrimaries && (
                    <span className="text-xs font-normal text-slate-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Complete primary tasks first
                    </span>
                  )}
                </h2>
                <div className="space-y-3">
                  {availableTasks.map((task) => (
                    <AvailableTaskCard
                      key={task.id}
                      task={task}
                      locked={hasPendingPrimaries}
                      dailyLimitReached={dailyLimitReached}
                      onSelfAssign={() => handleSelfAssign(task.id)}
                      isSelfAssigning={selfAssigningId === task.id}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Completed tab ── */}
        {activeTab === 'completed' && (
          <div className="space-y-4">
            {completedAssignments.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="w-8 h-8 text-success-400" />}
                title="No completed tasks yet" message="Complete tasks to see them here!" />
            ) : (
              completedAssignments.map((a) => (
                <DeepLinkTarget key={a.id} assignmentId={a.id} highlighted={focusedId === a.id}>
                  <CompletedTaskCard assignment={a} />
                </DeepLinkTarget>
              ))
            )}
          </div>
        )}

        {/* ── Returned tab ── */}
        {activeTab === 'returned' && (
          <div className="space-y-4">
            {returnedAssignments.length === 0 ? (
              <EmptyState
                icon={<RotateCcw className="w-8 h-8 text-amber-400" />}
                title="No returned tasks"
                message="Tasks returned by your parent will appear here for resubmission."
              />
            ) : (
              <>
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  Your parent has returned these tasks. Read their feedback and resubmit
                  when you&apos;ve made the changes.
                </p>
                {returnedAssignments.map((a) => (
                  <DeepLinkTarget key={a.id} assignmentId={a.id} highlighted={focusedId === a.id}>
                    <ReturnedTaskCard
                      assignment={a}
                      onResubmit={() => handleResubmit(a)}
                      isResubmitting={resubmittingId === a.id}
                    />
                  </DeepLinkTarget>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </ChildLayout>
  );
}

/**
 * Anchor for `?assignment=<id>`.
 *
 * A wrapper rather than an `id` prop on each card because all three card types need it and only one
 * of them is a shared component. The ring is deliberately loud and deliberately brief: it answers
 * "which of these did the notification mean?" and then gets out of the way.
 */
function DeepLinkTarget({
  assignmentId,
  highlighted,
  children,
}: {
  assignmentId: string;
  highlighted: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`assignment-${assignmentId}`}
      className={cn(
        'rounded-2xl transition-shadow duration-500',
        highlighted && 'ring-4 ring-xp-400 ring-offset-2'
      )}
    >
      {children}
    </div>
  );
}

// ── Task Card (active) ────────────────────────────────────────────────────────

function TaskCard({
  assignment,
  onStart,
  onComplete,
  isStarting,
  isCompleting,
  isQueued = false,
  offline = false,
  meId,
}: {
  assignment: TaskAssignment;
  onStart: () => void;
  onComplete: () => void;
  isStarting: boolean;
  isCompleting: boolean;
  /** FR-13: this card has an action waiting in the offline queue. */
  isQueued?: boolean;
  offline?: boolean;
  /** U17: so the team badge can say "You" instead of the child's own name. */
  meId?: string;
}) {
  const isPending = assignment.status === 'pending';
  const isInProgress = assignment.status === 'in_progress';
  const isAwaitingApproval = assignment.status === 'completed';
  const isPrimary = assignment.task.taskTag === 'primary';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-white rounded-2xl p-5 border shadow-sm',
        isAwaitingApproval
          ? 'border-warning-200 bg-warning-50'
          : isPrimary
          ? 'border-xp-200'
          : 'border-slate-200'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isPrimary ? (
              <span className="text-xs font-semibold text-xp-600 bg-xp-50 px-2 py-0.5 rounded-full">Primary</span>
            ) : (
              <span className="text-xs font-semibold text-gold-600 bg-gold-50 px-2 py-0.5 rounded-full">Bonus</span>
            )}
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              getDifficultyColor(assignment.task.difficulty.toUpperCase()))}>
              {assignment.task.difficulty}
            </span>
            {isQueued && (
              <span
                data-testid="queued-badge"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full"
              >
                <CloudOff className="w-3 h-3" /> Queued
              </span>
            )}
          </div>
          <h3 className="font-bold text-slate-900 truncate">{assignment.task.title}</h3>
          {assignment.task.description && (
            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{assignment.task.description}</p>
          )}
          {assignment.task.dueDate && (
            <p className="flex items-center gap-1 text-xs text-slate-400 mt-1">
              <Calendar className="w-3 h-3" />
              Due {formatDateTime(assignment.task.dueDate)}
            </p>
          )}
          {assignment.team && <TeamBadge team={assignment.team} meId={meId} />}
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold shrink-0">
          <Star className="w-4 h-4" />
          <span>{assignment.task.pointsValue}</span>
        </div>
      </div>

      {isQueued ? (
        // FR-13: the tap already landed — it is sitting in the queue. Offering the button again
        // would only let the child double-submit the same action.
        <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
          <CloudOff className="w-4 h-4" />
          Queued — will send when you&apos;re back online
        </div>
      ) : isAwaitingApproval ? (
        <div className="flex items-center gap-2 text-warning-700 text-sm font-medium">
          <Clock className="w-4 h-4" />
          Waiting for parent approval…
        </div>
      ) : isPending ? (
        <Button
          onClick={onStart}
          disabled={isStarting}
          size="sm"
          fullWidth
          className={isPrimary ? 'bg-xp-600 hover:bg-xp-700 text-white' : 'bg-gold-500 hover:bg-gold-600 text-white'}
        >
          {isStarting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Starting…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Play className="w-4 h-4" /> Start Task
            </span>
          )}
        </Button>
      ) : (
        <Button
          onClick={onComplete}
          disabled={isCompleting}
          size="sm"
          fullWidth
          className={isPrimary ? 'bg-xp-600 hover:bg-xp-700 text-white' : 'bg-gold-500 hover:bg-gold-600 text-white'}
        >
          {isCompleting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Submitting…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {assignment.task.requiresPhotoEvidence && offline
                // FR-13: uploads need a connection, so offline the photo path is disabled and the
                // child is offered the explicit no-photo route rather than a dead button.
                ? <><CheckCircle2 className="w-4 h-4" /> Complete without photo</>
                : assignment.task.requiresPhotoEvidence
                ? <><Camera className="w-4 h-4" /> Submit with Photo</>
                : <><CheckCircle2 className="w-4 h-4" /> Mark Complete</>
              }
            </span>
          )}
        </Button>
      )}
      {assignment.task.requiresPhotoEvidence && offline && !isQueued && (
        <p data-testid="photo-offline-note" className="mt-2 text-xs text-slate-500">
          Photo upload needs a connection. Complete it now without a photo — you can add one later.
        </p>
      )}

      {/* FR-11: comment thread with the parent */}
      <TaskCommentThread assignmentId={assignment.id} />
    </motion.div>
  );
}

// ── Completed Task Card ───────────────────────────────────────────────────────

function CompletedTaskCard({ assignment }: { assignment: TaskAssignment }) {
  const isApproved = assignment.status === 'approved';

  return (
    <div className={cn(
      'rounded-2xl p-5 border',
      isApproved
        ? 'bg-success-50 border-success-200'
        : 'bg-warning-50 border-warning-200'
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isApproved
            ? <CheckCircle2 className="w-5 h-5 text-success-600" />
            : <Clock className="w-5 h-5 text-warning-600" />
          }
          <div>
            <p className="font-bold text-slate-900">{assignment.task.title}</p>
            <p className="text-sm text-slate-500">
              {isApproved ? 'Approved ✓' : 'Awaiting approval…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold">
          <Star className="w-4 h-4" />
          <span>{assignment.task.pointsValue}</span>
        </div>
      </div>
    </div>
  );
}

// ── Returned Task Card (rejected - now visible + resubmittable) ───────────────

function ReturnedTaskCard({
  assignment,
  onResubmit,
  isResubmitting,
}: {
  assignment: TaskAssignment;
  onResubmit: () => void;
  isResubmitting: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              getDifficultyColor(assignment.task.difficulty.toUpperCase()))}>
              {assignment.task.difficulty}
            </span>
            <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
              Returned
            </span>
          </div>
          <h3 className="font-bold text-slate-900">{assignment.task.title}</h3>
          {assignment.task.dueDate && (
            <p className="flex items-center gap-1 text-xs text-slate-400 mt-1">
              <Calendar className="w-3 h-3" />
              Due {formatDateTime(assignment.task.dueDate)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold shrink-0">
          <Star className="w-4 h-4" />
          <span>{assignment.task.pointsValue}</span>
        </div>
      </div>

      {/* Rejection reason */}
      {assignment.rejectionReason && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <p className="font-semibold text-xs uppercase tracking-wide text-amber-600 mb-0.5">
            Parent&apos;s feedback
          </p>
          <p>{assignment.rejectionReason}</p>
        </div>
      )}

      <Button
        onClick={onResubmit}
        disabled={isResubmitting}
        size="sm"
        fullWidth
        className="bg-amber-500 hover:bg-amber-600 text-white"
      >
        {isResubmitting ? (
          <span className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Resubmitting…
          </span>
        ) : (
          <span className="flex items-center gap-2">
            {assignment.task.requiresPhotoEvidence
              ? <><Camera className="w-4 h-4" /> Resubmit with Photo</>
              : <><RotateCcw className="w-4 h-4" /> Resubmit Task</>
            }
          </span>
        )}
      </Button>
    </motion.div>
  );
}

// ── Available (bonus pool) Task Card ─────────────────────────────────────────

function AvailableTaskCard({
  task,
  locked,
  dailyLimitReached,
  onSelfAssign,
  isSelfAssigning,
}: {
  task: any;
  locked: boolean;
  dailyLimitReached: boolean;
  onSelfAssign: () => void;
  isSelfAssigning: boolean;
}) {
  const primaryDailyBlocked = dailyLimitReached && task.taskTag === 'primary';
  const isBlocked = locked || primaryDailyBlocked;
  const tooltip = locked
    ? 'Complete your current primary task first.'
    : primaryDailyBlocked
    ? 'You have already completed a primary task today.'
    : undefined;

  return (
    <div className={cn(
      'bg-white rounded-2xl p-4 border shadow-sm',
      isBlocked ? 'border-slate-100 opacity-60' : 'border-gold-200'
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              getDifficultyColor((task.difficulty || '').toUpperCase()))}>
              {task.difficulty}
            </span>
          </div>
          <p className="font-bold text-slate-900 truncate">{task.title}</p>
          {task.dueDate && (
            <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
              <Calendar className="w-3 h-3" />
              Due {formatDateTime(task.dueDate)}
            </p>
          )}
          {task.claimsRemaining != null && (
            <p className="text-xs text-slate-400 mt-0.5">
              {task.claimsRemaining} spot{task.claimsRemaining !== 1 ? 's' : ''} left
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-gold-600 font-bold text-sm">
            <Star className="w-3.5 h-3.5" />
            <span>{task.pointsValue}</span>
          </div>
          <div title={tooltip}>
            <Button
              size="sm"
              onClick={onSelfAssign}
              disabled={isBlocked || isSelfAssigning}
              className="bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-40"
            >
              {isBlocked
                ? <Lock className="w-3.5 h-3.5" />
                : isSelfAssigning
                ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Plus className="w-3.5 h-3.5" />
              }
            </Button>
          </div>
        </div>
      </div>
      {tooltip && (
        <p className="mt-2 text-xs text-slate-400">{tooltip}</p>
      )}
    </div>
  );
}

// ── Photo Upload Modal ────────────────────────────────────────────────────────

function PhotoUploadModal({
  task,
  onClose,
  onSubmit,
  uploading,
  fileInputRef,
}: {
  task: TaskAssignment;
  onClose: () => void;
  onSubmit: (file: File) => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">Photo Evidence</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          Upload a photo to prove you completed <strong>{task.task.title}</strong>.
        </p>

        {preview ? (
          <div className="relative mb-4">
            <img src={preview} alt="Preview" className="w-full h-48 object-cover rounded-xl" />
            <button
              onClick={() => { setFile(null); setPreview(null); }}
              className="absolute top-2 right-2 bg-white/80 p-1 rounded-full"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-36 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-xp-400 hover:text-xp-600 transition-colors mb-4"
          >
            <ImageIcon className="w-8 h-8" />
            <span className="text-sm font-medium">Tap to select photo</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />

        <Button
          fullWidth
          disabled={!file || uploading}
          onClick={() => file && onSubmit(file)}
          className="bg-xp-600 hover:bg-xp-700 text-white"
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Uploading…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Submit Task
            </span>
          )}
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
      <div className="flex justify-center mb-4">{icon}</div>
      <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}