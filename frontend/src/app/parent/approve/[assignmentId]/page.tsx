'use client';

/**
 * /parent/approve/[assignmentId] — the single-tap approval screen (growth roadmap §3.4).
 *
 * Approval latency is the loop's heartbeat: a child who waits a day for their points disengages.
 * Every "task submitted" email and push now lands here rather than making a parent navigate.
 *
 * The state that needed the most care is the CO-PARENT RACE. Two adults both get the push, both
 * tap it, and the second one must see "already approved by Sam" — a calm, finished state — rather
 * than an error that reads like a bug. The endpoint returns resolved assignments for exactly this
 * reason instead of 404ing on them.
 *
 * (Before this page existed the email CTA pointed at /parent/tasks/assignments/{id}, a route that
 * has never existed — so every Review Submission click 404'd.)
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, X, Loader2, ArrowLeft, Star, MessageSquare, CheckCircle2 } from 'lucide-react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { Button } from '@/components/ui/Button';
import { tasksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getInitials } from '@/lib/utils';

interface AssignmentView {
  id: string;
  status: string;
  completedAt?: string | null;
  task: { id: string; title: string; description?: string | null; pointsValue: number };
  child: { id: string; firstName?: string; lastName?: string };
  evidence: Array<{
    id: string;
    evidenceType?: string;
    fileUrl?: string | null;
    thumbnailUrl?: string | null;
    note?: string | null;
  }>;
}

type Screen = 'loading' | 'pending' | 'resolved' | 'done' | 'missing';

/** Bonus options, as taps rather than a free-text field — this screen is meant to take seconds. */
const BONUS_OPTIONS = [0, 5, 10, 20];

export default function ApprovePage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = String(params.assignmentId ?? '');
  const { success: showSuccess, error: showError } = useToast();

  const [screen, setScreen] = useState<Screen>('loading');
  const [assignment, setAssignment] = useState<AssignmentView | null>(null);
  const [resolvedByName, setResolvedByName] = useState<string | null>(null);
  const [bonus, setBonus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await tasksApi.getAssignment(assignmentId);
      const data = res.data as {
        assignment: AssignmentView;
        isPending: boolean;
        resolvedByName: string | null;
      };
      setAssignment(data.assignment);
      setResolvedByName(data.resolvedByName);
      setScreen(data.isPending ? 'pending' : 'resolved');
    } catch {
      // Deleted task, wrong family, or a stale link from an old email.
      setScreen('missing');
    }
  }, [assignmentId]);

  useEffect(() => {
    if (!assignmentId) {
      setScreen('missing');
      return;
    }
    void load();
  }, [assignmentId, load]);

  const decide = async (approved: boolean) => {
    setBusy(true);
    try {
      await tasksApi.approveAssignment(assignmentId, approved, undefined, approved ? bonus : undefined);
      setOutcome(approved ? 'approved' : 'rejected');
      setScreen('done');
      showSuccess(approved ? 'Approved — points awarded' : 'Sent back for another try');
    } catch (err) {
      // Most likely cause: a co-parent resolved it between load and tap. Re-read rather than
      // showing a raw conflict error.
      showError(err instanceof Error ? err.message : 'Could not save that decision');
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (screen === 'loading') {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      </ParentLayout>
    );
  }

  if (screen === 'missing') {
    return (
      <ParentLayout>
        <Shell>
          <p className="font-bold text-slate-900 mb-1">That task isn’t here any more</p>
          <p className="text-sm text-slate-500 mb-4">
            It may have been deleted, or the link is from an old email.
          </p>
          <Link href="/parent/tasks?tab=pending">
            <Button>See what’s waiting</Button>
          </Link>
        </Shell>
      </ParentLayout>
    );
  }

  const childName = assignment?.child.firstName ?? 'Your child';

  // AC-U5c — the co-parent race. A finished state, not an error.
  if (screen === 'resolved') {
    return (
      <ParentLayout>
        <Shell>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-50 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-success-600" />
          </div>
          <p className="font-bold text-slate-900 mb-1">Already handled</p>
          <p className="text-sm text-slate-500 mb-4">
            {resolvedByName
              ? `${resolvedByName} has already reviewed “${assignment?.task.title}”.`
              : `“${assignment?.task.title}” has already been reviewed.`}
          </p>
          <Link href="/parent/tasks?tab=pending">
            <Button>See what’s waiting</Button>
          </Link>
        </Shell>
      </ParentLayout>
    );
  }

  if (screen === 'done') {
    return (
      <ParentLayout>
        <Shell>
          <div
            className={cn(
              'w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center',
              outcome === 'approved' ? 'bg-success-50' : 'bg-slate-100',
            )}
          >
            {outcome === 'approved' ? (
              <Check className="w-6 h-6 text-success-600" />
            ) : (
              <X className="w-6 h-6 text-slate-500" />
            )}
          </div>
          <p className="font-bold text-slate-900 mb-1">
            {outcome === 'approved' ? 'Approved' : 'Sent back'}
          </p>
          <p className="text-sm text-slate-500 mb-4">
            {outcome === 'approved'
              ? `${childName} has their points.`
              : `${childName} can have another go.`}
          </p>
          <div className="flex gap-2 justify-center">
            <Link href="/parent/tasks?tab=pending">
              <Button variant="ghost">Review the next one</Button>
            </Link>
            <Button onClick={() => router.push('/parent/dashboard')}>Done</Button>
          </div>
        </Shell>
      </ParentLayout>
    );
  }

  const photo = assignment?.evidence?.find((e) => e.thumbnailUrl || e.fileUrl);
  const noteText = assignment?.evidence?.find((e) => e.note)?.note;
  const src = photo?.fileUrl || photo?.thumbnailUrl;

  return (
    <ParentLayout>
      <div className="max-w-md mx-auto">
        <Link
          href="/parent/tasks?tab=pending"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          All pending
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
        >
          {src ? (
            // Presigned R2 URL: a remote host next/image is not configured for, and short-lived.
            <div className="relative w-full aspect-[4/3] bg-slate-100">
              <Image
                src={src}
                alt={`Evidence for ${assignment?.task.title}`}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-full aspect-[4/3] bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold text-4xl">
              {getInitials(assignment?.child.firstName, assignment?.child.lastName)}
            </div>
          )}

          <div className="p-5">
            <p className="text-sm text-slate-500">{childName} finished</p>
            <h1 className="font-display text-xl font-bold text-slate-900">
              {assignment?.task.title}
            </h1>
            <p className="text-sm text-gold-600 font-medium mt-1 flex items-center gap-1">
              <Star className="w-3.5 h-3.5" />
              {assignment?.task.pointsValue} pts
            </p>

            {noteText && (
              <p className="mt-3 text-sm text-slate-600 flex items-start gap-1.5 bg-slate-50 rounded-lg p-2.5">
                <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                {noteText}
              </p>
            )}

            <div className="mt-5">
              <p className="text-xs font-medium text-slate-500 mb-2">Add a bonus?</p>
              <div className="flex gap-2">
                {BONUS_OPTIONS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBonus(amount)}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                      bonus === amount
                        ? 'border-gold-500 bg-gold-50 text-gold-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    {amount === 0 ? 'None' : `+${amount}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <Button
                onClick={() => decide(false)}
                disabled={busy}
                variant="ghost"
                className="flex-1 border border-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
                Ask again
              </Button>
              <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </ParentLayout>
  );
}

/** Shared centred card for the terminal states. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">{children}</div>
    </div>
  );
}
