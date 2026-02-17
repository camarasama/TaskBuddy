'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Star,
  Camera,
  Repeat,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime, getDifficultyColor } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pointsValue: number;
  xpValue: number;
  requiresPhotoEvidence: boolean;
  recurrencePattern?: string;
  dueDate?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  assignments?: TaskAssignment[];
}

interface TaskAssignment {
  id: string;
  status: string;
  instanceDate: string;
  completedAt?: string;
  approvedAt?: string;
  child: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export default function TaskDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const taskId = params.id as string;

  useEffect(() => {
    const loadTask = async () => {
      try {
        const response = await tasksApi.getById(taskId);
        const data = response.data as { task: Task };
        setTask(data.task);
      } catch {
        showError('Failed to load task details');
        router.push('/parent/tasks');
      } finally {
        setIsLoading(false);
      }
    };

    if (taskId) {
      loadTask();
    }
  }, [taskId, showError, router]);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    setIsDeleting(true);
    try {
      await tasksApi.delete(taskId);
      showSuccess('Task deleted');
      router.push('/parent/tasks');
    } catch {
      showError('Failed to delete task');
    } finally {
      setIsDeleting(false);
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

  const difficultyLabels = {
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
  };

  const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
    active: { icon: Clock, color: 'text-blue-600 bg-blue-50', label: 'Active' },
    completed: { icon: CheckCircle2, color: 'text-yellow-600 bg-yellow-50', label: 'Pending Approval' },
    approved: { icon: CheckCircle2, color: 'text-green-600 bg-green-50', label: 'Approved' },
    rejected: { icon: XCircle, color: 'text-red-600 bg-red-50', label: 'Rejected' },
    paused: { icon: AlertCircle, color: 'text-slate-600 bg-slate-50', label: 'Paused' },
  };

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Back Button */}
        <Link
          href="/parent/tasks"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Tasks</span>
        </Link>

        {/* Header Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(task.difficulty.toUpperCase())}`}
                >
                  {difficultyLabels[task.difficulty]}
                </span>
                {task.recurrencePattern && (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-600 flex items-center gap-1">
                    <Repeat className="w-3 h-3" />
                    Recurring
                  </span>
                )}
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">
                {task.title}
              </h1>
              {task.description && (
                <p className="text-slate-600">{task.description}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Link href={`/parent/tasks/${taskId}/edit`}>
                <Button variant="secondary" size="sm">
                  <Edit2 className="w-4 h-4" />
                  Edit
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDelete}
                loading={isDeleting}
                className="text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </div>
          </div>

          {/* Task Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gold-50 flex items-center justify-center">
                <Star className="w-4 h-4 text-gold-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Points</p>
                <p className="font-bold text-slate-900">{task.pointsValue}</p>
              </div>
            </div>

            {task.dueDate && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Due Date</p>
                  <p className="font-bold text-slate-900">{formatDate(task.dueDate)}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-xp-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-xp-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">XP Reward</p>
                <p className="font-bold text-slate-900">{task.xpValue} XP</p>
              </div>
            </div>

            {task.requiresPhotoEvidence && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Photo</p>
                  <p className="font-bold text-slate-900">Required</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Assignments */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl p-6 border border-slate-200"
        >
          <h2 className="font-display text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-primary-500" />
            Assignments
          </h2>

          {task.assignments && task.assignments.length > 0 ? (
            <div className="space-y-3">
              {task.assignments.map((assignment) => {
                const config = statusConfig[assignment.status] || statusConfig.active;
                const StatusIcon = config.icon;

                return (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold">
                        {assignment.child.firstName.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">
                          {assignment.child.firstName} {assignment.child.lastName}
                        </p>
                        <p className="text-sm text-slate-500">
                          {formatDate(assignment.instanceDate)}
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${config.color}`}>
                      <StatusIcon className="w-4 h-4" />
                      <span className="text-sm font-medium">{config.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <User className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p>No assignments yet</p>
              <p className="text-sm">Assign this task to a child to get started</p>
            </div>
          )}
        </motion.div>

        {/* Metadata */}
        <div className="text-sm text-slate-500 flex gap-4">
          <span>Created {formatDateTime(task.createdAt)}</span>
          <span>Last updated {formatDateTime(task.updatedAt)}</span>
        </div>
      </div>
    </ParentLayout>
  );
}
