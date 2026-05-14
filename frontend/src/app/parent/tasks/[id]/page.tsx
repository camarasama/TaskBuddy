// frontend/src/app/parent/tasks/[id]/edit/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Loader2, Clock, Tag, UserPlus, X, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi, familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
// M5 — overlap modal
import {
  OverlapWarningModal,
  type OverlapWarning,
} from '@/components/tasks/OverlapWarningModal';

// ── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  // M5 — CR-01
  taskTag: 'primary' | 'secondary';
  pointsValue: number;
  xpValue: number;
  requiresPhotoEvidence: boolean;
  dueDate?: string;
  // M5 — CR-09
  startTime?: string;
  estimatedMinutes?: number;
  status: 'active' | 'paused' | 'archived';
  isRecurring: boolean;
  recurrencePattern?: string;
  assignments?: {
    id: string;
    status: string;
    child: { id: string; firstName: string; lastName: string };
  }[];
}

interface FormState {
  title: string;
  description: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  // M5 — CR-01
  taskTag: 'primary' | 'secondary';
  pointsValue: string;
  dueDate: string;
  // M5 — CR-09
  startTime: string;
  estimatedMinutes: string;
  requiresPhotoEvidence: boolean;
  status: 'active' | 'paused' | 'archived';
  maxClaimsTotal: string;
  isRecurring: boolean;
  recurrencePattern: string;
}

// ── Option arrays ────────────────────────────────────────────────────────────
const DIFFICULTY_OPTIONS: { value: FormState['difficulty']; label: string; color: string }[] = [
  { value: 'easy',   label: 'Easy',   color: 'border-green-400 bg-green-50 text-green-700' },
  { value: 'medium', label: 'Medium', color: 'border-yellow-400 bg-yellow-50 text-yellow-700' },
  { value: 'hard',   label: 'Hard',   color: 'border-red-400 bg-red-50 text-red-700' },
];

const STATUS_OPTIONS: { value: FormState['status']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  // 'archived' is intentionally absent — use the Archive button on the task list
];

// ── Page ────────────────────────────────────────────────────────────────────
export default function EditTaskPage() {
  const params = useParams();
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();

  const taskId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    category: '',
    difficulty: 'medium',
    taskTag: 'primary',
    pointsValue: '',
    dueDate: '',
    startTime: '',
    estimatedMinutes: '',
    requiresPhotoEvidence: false,
    status: 'active',
    maxClaimsTotal: '',
    isRecurring: false,
    recurrencePattern: 'daily',
  });

  // M5 — overlap warning state
  const [pendingWarnings, setPendingWarnings] = useState<OverlapWarning[]>([]);
  const [familyChildren, setFamilyChildren] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [addingChild, setAddingChild] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // ── Load task ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadTask = async () => {
      try {
        const response = await tasksApi.getById(taskId);
        const data = response.data as { task: Task };
        const t = data.task;

        setTask(t);
        setForm({
          title: t.title,
          description: t.description ?? '',
          category: t.category ?? '',
          difficulty: t.difficulty,
          taskTag: t.taskTag ?? 'primary',
          pointsValue: String(t.pointsValue),
          dueDate: t.dueDate ? t.dueDate.slice(0, 16) : '',
          startTime: t.startTime ? t.startTime.slice(0, 16) : '',
          estimatedMinutes: t.estimatedMinutes != null ? String(t.estimatedMinutes) : '',
          maxClaimsTotal: (t as any).maxClaimsTotal != null ? String((t as any).maxClaimsTotal) : '',
          requiresPhotoEvidence: t.requiresPhotoEvidence,
          status: t.status,
          isRecurring: t.isRecurring,
          recurrencePattern: t.recurrencePattern ?? 'daily',
        });
      } catch {
        showError('Failed to load task');
        router.push('/parent/tasks');
      } finally {
        setIsLoading(false);
      }
    };

    if (taskId) loadTask();
    // Load family children for reassign dropdown
    familyApi.getMembers().then((res) => {
      const members = (res.data as any).members ?? [];
      setFamilyChildren(members.filter((m: any) => m.role === 'child').map((m: any) => ({
        id: m.id, firstName: m.firstName, lastName: m.lastName,
      })));
    }).catch(() => {});
  }, [taskId, showError, router]);

  const handleUnassign = async (childId: string) => {
    try {
      await tasksApi.unassignChild(taskId, childId);
      setTask((prev) => prev ? { ...prev, assignments: prev.assignments?.filter((a) => a.child.id !== childId) } : prev);
      showSuccess('Child removed from task');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to remove assignment');
    }
  };

  const handleAssignChild = async () => {
    if (!addingChild) return;
    setIsAssigning(true);
    try {
      await tasksApi.assignChild(taskId, addingChild);
      const child = familyChildren.find((c) => c.id === addingChild);
      if (child) {
        setTask((prev) => prev ? {
          ...prev,
          assignments: [...(prev.assignments ?? []), { id: Date.now().toString(), status: 'pending', child }],
        } : prev);
      }
      setAddingChild('');
      showSuccess('Child assigned to task');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to assign child');
    } finally {
      setIsAssigning(false);
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleDifficultySelect = (value: FormState['difficulty']) =>
    setForm((prev) => ({ ...prev, difficulty: value }));

  const handleTagSelect = (value: FormState['taskTag']) =>
    setForm((prev) => ({ ...prev, taskTag: value }));

  const performSave = async (skipWarnings = false) => {
    if (!form.title.trim()) { showError('Task title is required'); return; }

    const pointsNum = parseInt(form.pointsValue, 10);
    if (isNaN(pointsNum) || pointsNum < 1 || pointsNum > 1000) {
      showError('Points must be between 1 and 1000');
      return;
    }

    const estimatedNum = form.estimatedMinutes ? parseInt(form.estimatedMinutes, 10) : undefined;
    if (form.estimatedMinutes && (isNaN(estimatedNum!) || estimatedNum! < 1 || estimatedNum! > 480)) {
      showError('Duration must be between 1 and 480 minutes');
      return;
    }

    if (form.dueDate && new Date(form.dueDate) <= new Date()) {
      showError('Due date must be in the future');
      return;
    }

    setIsSaving(true);
    try {
      const response = await tasksApi.update(taskId, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        difficulty: form.difficulty,
        taskTag: form.taskTag,
        pointsValue: pointsNum,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
        estimatedMinutes: estimatedNum ?? undefined,
        requiresPhotoEvidence: form.requiresPhotoEvidence,
        status: form.status,
        maxClaimsTotal: form.maxClaimsTotal ? parseInt(form.maxClaimsTotal, 10) : null,
        isRecurring: form.isRecurring,
        recurrencePattern: form.isRecurring ? form.recurrencePattern : undefined,
      } as any);

      const result = response.data as { warnings?: OverlapWarning[] };

      // M5 — show overlap modal if warnings come back and not yet acknowledged
      if (!skipWarnings && result.warnings && result.warnings.length > 0) {
        setPendingWarnings(result.warnings);
        setIsSaving(false);
        return;
      }

      showSuccess('Task updated');
      router.push(`/parent/tasks/${taskId}`);
    } catch {
      showError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = () => performSave();
  const handleAssignAnyway = async () => { setPendingWarnings([]); await performSave(true); };
  const handleGoBack = () => setPendingWarnings([]);

  // ── Loading / not-found states ──────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ParentLayout>
      {/* M5 — Overlap Warning Modal */}
      {pendingWarnings.length > 0 && (
        <OverlapWarningModal
          warnings={pendingWarnings}
          onAssignAnyway={handleAssignAnyway}
          onGoBack={handleGoBack}
        />
      )}

      <div className="space-y-6 max-w-2xl mx-auto">
        <Link
          href="/parent/tasks"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Tasks</span>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6"
        >
          <h1 className="font-display text-2xl font-bold text-slate-900">Edit Task</h1>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              maxLength={200}
              placeholder="e.g. Clean your room"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              maxLength={1000}
              rows={3}
              placeholder="Add more detail about what needs to be done…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Category <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              name="category"
              value={form.category}
              onChange={handleChange}
              maxLength={50}
              placeholder="e.g. Chores, Homework, Exercise"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* M5 — CR-01: Task Tag */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
              <Tag className="w-4 h-4" />
              Task Type
            </label>
            <div className="flex gap-3">
              {(
                [
                  { value: 'primary',   label: '⭐ Primary',   active: 'border-primary-500 bg-primary-50 text-primary-700' },
                  { value: 'secondary', label: '🎁 Secondary', active: 'border-success-500 bg-success-50 text-success-700' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTagSelect(opt.value)}
                  className={cn(
                    'flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                    form.taskTag === opt.value
                      ? opt.active
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Difficulty</label>
            <div className="flex gap-3">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleDifficultySelect(opt.value)}
                  className={cn(
                    'flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                    form.difficulty === opt.value
                      ? opt.color + ' border-current'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Points */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Points <span className="text-red-500">*</span>
            </label>
            <input
              name="pointsValue"
              type="number"
              value={form.pointsValue}
              onChange={handleChange}
              min={1}
              max={1000}
              placeholder="e.g. 50"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Due Date <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              name="dueDate"
              type="datetime-local"
              value={form.dueDate}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* M5 — CR-09: Start Time */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              Start Time <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              name="startTime"
              type="datetime-local"
              value={form.startTime}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-slate-400 mt-1">
              Used to detect schedule conflicts with other tasks.
            </p>
          </div>

          {/* M5 — CR-09: Estimated Duration */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Estimated Duration <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                name="estimatedMinutes"
                type="number"
                value={form.estimatedMinutes}
                onChange={handleChange}
                min={1}
                max={480}
                placeholder="e.g. 30"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <span className="text-sm text-slate-500 whitespace-nowrap">minutes</span>
            </div>
          </div>

          {/* Max claims from pool */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Max claims from pool <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                name="maxClaimsTotal"
                type="number"
                value={form.maxClaimsTotal}
                onChange={handleChange}
                min={1}
                max={100}
                placeholder="e.g. 3"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <span className="text-sm text-slate-500 whitespace-nowrap">children</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">How many different children can claim this from the pool.</p>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Photo Evidence */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              name="requiresPhotoEvidence"
              type="checkbox"
              checked={form.requiresPhotoEvidence}
              onChange={handleChange}
              className="w-4 h-4 text-primary-500 border-slate-300 rounded focus:ring-primary-500"
            />
            <span className="text-sm font-medium text-slate-700">Require photo evidence</span>
          </label>

          {/* Recurring schedule */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer mb-2">
              <input
                name="isRecurring"
                type="checkbox"
                checked={form.isRecurring}
                onChange={handleChange}
                className="w-4 h-4 text-primary-500 border-slate-300 rounded focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Repeat className="w-4 h-4" /> Recurring Task
              </span>
            </label>
            {form.isRecurring && (
              <select
                name="recurrencePattern"
                value={form.recurrencePattern}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="weekdays">Weekdays Only</option>
                <option value="weekends">Weekends Only</option>
              </select>
            )}
          </div>

          {/* Assignments — reassignable */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4" /> Assigned to
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {(task.assignments ?? []).filter((a) => ['pending', 'in_progress'].includes(a.status)).map((a) => (
                <span key={a.child.id} className="flex items-center gap-1.5 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm font-medium">
                  {a.child.firstName} {a.child.lastName}
                  <button type="button" onClick={() => handleUnassign(a.child.id)} className="hover:text-red-500 ml-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              {(task.assignments ?? []).filter((a) => ['pending', 'in_progress'].includes(a.status)).length === 0 && (
                <span className="text-sm text-slate-400">No active assignments</span>
              )}
            </div>
            {familyChildren.length > 0 && (
              <div className="flex gap-2">
                <select
                  value={addingChild}
                  onChange={(e) => setAddingChild(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="">Add a child…</option>
                  {familyChildren
                    .filter((c) => !(task.assignments ?? []).filter((a) => ['pending', 'in_progress'].includes(a.status)).some((a) => a.child.id === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                    ))}
                </select>
                <Button size="sm" onClick={handleAssignChild} disabled={!addingChild || isAssigning} loading={isAssigning}>
                  Assign
                </Button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <Link href={`/parent/tasks/${taskId}`} className="flex-1">
              <Button variant="secondary" className="w-full">Cancel</Button>
            </Link>
            <Button
              onClick={handleSubmit}
              loading={isSaving}
              className="flex-1 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Changes
            </Button>
          </div>
        </motion.div>
      </div>
    </ParentLayout>
  );
}