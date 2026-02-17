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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi, familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const taskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(1000).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  pointsValue: z.number().min(1).max(1000),
  estimatedMinutes: z.number().min(1).max(480).optional(),
  requiresPhotoEvidence: z.boolean(),
  isRecurring: z.boolean(),
  recurrencePattern: z.string().optional(),
  assignedTo: z.array(z.string()).min(1, 'Assign to at least one child'),
  dueDate: z.string().optional(),
});

type TaskForm = z.infer<typeof taskSchema>;

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

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

export default function CreateTaskPage() {
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);

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
      pointsValue: 25,
      requiresPhotoEvidence: false,
      isRecurring: false,
      assignedTo: [],
    },
  });

  const difficulty = watch('difficulty');
  const assignedTo = watch('assignedTo');
  const isRecurring = watch('isRecurring');

  useEffect(() => {
    loadChildren();
  }, []);

  useEffect(() => {
    setValue('pointsValue', suggestedPoints[difficulty]);
  }, [difficulty, setValue]);

  const loadChildren = async () => {
    try {
      const response = await familyApi.getMembers();
      const members = (response.data as { members: Array<{ id: string; firstName: string; lastName: string; role: string }> }).members;
      setChildren(members.filter(m => m.role === 'child'));
    } catch {
      showError('Failed to load children');
    }
  };

  const toggleChild = (childId: string) => {
    const current = assignedTo || [];
    if (current.includes(childId)) {
      setValue('assignedTo', current.filter(id => id !== childId));
    } else {
      setValue('assignedTo', [...current, childId]);
    }
  };

  const onSubmit = async (data: TaskForm) => {
    setIsLoading(true);
    try {
      await tasksApi.create({
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
      });
      showSuccess('Task created successfully!');
      router.push('/parent/tasks');
    } catch {
      showError('Failed to create task');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ParentLayout>
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
          <h1 className="font-display text-3xl font-bold text-slate-900">
            Create New Task
          </h1>
          <p className="text-slate-600 mt-1">
            Assign a task to your children
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Task Details */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">
              Task Details
            </h2>
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

          {/* Difficulty & Points */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">
              Difficulty & Points
            </h2>

            {/* Difficulty Selection */}
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

            {/* Points Input */}
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
                Points are multiplied by the child&apos;s streak bonus and any daily challenge bonuses!
              </p>
            </div>
          </section>

          {/* Assignment */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">
              <Users className="w-5 h-5 inline-block mr-2" />
              Assign To
            </h2>

            {children.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-600 mb-4">No children in your family yet</p>
                <Link href="/parent/children">
                  <Button variant="secondary" size="sm">
                    Add a Child
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => toggleChild(child.id)}
                    className={cn(
                      'p-4 rounded-xl border-2 text-left transition-all',
                      assignedTo?.includes(child.id)
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold">
                        {child.firstName.charAt(0)}
                      </div>
                      <span className="font-medium text-slate-900">
                        {child.firstName}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {errors.assignedTo && (
              <p className="mt-2 text-sm text-red-600">{errors.assignedTo.message}</p>
            )}
          </section>

          {/* Options */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4">
              Options
            </h2>
            <div className="space-y-4">
              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <Calendar className="w-4 h-4 inline-block mr-1" />
                  Due Date (optional)
                </label>
                <Input
                  type="datetime-local"
                  {...register('dueDate')}
                />
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

              {/* Recurring Pattern */}
              {isRecurring && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="pl-8"
                >
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Repeat Pattern
                  </label>
                  <select
                    className="input"
                    {...register('recurrencePattern')}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="weekdays">Weekdays Only</option>
                    <option value="weekends">Weekends Only</option>
                  </select>
                </motion.div>
              )}
            </div>
          </section>

          {/* Submit */}
          <div className="flex gap-4">
            <Link href="/parent/tasks" className="flex-1">
              <Button variant="secondary" fullWidth size="lg">
                Cancel
              </Button>
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
