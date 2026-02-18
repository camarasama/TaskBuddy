// frontend/src/app/child/tasks/page.tsx
'use client';

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
  dueDate?: string;
  // M5 — canSelfAssign flag from API
  canSelfAssign?: boolean;
  task: {
    id: string;
    title: string;
    description?: string;
    difficulty: string;
    pointsValue: number;
    requiresPhotoEvidence: boolean;
    // M5 — CR-01
    taskTag: 'primary' | 'secondary';
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ChildTasksPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [availableTasks, setAvailableTasks] = useState<any[]>([]); // M5 — unassigned secondary tasks
  const [isLoading, setIsLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [selfAssigningId, setSelfAssigningId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [photoAssignment, setPhotoAssignment] = useState<TaskAssignment | null>(null);
  // M5 — whether child has any pending primary
  const [hasPendingPrimaries, setHasPendingPrimaries] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      // Fetch assignments (tasks already assigned to me)
      const assignmentsResponse = await tasksApi.getMyAssignments();
      const assignmentsData = assignmentsResponse.data as {
        assignments: TaskAssignment[];
      };
      setAssignments(assignmentsData.assignments);

      // M5 — Fetch all tasks (includes unassigned secondary tasks)
      const tasksResponse = await tasksApi.getAll();
      const tasksData = tasksResponse.data as {
        tasks: any[];
        hasPendingPrimaries?: boolean;
      };
      
      // Filter to only show unassigned secondary tasks (the bonus pool)
      const unassignedSecondary = tasksData.tasks.filter(
        (task: any) => task.taskTag === 'secondary' && task.assignments.length === 0
      );
      
      setAvailableTasks(unassignedSecondary);
      setHasPendingPrimaries(tasksData.hasPendingPrimaries ?? false);
    } catch {
      showError('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // ── Complete task ────────────────────────────────────────────────────────────
  const handleComplete = async (assignment: TaskAssignment) => {
    if (assignment.task.requiresPhotoEvidence) {
      setPhotoAssignment(assignment);
      return;
    }
    setCompletingId(assignment.id);
    try {
      await tasksApi.completeAssignment(assignment.id);
      showSuccess('Task completed! Waiting for approval.');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      loadTasks();
    } catch {
      showError('Failed to complete task');
    } finally {
      setCompletingId(null);
    }
  };

  const handlePhotoComplete = async (photo: File) => {
    if (!photoAssignment) return;
    setCompletingId(photoAssignment.id);
    try {
      await tasksApi.uploadEvidence(photoAssignment.id, photo);
      await tasksApi.completeAssignment(photoAssignment.id);
      showSuccess('Task completed with photo! Waiting for approval.');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      setPhotoAssignment(null);
      loadTasks();
    } catch {
      showError('Failed to complete task');
    } finally {
      setCompletingId(null);
    }
  };

  // M5 — Self-assign a secondary task
  const handleSelfAssign = async (taskId: string) => {
    setSelfAssigningId(taskId);
    try {
      await tasksApi.selfAssign(taskId);
      showSuccess('Bonus task added! Good luck!');
      loadTasks();
    } catch {
      showError('Could not pick up this task right now.');
    } finally {
      setSelfAssigningId(null);
    }
  };

  // ── Partition assignments ────────────────────────────────────────────────────
  // Active = pending + in_progress
  const activePrimary   = assignments.filter(
    (a) => (a.status === 'pending' || a.status === 'in_progress') && a.task.taskTag === 'primary'
  );
  const activeSecondary = assignments.filter(
    (a) => (a.status === 'pending' || a.status === 'in_progress') && a.task.taskTag === 'secondary'
  );
  const waitingApproval = assignments.filter((a) => a.status === 'completed');
  const completedTasks  = assignments.filter((a) => a.status === 'approved');

  if (isLoading) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  return (
    <ChildLayout>
      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={200}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">My Tasks</h1>
          <p className="text-slate-600">Complete tasks to earn points!</p>
        </div>

        {/* Progress Summary */}
        <div className="bg-gradient-to-r from-success-500 to-success-600 rounded-2xl p-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-success-100">Today&apos;s Progress</p>
              <p className="text-2xl font-bold">
                {completedTasks.length} of {assignments.length} done
              </p>
            </div>
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
              <Trophy className="w-8 h-8" />
            </div>
          </div>
        </div>

        {/* ── Primary Tasks (must-do) ──────────────────────────────────────── */}
        {activePrimary.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-warning-500" />
              To Do ({activePrimary.length})
            </h2>
            <div className="space-y-3">
              <AnimatePresence>
                {activePrimary.map((assignment, index) => (
                  <motion.div
                    key={assignment.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <TaskCard
                      assignment={assignment}
                      onComplete={() => handleComplete(assignment)}
                      isCompleting={completingId === assignment.id}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* ── M5: Secondary / Bonus Tasks ──────────────────────────────────── */}
        {activeSecondary.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-2 flex items-center gap-2">
              <Gift className="w-5 h-5 text-success-500" />
              Bonus Tasks ({activeSecondary.length})
            </h2>

            {hasPendingPrimaries ? (
              // Locked state — primary tasks not done yet
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center mb-3">
                  <Lock className="w-7 h-7 text-slate-500" />
                </div>
                <p className="font-bold text-slate-700 mb-1">Bonus Tasks Locked</p>
                <p className="text-sm text-slate-500">
                  Complete your main tasks first to unlock bonus tasks!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {activeSecondary.map((assignment, index) => (
                    <motion.div
                      key={assignment.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <TaskCard
                        assignment={assignment}
                        onComplete={() => handleComplete(assignment)}
                        isCompleting={completingId === assignment.id}
                        isBonus
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        )}

        {/* ── M5: Available Bonus Tasks (not yet assigned) ──────────────────── */}
        {availableTasks.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-2 flex items-center gap-2">
              <Star className="w-5 h-5 text-purple-500" />
              Available Bonus Tasks ({availableTasks.length})
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              {hasPendingPrimaries 
                ? 'Complete your main tasks first to unlock these!' 
                : 'Pick up extra tasks to earn bonus points!'}
            </p>

            <div className="space-y-3">
              <AnimatePresence>
                {availableTasks.map((task: any, index: number) => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <AvailableTaskCard
                      task={task}
                      onSelfAssign={() => handleSelfAssign(task.id)}
                      isSelfAssigning={selfAssigningId === task.id}
                      isLocked={hasPendingPrimaries}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Waiting Approval */}
        {waitingApproval.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-warning-500" />
              Waiting for Approval ({waitingApproval.length})
            </h2>
            <div className="space-y-3">
              {waitingApproval.map((assignment) => (
                <div
                  key={assignment.id}
                  className="bg-warning-50 rounded-xl p-4 border border-warning-200 shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-warning-100 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-warning-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-slate-900">{assignment.task.title}</p>
                      <p className="text-sm text-warning-600">Waiting for parent to approve</p>
                    </div>
                    <div className="flex items-center gap-1 text-gold-600 font-bold">
                      <Star className="w-4 h-4" />
                      <span>{assignment.task.pointsValue}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success-500" />
              Completed ({completedTasks.length})
            </h2>
            <div className="space-y-3">
              {completedTasks.map((assignment) => (
                <div
                  key={assignment.id}
                  className="bg-success-50 rounded-xl p-4 border border-success-200 shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-success-500 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-success-800 line-through">
                        {assignment.task.title}
                      </p>
                      <p className="text-sm text-success-600">Great job!</p>
                    </div>
                    <div className="flex items-center gap-1 text-success-600 font-bold">
                      <Star className="w-4 h-4" />
                      <span>+{assignment.task.pointsValue}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {assignments.length === 0 && (
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="font-bold text-slate-900 mb-2">No tasks yet!</h3>
            <p className="text-slate-600">Ask your parents to assign you some tasks</p>
          </div>
        )}
      </div>

      {/* Photo Upload Modal */}
      <AnimatePresence>
        {photoAssignment && (
          <PhotoUploadModal
            taskTitle={photoAssignment.task.title}
            isUploading={completingId === photoAssignment.id}
            onSubmit={handlePhotoComplete}
            onClose={() => setPhotoAssignment(null)}
          />
        )}
      </AnimatePresence>
    </ChildLayout>
  );
}

// ── Photo Upload Modal ───────────────────────────────────────────────────────
function PhotoUploadModal({
  taskTitle,
  isUploading,
  onSubmit,
  onClose,
}: {
  taskTitle: string;
  isUploading: boolean;
  onSubmit: (photo: File) => void;
  onClose: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = () => { if (selectedFile) onSubmit(selectedFile); };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-slate-900">Upload Photo</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100" disabled={isUploading}>
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Take or upload a photo to complete <strong>{taskTitle}</strong>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />
        {preview ? (
          <div className="relative mb-4">
            <img src={preview} alt="Photo preview" className="w-full h-48 object-cover rounded-xl" />
            <button
              onClick={() => { setSelectedFile(null); setPreview(null); }}
              className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70"
              disabled={isUploading}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-48 rounded-xl border-2 border-dashed border-slate-300 hover:border-xp-400 hover:bg-xp-50 transition-colors flex flex-col items-center justify-center gap-3 mb-4"
          >
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <Camera className="w-7 h-7 text-slate-500" />
            </div>
            <div className="text-center">
              <p className="font-medium text-slate-700">Tap to take a photo</p>
              <p className="text-xs text-slate-500">or choose from gallery</p>
            </div>
          </button>
        )}
        <div className="flex gap-3">
          {!preview ? (
            <Button fullWidth variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <ImageIcon className="w-4 h-4" />
              Choose Photo
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                Change
              </Button>
              <Button fullWidth variant="success" onClick={handleSubmit} loading={isUploading}>
                <Upload className="w-4 h-4" />
                Submit & Complete
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({
  assignment,
  onComplete,
  isCompleting,
  isBonus = false,
}: {
  assignment: TaskAssignment;
  onComplete: () => void;
  isCompleting: boolean;
  isBonus?: boolean;
}) {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className={cn(
        'bg-white rounded-xl p-4 border shadow-sm',
        isBonus ? 'border-success-200' : 'border-slate-200'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Complete Button */}
        <button
          onClick={onComplete}
          disabled={isCompleting}
          className={cn(
            'w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all',
            isCompleting
              ? 'bg-success-100 border-success-500'
              : 'border-slate-300 hover:border-success-500 hover:bg-success-50'
          )}
        >
          {isCompleting ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="w-6 h-6 border-2 border-success-500 border-t-transparent rounded-full"
            />
          ) : (
            <CheckCircle2 className="w-6 h-6 text-slate-400" />
          )}
        </button>

        {/* Task Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isBonus && (
              <span className="text-xs font-bold text-success-600 bg-success-100 px-2 py-0.5 rounded-full">
                🎁 Bonus
              </span>
            )}
            <h3 className="font-bold text-slate-900 truncate">{assignment.task.title}</h3>
          </div>
          {assignment.task.description && (
            <p className="text-sm text-slate-600 line-clamp-2 mb-2">
              {assignment.task.description}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className={cn('badge text-xs', getDifficultyColor(assignment.task.difficulty))}>
              {assignment.task.difficulty}
            </span>
            {assignment.task.requiresPhotoEvidence && (
              <span className="badge bg-slate-100 text-slate-600 text-xs">
                <Camera className="w-3 h-3 mr-1" />
                Photo
              </span>
            )}
          </div>
        </div>

        {/* Points */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 text-gold-600 font-bold text-lg">
            <Star className="w-5 h-5" />
            <span>{assignment.task.pointsValue}</span>
          </div>
          <span className="text-xs text-slate-500">points</span>
        </div>
      </div>

      {/* Quick Complete Button (Mobile) */}
      <div className="mt-4 lg:hidden">
        <Button fullWidth variant="success" onClick={onComplete} loading={isCompleting}>
          <CheckCircle2 className="w-5 h-5" />
          Complete Task
        </Button>
      </div>
    </motion.div>
  );
}

// ── Available Task Card (for unassigned secondary tasks) ────────────────────
function AvailableTaskCard({
  task,
  onSelfAssign,
  isSelfAssigning,
  isLocked = false,
}: {
  task: any;
  onSelfAssign: () => void;
  isSelfAssigning: boolean;
  isLocked?: boolean;
}) {
  return (
    <motion.div
      whileTap={isLocked ? {} : { scale: 0.98 }}
      className={cn(
        'bg-white rounded-xl p-4 border shadow-sm',
        isLocked 
          ? 'border-slate-300 bg-slate-50/50' 
          : 'border-purple-200'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Self-Assign Button with Lock State */}
        <div className="relative">
          <button
            onClick={onSelfAssign}
            disabled={isSelfAssigning || isLocked}
            className={cn(
              'w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all',
              isLocked
                ? 'border-slate-300 bg-slate-100 cursor-not-allowed'
                : isSelfAssigning
                ? 'bg-purple-100 border-purple-500'
                : 'border-purple-300 hover:border-purple-500 hover:bg-purple-50'
            )}
          >
            {isSelfAssigning ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full"
              />
            ) : isLocked ? (
              <Lock className="w-5 h-5 text-slate-400" />
            ) : (
              <Plus className="w-6 h-6 text-purple-500" />
            )}
          </button>
          {/* Lock Badge Below Button */}
          {isLocked && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-slate-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap">
              Locked
            </div>
          )}
        </div>

        {/* Task Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {!isLocked && (
              <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                ⭐ Available
              </span>
            )}
            <h3 className={cn(
              "font-bold truncate",
              isLocked ? "text-slate-600" : "text-slate-900"
            )}>
              {task.title}
            </h3>
          </div>
          {task.description && (
            <p className={cn(
              "text-sm line-clamp-2 mb-2",
              isLocked ? "text-slate-500" : "text-slate-600"
            )}>
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className={cn('badge text-xs', getDifficultyColor(task.difficulty))}>
              {task.difficulty || 'medium'}
            </span>
            {task.requiresPhotoEvidence && (
              <span className="badge bg-slate-100 text-slate-600 text-xs">
                <Camera className="w-3 h-3 mr-1" />
                Photo
              </span>
            )}
          </div>
        </div>

        {/* Points - Always Visible! */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 text-gold-600 font-bold text-lg">
            <Star className="w-5 h-5" />
            <span>{task.pointsValue}</span>
          </div>
          <span className="text-xs text-slate-500">points</span>
        </div>
      </div>

      {/* Self-Assign Button (Mobile) */}
      <div className="mt-4 lg:hidden">
        <Button 
          fullWidth 
          variant={isLocked ? "secondary" : "primary"} 
          onClick={onSelfAssign} 
          loading={isSelfAssigning}
          disabled={isLocked}
        >
          {isLocked ? (
            <>
              <Lock className="w-4 h-4" />
              Complete Main Tasks First
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Pick Up Task
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}