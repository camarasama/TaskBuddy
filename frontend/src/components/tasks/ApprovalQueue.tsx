'use client';

/**
 * components/tasks/ApprovalQueue - approve or reject completed tasks from the parent dashboard.
 *
 * Approving is the core parent loop and the product's north-star metric (families with at least one
 * approved task per week), but it used to sit two navigations away: the dashboard showed only a
 * COUNT of pending approvals and threw the actual list - which the API already returned - away.
 *
 * Evidence thumbnails rely on the dashboard route presigning them (F-4 made evidence private on
 * R2). If a thumbnail ever renders broken, check withEvidenceUrlsList in routes/dashboard.ts before
 * suspecting this component.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getInitials } from '@/lib/utils';

export interface PendingApproval {
  id: string;
  completedAt?: string | null;
  task: {
    id: string;
    title: string;
    pointsValue?: number;
    difficulty?: string;
  };
  child: {
    id: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
  };
  evidence: Array<{
    id: string;
    evidenceType?: string;
    fileUrl?: string | null;
    thumbnailUrl?: string | null;
    /** Singular - matches the DB column and the rest of the UI. */
    note?: string | null;
  }>;
}

/** How many to show inline. The rest live behind the "review all" link. */
const INLINE_LIMIT = 4;

export function ApprovalQueue({
  approvals,
  onResolved,
}: {
  approvals: PendingApproval[];
  /** Called after a successful approve/reject so the parent can refresh its own counters. */
  onResolved: (assignmentId: string, approved: boolean) => void;
}) {
  const { success: showSuccess, error: showError } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Locally hidden rows: keeps the card from flashing back while the parent's refetch is in flight.
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const visible = approvals.filter((a) => !resolved.has(a.id));
  const inline = visible.slice(0, INLINE_LIMIT);

  const handleDecision = async (approval: PendingApproval, approved: boolean) => {
    setBusyId(approval.id);
    try {
      await tasksApi.approveAssignment(approval.id, approved);
      setResolved((prev) => new Set(prev).add(approval.id));
      showSuccess(
        approved
          ? `Approved - ${approval.child.firstName ?? 'your child'} earned their points`
          : 'Sent back for another try',
      );
      onResolved(approval.id, approved);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save that decision');
    } finally {
      setBusyId(null);
    }
  };

  if (visible.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-50 flex items-center justify-center">
          <Check className="w-6 h-6 text-success-600" />
        </div>
        <p className="font-medium text-slate-900">All caught up</p>
        <p className="text-sm text-slate-500 mt-0.5">Nothing is waiting for your approval.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {inline.map((approval) => {
          // A photo row and a note row are separate records, so pick each independently rather
          // than assuming evidence[0] is the photo.
          const photo = approval.evidence?.find((e) => e.thumbnailUrl || e.fileUrl);
          const noteText = approval.evidence?.find((e) => e.note)?.note;
          const thumb = photo?.thumbnailUrl || photo?.fileUrl;
          const childName = approval.child.firstName ?? 'Child';
          const isBusy = busyId === approval.id;

          return (
            <motion.div
              key={approval.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="bg-white rounded-xl border border-warning-200 p-4"
            >
              <div className="flex items-start gap-3">
                {/* Evidence thumbnail, or the child's initials when the task needed no photo */}
                {thumb ? (
                  <Link
                    href={`/parent/tasks/${approval.task.id}`}
                    className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-slate-100"
                  >
                    {/* Presigned R2 URL - a remote host next/image is not configured for, and the
                        URL is short-lived, so optimisation would only add a broken cache entry. */}
                    <Image
                      src={thumb}
                      alt={`Evidence for ${approval.task.title}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </Link>
                ) : (
                  <div className="w-16 h-16 rounded-lg shrink-0 bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold">
                    {getInitials(approval.child.firstName, approval.child.lastName)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{approval.task.title}</p>
                  <p className="text-sm text-slate-500">
                    {childName}
                    {approval.task.pointsValue !== undefined && (
                      <span className="text-gold-600 font-medium"> · {approval.task.pointsValue} pts</span>
                    )}
                  </p>
                  {noteText && (
                    <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                      <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{noteText}</span>
                    </p>
                  )}
                  {approval.completedAt && (
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(approval.completedAt)}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleDecision(approval, true)}
                    disabled={isBusy}
                    aria-label={`Approve ${approval.task.title}`}
                    className={cn(
                      'w-10 h-10 rounded-lg bg-success-500 text-white flex items-center justify-center',
                      'hover:bg-success-600 disabled:opacity-50 transition-colors',
                    )}
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDecision(approval, false)}
                    disabled={isBusy}
                    aria-label={`Send back ${approval.task.title}`}
                    className={cn(
                      'w-10 h-10 rounded-lg border border-slate-200 text-slate-500 flex items-center justify-center',
                      'hover:border-red-300 hover:text-red-500 disabled:opacity-50 transition-colors',
                    )}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {visible.length > INLINE_LIMIT && (
        <Link
          href="/parent/tasks?tab=pending"
          className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-slate-200 text-sm font-medium text-primary-600 hover:border-primary-300 transition-colors"
        >
          <span>Review all {visible.length} pending</span>
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

/** Compact relative time. Kept local - the shared formatters return absolute dates. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
