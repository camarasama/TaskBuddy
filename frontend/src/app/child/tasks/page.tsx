'use client';

/**
 * app/child/tasks/page.tsx — updated (Bug fix: rejected task resubmission)
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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getDifficultyColor, formatPoints } from '@/lib/utils';
import Confetti from 'react-confetti';

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskAssignment {
  id: string;
  status: string;
  rejectionReason?: string | null;
  dueDate?: string;
  canSelfAssign?: boolean;
  task: {
    id: string;
    title: string;
    description?: string;
    difficulty: string;
    pointsValue: number;
    requiresPhotoEvidence: boolean;
    taskTag: 'primary' | 'secondary';
  };
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = 'active' | 'completed' | 'returned';

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChildTasksPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [assignments, setAssignments]           = useState<TaskAssignment[]>([]);
  const [availableTasks, setAvailableTasks]     = useState<any[]>([]);
  const [isLoading, setIsLoading]               = useState(true);
  const [activeTab, setActiveTab]               = useState<Tab>('active');
  const [completingId, setCompletingId]         = useState<string | null>(null);
  const [resubmittingId, setResubmittingId]     = useState<string | null>(null);
  const [selfAssigningId, setSelfAssigningId]   = useState<string | null>(null);
  const [showConfetti, setShowConfetti]         = useState(false);
  const [photoAssignment, setPhotoAssignment]   = useState<TaskAssignment | null>(null);
  const [hasPendingPrimaries, setHasPendingPrimaries] = useState(false);

  // ── Load tasks ────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const [assignmentsRes, tasksRes] = await Promise.all([
        tasksApi.getMyAssignments(),
        tasksApi.getAll(),
      ]);

      const assignmentsData = assignmentsRes.data as { assignments: TaskAssignment[] };
      setAssignments(assignmentsData.assignments);

      const tasksData = tasksRes.data as {
        tasks: any[];
        hasPendingPrimaries?: boolean;
      };
      const unassignedSecondary = tasksData.tasks.filter(
        (t: any) => t.taskTag === 'secondary' && t.assignments.length === 0
      );
      setAvailableTasks(unassignedSecondary);
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

  // ── Derive tab lists ──────────────────────────────────────────────────────

  const activeAssignments    = assignments.filter(a =>
    ['pending', 'in_progress'].includes(a.status)
  );
  const completedAssignments = assignments.filter(a =>
    ['completed', 'approved'].includes(a.status)
  );
  // Bug fix: rejected tasks now show in "Returned" tab
  const returnedAssignments  = assignments.filter(a => a.status === 'rejected');

  // ── Complete (submit) a task ──────────────────────────────────────────────

  const handleComplete = async (assignment: TaskAssignment) => {
    if (assignment.task.requiresPhotoEvidence) {
      setPhotoAssignment(assignment);
      return;
    }
    setCompletingId(assignment.id);
    try {
      await tasksApi.completeAssignment(assignment.id);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      showSuccess('Task submitted for approval! 🎉');
      await loadTasks();
    } catch {
      showError('Failed to submit task');
    } finally {
      setCompletingId(null);
    }
  };

  // ── Resubmit a rejected task ──────────────────────────────────────────────
  // Calls the same complete endpoint — parent must approve again.

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
    } catch {
      showError('Failed to self-assign task');
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
                <TaskCard
                  key={a.id}
                  assignment={a}
                  onComplete={() => handleComplete(a)}
                  isCompleting={completingId === a.id}
                />
              ))
            )}

            {/* Available bonus tasks pool */}
            {availableTasks.length > 0 && (
              <div className="mt-6">
                <h2 className="font-display font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                  <Gift className="w-5 h-5 text-gold-500" />
                  Bonus Tasks
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
                <CompletedTaskCard key={a.id} assignment={a} />
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
                  <ReturnedTaskCard
                    key={a.id}
                    assignment={a}
                    onResubmit={() => handleResubmit(a)}
                    isResubmitting={resubmittingId === a.id}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </ChildLayout>
  );
}

// ── Task Card (active) ────────────────────────────────────────────────────────

function TaskCard({
  assignment,
  onComplete,
  isCompleting,
}: {
  assignment: TaskAssignment;
  onComplete: () => void;
  isCompleting: boolean;
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
          </div>
          <h3 className="font-bold text-slate-900 truncate">{assignment.task.title}</h3>
          {assignment.task.description && (
            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{assignment.task.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold shrink-0">
          <Star className="w-4 h-4" />
          <span>{assignment.task.pointsValue}</span>
        </div>
      </div>

      {isAwaitingApproval ? (
        <div className="flex items-center gap-2 text-warning-700 text-sm font-medium">
          <Clock className="w-4 h-4" />
          Waiting for parent approval…
        </div>
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
              {assignment.task.requiresPhotoEvidence
                ? <><Camera className="w-4 h-4" /> Submit with Photo</>
                : <><CheckCircle2 className="w-4 h-4" /> Mark Complete</>
              }
            </span>
          )}
        </Button>
      )}
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

// ── Returned Task Card (rejected — now visible + resubmittable) ───────────────

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
  onSelfAssign,
  isSelfAssigning,
}: {
  task: any;
  locked: boolean;
  onSelfAssign: () => void;
  isSelfAssigning: boolean;
}) {
  return (
    <div className={cn(
      'bg-white rounded-2xl p-4 border shadow-sm',
      locked ? 'border-slate-100 opacity-60' : 'border-gold-200'
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-gold-600 font-bold text-sm">
            <Star className="w-3.5 h-3.5" />
            <span>{task.pointsValue}</span>
          </div>
          <Button
            size="sm"
            onClick={onSelfAssign}
            disabled={locked || isSelfAssigning}
            className="bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-40"
          >
            {locked
              ? <Lock className="w-3.5 h-3.5" />
              : isSelfAssigning
              ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <Plus className="w-3.5 h-3.5" />
            }
          </Button>
        </div>
      </div>
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
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
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