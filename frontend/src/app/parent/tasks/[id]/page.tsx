'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Pencil, RotateCcw, Calendar, Clock, Star, Zap,
  Camera, FileText, CheckCircle2, XCircle, Loader2, X,
  Repeat, Tag, Users, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface Evidence {
  id: string;
  evidenceType: 'photo' | 'note';
  fileUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  note?: string;
  uploadedAt: string;
}

interface Assignment {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'approved' | 'rejected';
  completedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  pointsAwarded?: number;
  xpAwarded?: number;
  child: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  };
  evidence: Evidence[];
}

interface Task {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  taskTag: 'primary' | 'secondary';
  pointsValue: number;
  xpValue: number;
  requiresPhotoEvidence: boolean;
  dueDate?: string;
  startTime?: string;
  estimatedMinutes?: number;
  maxClaimsTotal?: number;
  status: 'active' | 'paused' | 'archived';
  isRecurring: boolean;
  recurrencePattern?: string;
  creator?: { id: string; firstName: string; lastName: string };
  assignments: Assignment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIFFICULTY_STYLES = {
  easy:   'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard:   'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, string> = {
  pending:     'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-amber-100 text-amber-700',
  approved:    'bg-green-100 text-green-700',
  rejected:    'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  approved:    'Approved',
  rejected:    'Rejected',
};

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <button
          className="absolute top-4 right-4 text-white/80 hover:text-white"
          onClick={onClose}
        >
          <X className="w-8 h-8" />
        </button>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-3xl max-h-[85vh] w-full"
        >
          <Image
            src={src}
            alt="Evidence photo"
            width={900}
            height={700}
            className="object-contain rounded-xl max-h-[85vh] w-auto mx-auto"
            unoptimized
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Assignment Card ───────────────────────────────────────────────────────────

function AssignmentCard({
  assignment,
  onReset,
  isResetting,
}: {
  assignment: Assignment;
  onReset: (id: string) => void;
  isResetting: boolean;
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const canReset = ['completed', 'approved', 'rejected'].includes(assignment.status);

  const photoEvidence = assignment.evidence.filter((e) => e.evidenceType === 'photo');
  const noteEvidence  = assignment.evidence.filter((e) => e.evidenceType === 'note');

  const avatar = assignment.child.avatarUrl;
  const initials = `${assignment.child.firstName[0]}${assignment.child.lastName[0]}`.toUpperCase();

  return (
    <>
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        {/* Child header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-primary-100 flex items-center justify-center">
              {avatar ? (
                <Image src={avatar} alt={assignment.child.firstName} width={36} height={36} className="object-cover w-full h-full" unoptimized />
              ) : (
                <span className="text-sm font-bold text-primary-600">{initials}</span>
              )}
            </div>
            <div>
              <p className="font-medium text-slate-900 text-sm">
                {assignment.child.firstName} {assignment.child.lastName}
              </p>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_STYLES[assignment.status])}>
                {STATUS_LABELS[assignment.status]}
              </span>
            </div>
          </div>

          {canReset && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReset(assignment.id)}
              disabled={isResetting}
              className="flex items-center gap-1.5 text-xs"
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Restore
            </Button>
          )}
        </div>

        {/* Completion / approval timestamps */}
        {assignment.completedAt && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
            Completed {formatDateTime(assignment.completedAt)}
          </p>
        )}
        {assignment.approvedAt && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            Approved {formatDateTime(assignment.approvedAt)}
            {assignment.pointsAwarded != null && (
              <span className="ml-1 font-medium text-green-700">· +{assignment.pointsAwarded} pts</span>
            )}
          </p>
        )}
        {assignment.status === 'rejected' && assignment.rejectionReason && (
          <p className="text-xs text-red-600 flex items-start gap-1.5">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Rejected: {assignment.rejectionReason}
          </p>
        )}

        {/* Photo evidence */}
        {photoEvidence.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5" /> Photo Evidence
            </p>
            <div className="flex flex-wrap gap-2">
              {photoEvidence.map((ev) => (
                ev.fileUrl && (
                  <button
                    key={ev.id}
                    onClick={() => setLightboxSrc(ev.fileUrl!)}
                    className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200 hover:border-primary-400 transition-colors group"
                  >
                    <Image
                      src={ev.thumbnailUrl || ev.fileUrl}
                      alt="Evidence"
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  </button>
                )
              ))}
            </div>
          </div>
        )}

        {/* Note evidence */}
        {noteEvidence.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Notes
            </p>
            <div className="space-y-1.5">
              {noteEvidence.map((ev) => (
                <p key={ev.id} className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                  {ev.note}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const { error: showError, success: showSuccess } = useToast();

  const taskId = params.id as string;

  const [isLoading, setIsLoading]     = useState(true);
  const [task, setTask]               = useState<Task | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const loadTask = useCallback(async () => {
    try {
      const response = await tasksApi.getById(taskId);
      setTask((response.data as { task: Task }).task);
    } catch {
      showError('Failed to load task');
      router.push('/parent/tasks');
    } finally {
      setIsLoading(false);
    }
  }, [taskId, showError, router]);

  useEffect(() => { if (taskId) loadTask(); }, [taskId, loadTask]);

  const handleReset = async (assignmentId: string) => {
    setResettingId(assignmentId);
    try {
      await tasksApi.resetAssignment(assignmentId);
      showSuccess('Assignment restored to pending');
      // Reload to reflect updated status
      const response = await tasksApi.getById(taskId);
      setTask((response.data as { task: Task }).task);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to restore assignment');
    } finally {
      setResettingId(null);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  if (!task) {
    return (
      <ParentLayout>
        <div className="text-center py-12">
          <p className="text-slate-600">Task not found</p>
          <Link href="/parent/tasks">
            <Button variant="secondary" className="mt-4">Back to Tasks</Button>
          </Link>
        </div>
      </ParentLayout>
    );
  }

  const activeAssignments    = task.assignments.filter((a) => ['pending', 'in_progress'].includes(a.status));
  const completedAssignments = task.assignments.filter((a) => ['completed', 'approved', 'rejected'].includes(a.status));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ParentLayout>
      <div className="space-y-6 max-w-2xl mx-auto">

        {/* Back */}
        <Link
          href="/parent/tasks"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>

        {/* Header card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', DIFFICULTY_STYLES[task.difficulty])}>
                  {task.difficulty}
                </span>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  task.taskTag === 'primary' ? 'bg-primary-100 text-primary-700' : 'bg-emerald-100 text-emerald-700'
                )}>
                  {task.taskTag === 'primary' ? '⭐ Primary' : '🎁 Secondary'}
                </span>
                {task.status !== 'active' && (
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    task.status === 'paused' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    {task.status === 'paused' ? 'Paused' : 'Archived'}
                  </span>
                )}
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 break-words">{task.title}</h1>
              {task.description && (
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">{task.description}</p>
              )}
            </div>

            <Link href={`/parent/tasks/${taskId}/edit`} className="flex-shrink-0">
              <Button variant="secondary" size="sm" className="flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </Button>
            </Link>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Star className="w-4 h-4 text-amber-400" />
              <span>{task.pointsValue} points</span>
            </div>
            {task.xpValue > 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Zap className="w-4 h-4 text-violet-400" />
                <span>{task.xpValue} XP</span>
              </div>
            )}
            {task.dueDate && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span>Due {formatDate(task.dueDate)}</span>
              </div>
            )}
            {task.estimatedMinutes && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>{task.estimatedMinutes} min</span>
              </div>
            )}
            {task.category && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Tag className="w-4 h-4 text-slate-400" />
                <span>{task.category}</span>
              </div>
            )}
            {task.requiresPhotoEvidence && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Camera className="w-4 h-4 text-slate-400" />
                <span>Photo required</span>
              </div>
            )}
            {task.isRecurring && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Repeat className="w-4 h-4 text-slate-400" />
                <span className="capitalize">{task.recurrencePattern ?? 'Recurring'}</span>
              </div>
            )}
            {task.maxClaimsTotal != null && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Users className="w-4 h-4 text-slate-400" />
                <span>Max {task.maxClaimsTotal} claims</span>
              </div>
            )}
            {task.creator && (
              <div className="flex items-center gap-2 text-sm text-slate-500 col-span-2">
                <span className="text-slate-400">Created by</span>
                <span>{task.creator.firstName} {task.creator.lastName}</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Active assignments */}
        {activeAssignments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
          >
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              Active Assignments
            </h2>
            <div className="space-y-3">
              {activeAssignments.map((a) => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  onReset={handleReset}
                  isResetting={resettingId === a.id}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Completed / approved / rejected assignments */}
        {completedAssignments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
          >
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-400" />
              Completed Assignments
            </h2>
            <div className="space-y-3">
              {completedAssignments.map((a) => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  onReset={handleReset}
                  isResetting={resettingId === a.id}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* No assignments at all */}
        {task.assignments.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm text-center"
          >
            <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No assignments yet. Edit the task to assign children.</p>
            <Link href={`/parent/tasks/${taskId}/edit`} className="inline-block mt-3">
              <Button variant="secondary" size="sm">Edit Task</Button>
            </Link>
          </motion.div>
        )}

      </div>
    </ParentLayout>
  );
}
