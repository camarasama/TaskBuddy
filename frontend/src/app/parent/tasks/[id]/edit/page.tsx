'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface Task {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pointsValue: number;
  xpValue: number;
  requiresPhotoEvidence: boolean;
  dueDate?: string;
  status: 'active' | 'paused' | 'archived';
  assignments?: {
    child: {
      id: string;
      firstName: string;
      lastName: string;
    };
  }[];
}

interface FormState {
  title: string;
  description: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pointsValue: string;
  dueDate: string;
  requiresPhotoEvidence: boolean;
  status: 'active' | 'paused' | 'archived';
}

const DIFFICULTY_OPTIONS: { value: FormState['difficulty']; label: string; color: string }[] = [
  { value: 'easy', label: 'Easy', color: 'border-green-400 bg-green-50 text-green-700' },
  { value: 'medium', label: 'Medium', color: 'border-yellow-400 bg-yellow-50 text-yellow-700' },
  { value: 'hard', label: 'Hard', color: 'border-red-400 bg-red-50 text-red-700' },
];

const STATUS_OPTIONS: { value: FormState['status']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

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
    pointsValue: '',
    dueDate: '',
    requiresPhotoEvidence: false,
    status: 'active',
  });

  // Load existing task data and pre-fill form
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
          pointsValue: String(t.pointsValue),
          // Convert ISO datetime to the yyyy-MM-ddTHH:mm format for <input type="datetime-local">
          dueDate: t.dueDate ? t.dueDate.slice(0, 16) : '',
          requiresPhotoEvidence: t.requiresPhotoEvidence,
          status: t.status,
        });
      } catch {
        showError('Failed to load task');
        router.push('/parent/tasks');
      } finally {
        setIsLoading(false);
      }
    };

    if (taskId) loadTask();
  }, [taskId, showError, router]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleDifficultySelect = (value: FormState['difficulty']) => {
    setForm((prev) => ({ ...prev, difficulty: value }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      showError('Task title is required');
      return;
    }

    const pointsNum = parseInt(form.pointsValue, 10);
    if (isNaN(pointsNum) || pointsNum < 1 || pointsNum > 1000) {
      showError('Points must be between 1 and 1000');
      return;
    }

    setIsSaving(true);
    try {
      await tasksApi.update(taskId, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        difficulty: form.difficulty,
        pointsValue: pointsNum,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        requiresPhotoEvidence: form.requiresPhotoEvidence,
        status: form.status,
      });

      showSuccess('Task updated');
      router.push(`/parent/tasks/${taskId}`);
    } catch {
      showError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

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
            <Button variant="secondary" className="mt-4">
              Back to Tasks
            </Button>
          </Link>
        </div>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Back to detail */}
        <Link
          href={`/parent/tasks/${taskId}`}
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Task</span>
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

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Difficulty</label>
            <div className="flex gap-3">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleDifficultySelect(opt.value)}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    form.difficulty === opt.value
                      ? opt.color + ' border-current'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
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
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Photo Evidence Toggle */}
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

          {/* Assigned children — read-only info, not editable here */}
          {task.assignments && task.assignments.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Assigned to</p>
              <div className="flex flex-wrap gap-2">
                {task.assignments.map((a) => (
                  <span
                    key={a.child.id}
                    className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm font-medium"
                  >
                    {a.child.firstName} {a.child.lastName}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                To change assignments, delete and recreate the task.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <Link href={`/parent/tasks/${taskId}`} className="flex-1">
              <Button variant="secondary" className="w-full">
                Cancel
              </Button>
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
