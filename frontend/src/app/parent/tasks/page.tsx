//parent tasks page

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  XCircle,
  Star,
  ChevronRight,
  Camera,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getDifficultyColor, getStatusColor, formatDate } from '@/lib/utils';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  description?: string;
  difficulty: string;
  pointsValue: number;
  status: string;
  assignments?: TaskAssignment[];
  createdAt: string;
}

interface TaskEvidence {
  id: string;
  evidenceType: string;
  fileUrl?: string;
  note?: string;
  mimeType?: string;
  uploadedAt: string;
}

interface TaskAssignment {
  id: string;
  status: string;
  child: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  };
  task?: {
    id: string;
    title: string;
    pointsValue: number;
    difficulty: string;
  };
  evidence?: TaskEvidence[];
  completedAt?: string;
  approvedAt?: string;
}

type TabType = 'all' | 'pending' | 'completed';

export default function ParentTasksPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabType) || 'all';

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<TaskAssignment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { error: showError, success: showSuccess } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [tasksRes, pendingRes] = await Promise.all([
        tasksApi.getAll(),
        tasksApi.getPendingApprovals(),
      ]);
      setTasks((tasksRes.data as { tasks: Task[] }).tasks);
      setPendingApprovals((pendingRes.data as { assignments: TaskAssignment[] }).assignments);
    } catch {
      showError('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (assignmentId: string, approved: boolean) => {
    try {
      await tasksApi.approveAssignment(assignmentId, approved);
      showSuccess(approved ? 'Task approved!' : 'Task rejected');
      loadData();
    } catch {
      showError('Failed to update task');
    }
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description?.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTab === 'completed') {
      // Show tasks that have at least one approved assignment
      return task.assignments?.some(a => a.status === 'approved') || false;
    }

    return true;
  });

  const completedCount = tasks.filter(t => t.assignments?.some(a => a.status === 'approved')).length;

  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: 'all', label: 'All Tasks', count: tasks.length },
    { key: 'pending', label: 'Pending Approval', count: pendingApprovals.length },
    { key: 'completed', label: 'Completed', count: completedCount },
  ];

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-slate-900">Tasks</h1>
            <p className="text-slate-600 mt-1">Manage and track family tasks</p>
          </div>
          <Link href="/parent/tasks/new">
            <Button>
              <Plus className="w-4 h-4" />
              Create Task
            </Button>
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-4 py-3 font-medium text-sm border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  'ml-2 px-2 py-0.5 rounded-full text-xs',
                  activeTab === tab.key ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-600'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        {activeTab !== 'pending' && (
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12"
            />
          </div>
        )}

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'pending' ? (
            <motion.div
              key="pending"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {pendingApprovals.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No pending approvals"
                  description="All tasks are up to date"
                />
              ) : (
                pendingApprovals.map((assignment) => (
                  <PendingApprovalCard
                    key={assignment.id}
                    assignment={assignment}
                    onApprove={() => handleApprove(assignment.id, true)}
                    onReject={() => handleApprove(assignment.id, false)}
                  />
                ))
              )}
            </motion.div>
          ) : (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {filteredTasks.length === 0 ? (
                <EmptyState
                  icon={Filter}
                  title={searchQuery ? 'No matching tasks' : 'No tasks yet'}
                  description={searchQuery ? 'Try a different search term' : 'Create your first task to get started'}
                  action={
                    !searchQuery && (
                      <Link href="/parent/tasks/new">
                        <Button>
                          <Plus className="w-4 h-4" />
                          Create Task
                        </Button>
                      </Link>
                    )
                  }
                />
              ) : (
                filteredTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ParentLayout>
  );
}

// Task Card Component
function TaskCard({ task }: { task: Task }) {
  const assignedCount = task.assignments?.length || 0;
  const completedCount = task.assignments?.filter(a => a.status === 'approved').length || 0;

  return (
    <Link href={`/parent/tasks/${task.id}`}>
      <motion.div
        whileHover={{ scale: 1.01 }}
        className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:border-primary-300 hover:shadow-md transition-all"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold text-slate-900 truncate">{task.title}</h3>
              <span className={cn('badge', getDifficultyColor(task.difficulty))}>
                {task.difficulty}
              </span>
            </div>
            {task.description && (
              <p className="text-sm text-slate-600 line-clamp-2 mb-3">
                {task.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <span className={cn('badge', getStatusColor(task.status))}>
                {task.status.replace('_', ' ')}
              </span>
              {assignedCount > 0 && (
                <span className="text-slate-500">
                  {completedCount}/{assignedCount} completed
                </span>
              )}
              {task.assignments && task.assignments.length > 0 && (
                <span className="text-slate-400">
                  {task.assignments.map(a => a.child?.firstName).filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 text-gold-600 font-bold">
              <Star className="w-4 h-4" />
              <span>{task.pointsValue}</span>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

// Pending Approval Card
function PendingApprovalCard({
  assignment,
  onApprove,
  onReject,
}: {
  assignment: TaskAssignment;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const photos = assignment.evidence?.filter(e => e.evidenceType === 'photo' && e.fileUrl) || [];
  const notes = assignment.evidence?.filter(e => e.evidenceType === 'note' && e.note) || [];

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl p-5 border border-warning-200 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-warning-500" />
          <span className="font-bold text-slate-900">
            {assignment.child?.firstName || 'Child'} completed {assignment.task?.title || 'a task'}
          </span>
        </div>

        <p className="text-sm text-slate-600 mb-3">
          Completed on {assignment.completedAt ? formatDate(assignment.completedAt) : 'N/A'}
        </p>

        {/* Photo Evidence */}
        {photos.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-2">
              <Camera className="w-4 h-4" />
              <span>Photo evidence ({photos.length})</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((evidence) => (
                <button
                  key={evidence.id}
                  onClick={() => setExpandedPhoto(evidence.fileUrl || '')}
                  className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-slate-200 hover:border-primary-400 transition-colors"
                >
                  <img
                    src={evidence.fileUrl}
                    alt="Task evidence"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Note Evidence */}
        {notes.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-1">
              <FileText className="w-4 h-4" />
              <span>Notes</span>
            </div>
            {notes.map((evidence) => (
              <div key={evidence.id} className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700">
                {evidence.note}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="success" size="sm" onClick={onApprove}>
            <CheckCircle2 className="w-4 h-4" />
            Approve
          </Button>
          <Button variant="ghost" size="sm" onClick={onReject}>
            <XCircle className="w-4 h-4" />
            Reject
          </Button>
        </div>
      </motion.div>

      {/* Full-screen photo viewer */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setExpandedPhoto(null)}
        >
          <div className="relative max-w-2xl w-full">
            <img
              src={expandedPhoto}
              alt="Evidence photo"
              className="w-full max-h-[80vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setExpandedPhoto(null)}
              className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
            >
              <XCircle className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Empty State Component
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
        <Icon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 mb-4">{description}</p>
      {action}
    </div>
  );
}
