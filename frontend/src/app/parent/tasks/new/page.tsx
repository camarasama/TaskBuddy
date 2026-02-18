// frontend/src/app/parent/tasks/new/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Star,
  Users,
  Calendar,
  Repeat,
  Camera,
  Info,
  Clock,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi, familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import Link from 'next/link';
// M5 — new components
import {
  OverlapWarningModal,
  type OverlapWarning,
} from '@/components/tasks/OverlapWarningModal';
import {
  ChildCapacityBadge,
  isChildAtLimit,
  type ChildCapacity,
} from '@/components/tasks/ChildCapacityBadge';

// ── Schema ─────────────────────────────────────────────────────────────────────
const taskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(1000).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  // M5 — CR-01
  taskTag: z.enum(['primary', 'secondary']),
  pointsValue: z.number().min(1).max(1000),
  // M5 — CR-09
  startTime: z.string().optional(),
  estimatedMinutes: z.number().min(1).max(480).optional(),
  requiresPhotoEvidence: z.boolean(),
  isRecurring: z.boolean(),
  recurrencePattern: z.string().optional(),
  // Make assignedTo optional - allow creating unassigned tasks
  assignedTo: z.array(z.string()).optional().default([]),
  dueDate: z.string().optional(),
});

type TaskForm = z.infer<typeof taskSchema>;

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const difficultyOptions = [
  { value: 'easy', label: 'Easy', points: '5-15 pts', color: 'success' },
  { value: 'medium', label: 'Medium', points: '15-30 pts', color: 'warning' },
  { value: 'hard', label: 'Hard', points: '30-50 pts', color: 'destructive' },
] as const;

const suggestedPoints: Record<string, number> = {
  easy: 10,
  medium: 25,
  hard: 40,
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CreateTaskPage() {
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);
  // M5 — capacity map: childId → ChildCapacity
  const [capacities, setCapacities] = useState<Record<string, ChildCapacity>>({});
  // M5 — overlap warning state
  const [pendingWarnings, setPendingWarnings] = useState<OverlapWarning[]>([]);
  const [pendingPayload, setPendingPayload] = useState<TaskForm | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      difficulty: 'medium',
      taskTag: 'primary',
      pointsValue: 25,
      requiresPhotoEvidence: false,
      isRecurring: false,
      assignedTo: [],
    },
  });

  const difficulty = watch('difficulty');
  const taskTag = watch('taskTag');
  const assignedTo = watch('assignedTo');
  const isRecurring = watch('isRecurring');

  useEffect(() => { loadChildren(); }, []);

  useEffect(() => {
    setValue('pointsValue', suggestedPoints[difficulty]);
  }, [difficulty, setValue]);

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadChildren = async () => {
    try {
      const response = await familyApi.getMembers();
      const members = (
        response.data as {
          members: Array<{
            id: string;
            firstName: string;
            lastName: string;
            role: string;
          }>;
        }
      ).members;
      const kids = members.filter((m) => m.role === 'child');
      setChildren(kids);
      // Fetch capacity for each child
      await loadCapacities(kids.map((k) => k.id));
    } catch {
      showError('Failed to load children');
    }
  };

  const loadCapacities = async (childIds: string[]) => {
    try {
      // GET /families/children/capacities returns { capacities: { [childId]: ChildCapacity } }
      const response = await familyApi.getChildCapacities(childIds);
      setCapacities(
        (response.data as { capacities: Record<string, ChildCapacity> }).capacities
      );
    } catch {
      // Non-fatal: capacity badges just won't show
    }
  };

  // ── Child selection ──────────────────────────────────────────────────────────
  const toggleChild = (childId: string) => {
    const current = assignedTo || [];
    // If child is at limit for the current taskTag, don't allow selection
    const cap = capacities[childId];
    if (cap && isChildAtLimit(cap, taskTag) && !current.includes(childId)) {
      return; // blocked — button is already visually disabled
    }
    if (current.includes(childId)) {
      setValue('assignedTo', current.filter((id) => id !== childId));
    } else {
      setValue('assignedTo', [...current, childId]);
    }
  };

  // ── Submit flow ───────────────────────────────────────────────────────────────
  const submitTask = async (data: TaskForm, skipWarnings = false) => {
    setIsLoading(true);
    try {
      const payload = {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
        startTime: data.startTime ? new Date(data.startTime).toISOString() : undefined,
      };

      const response = await tasksApi.create(payload);
      const result = response.data as { warnings?: OverlapWarning[] };

      // If API returned overlap warnings AND we haven't acknowledged them yet, show modal
      if (!skipWarnings && result.warnings && result.warnings.length > 0) {
        setPendingWarnings(result.warnings);
        setPendingPayload(data);
        setIsLoading(false);
        return;
      }

      showSuccess('Task created successfully!');
      router.push('/parent/tasks');
    } catch {
      showError('Failed to create task');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = (data: TaskForm) => submitTask(data);

  // Called when parent clicks "Assign Anyway" on the overlap modal
  const handleAssignAnyway = async () => {
    if (!pendingPayload) return;
    setPendingWarnings([]);
    await submitTask(pendingPayload, true);
    setPendingPayload(null);
  };

  const handleGoBack = () => {
    setPendingWarnings([]);
    setPendingPayload(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
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

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/parent/tasks"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Tasks</span>
          </Link>
          <h1 className="font-display text-3xl font-bold text-slate-900">Create New Task</h1>
          <p className="text-slate-600 mt-1">Assign a task to your children</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* ── Task Details ────────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">Task Details</h2>
            <div className="space-y-4">
              <Input
                label="Task Title"
                placeholder="e.g., Clean your room"
                error={errors.title?.message}
                {...register('title')}
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  className="input min-h-[100px] resize-none"
                  placeholder="Add more details about the task..."
                  {...register('description')}
                />
              </div>
            </div>
          </section>

          {/* ── M5: Task Tag — Primary / Secondary ─────────────────────────── */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Task Type
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Primary tasks must be done first. Secondary (bonus) tasks can be self-assigned by
              children once their primary tasks are complete.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    value: 'primary',
                    label: '⭐ Primary',
                    desc: 'Must-do task',
                    active: 'border-primary-500 bg-primary-50',
                  },
                  {
                    value: 'secondary',
                    label: '🎁 Secondary',
                    desc: 'Bonus / optional',
                    active: 'border-success-500 bg-success-50',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setValue('taskTag', opt.value)}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left transition-all',
                    taskTag === opt.value ? opt.active : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <p className="font-bold text-slate-900">{opt.label}</p>
                  <p className="text-sm text-slate-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* ── Difficulty & Points ─────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">
              Difficulty & Points
            </h2>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Difficulty Level
              </label>
              <div className="grid grid-cols-3 gap-3">
                {difficultyOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('difficulty', option.value)}
                    className={cn(
                      'p-4 rounded-xl border-2 text-center transition-all',
                      difficulty === option.value
                        ? option.color === 'success'
                          ? 'border-success-500 bg-success-50'
                          : option.color === 'warning'
                          ? 'border-warning-500 bg-warning-50'
                          : 'border-red-500 bg-red-50'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <p className="font-bold text-slate-900">{option.label}</p>
                    <p className="text-sm text-slate-500">{option.points}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Input
                  label="Points Reward"
                  type="number"
                  error={errors.pointsValue?.message}
                  {...register('pointsValue', { valueAsNumber: true })}
                />
              </div>
              <div className="pt-6 flex items-center gap-2 text-gold-600">
                <Star className="w-5 h-5" />
                <span className="font-bold">pts</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-primary-50 rounded-lg flex items-start gap-2">
              <Info className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-primary-800">
                Points are multiplied by the child&apos;s streak bonus and any daily challenge
                bonuses!
              </p>
            </div>
          </section>

          {/* ── Assignment with Capacity Badges ────────────────────────────── */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-1">
              <Users className="w-5 h-5 inline-block mr-2" />
              Assign To
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Optional — you can assign children now or leave unassigned for later
            </p>
            {children.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-600 mb-4">No children in your family yet</p>
                <Link href="/parent/children">
                  <Button variant="secondary" size="sm">Add a Child</Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {children.map((child) => {
                  const cap = capacities[child.id];
                  const blocked = cap ? isChildAtLimit(cap, taskTag) : false;
                  const selected = assignedTo?.includes(child.id);

                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => toggleChild(child.id)}
                      disabled={blocked && !selected}
                      title={blocked ? 'This child is at their task limit' : undefined}
                      className={cn(
                        'p-4 rounded-xl border-2 text-left transition-all',
                        selected
                          ? 'border-primary-500 bg-primary-50'
                          : blocked
                          ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                          : 'border-slate-200 hover:border-slate-300'
                      )}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                          {child.firstName.charAt(0)}
                        </div>
                        <span className="font-medium text-slate-900">{child.firstName}</span>
                      </div>
                      {/* M5 — capacity badge */}
                      {cap && (
                        <ChildCapacityBadge
                          capacity={cap}
                          taskTag={taskTag}
                          className="mt-1"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Options ─────────────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">Options</h2>
            <div className="space-y-4">
              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <Calendar className="w-4 h-4 inline-block mr-1" />
                  Due Date (optional)
                </label>
                <Input type="datetime-local" {...register('dueDate')} />
              </div>

              {/* M5 — CR-09: Start Time */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <Clock className="w-4 h-4 inline-block mr-1" />
                  Start Time (optional)
                </label>
                <Input
                  type="datetime-local"
                  {...register('startTime')}
                />
                <p className="text-xs text-slate-400 mt-1">
                  Used to detect schedule conflicts with other tasks.
                </p>
              </div>

              {/* M5 — CR-09: Estimated Duration */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Estimated Duration (optional)
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    placeholder="e.g. 30"
                    {...register('estimatedMinutes', { valueAsNumber: true })}
                  />
                  <span className="text-sm text-slate-500 whitespace-nowrap">minutes</span>
                </div>
                {errors.estimatedMinutes && (
                  <p className="text-sm text-red-600 mt-1">{errors.estimatedMinutes.message}</p>
                )}
              </div>

              {/* Photo Required */}
              <label className="flex items-center justify-between p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-slate-600" />
                  <div>
                    <p className="font-medium text-slate-900">Require Photo Proof</p>
                    <p className="text-sm text-slate-500">Child must submit a photo when completing</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded text-primary-600"
                  {...register('requiresPhotoEvidence')}
                />
              </label>

              {/* Recurring */}
              <label className="flex items-center justify-between p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <Repeat className="w-5 h-5 text-slate-600" />
                  <div>
                    <p className="font-medium text-slate-900">Recurring Task</p>
                    <p className="text-sm text-slate-500">Automatically repeat this task</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded text-primary-600"
                  {...register('isRecurring')}
                />
              </label>

              {isRecurring && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="pl-8"
                >
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Repeat Pattern
                  </label>
                  <select className="input" {...register('recurrencePattern')}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="weekdays">Weekdays Only</option>
                    <option value="weekends">Weekends Only</option>
                  </select>
                </motion.div>
              )}
            </div>
          </section>

          {/* ── Submit ──────────────────────────────────────────────────────── */}
          <div className="flex gap-4">
            <Link href="/parent/tasks" className="flex-1">
              <Button variant="secondary" fullWidth size="lg">Cancel</Button>
            </Link>
            <Button type="submit" fullWidth size="lg" loading={isLoading} className="flex-1">
              Create Task
            </Button>
          </div>
        </form>
      </div>
    </ParentLayout>
  );
}