'use client';

/**
 * /parent/welcome — the guided setup wizard (growth roadmap §3.2).
 *
 * A parent landing on an empty dashboard has to invent the product for themselves, and that is the
 * roadmap's biggest measured drop-off. Four steps, all skippable, all resumable.
 *
 * Step 4 is the one that matters: it seeds a task the child has "already finished" and hands the
 * parent the approve button. Approving it fires the real pipeline — real points, real socket event,
 * real confetti — so both sides feel the whole loop inside the first minute instead of a day later.
 *
 * Progress is server-side (FamilySettings), so closing the tab loses nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Confetti from 'react-confetti';
import {
  Check,
  Users,
  ListTodo,
  Gift,
  Sparkles,
  Loader2,
  ArrowRight,
  Copy,
} from 'lucide-react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { Button } from '@/components/ui/Button';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { onboardingApi, dashboardApi, tasksApi } from '@/lib/api';
import type { OnboardingState, OnboardingStep } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface StepDef {
  id: OnboardingStep;
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  cta: string;
}

const STEPS: StepDef[] = [
  {
    id: 'child',
    title: 'Add your first child',
    description: 'Give them a name and a 4-digit PIN. They sign in with your family code.',
    icon: Users,
    href: '/parent/children',
    cta: 'Add a child',
  },
  {
    id: 'tasks',
    title: 'Pick a starter pack',
    description: 'A ready-made set of chores, so you are not staring at a blank list.',
    icon: ListTodo,
    href: '/parent/tasks/new?templates=1',
    cta: 'Browse packs',
  },
  {
    id: 'reward',
    title: 'Add one reward',
    description: 'What will they work for? Pick an idea or write your own.',
    icon: Gift,
    href: '/parent/rewards/new',
    cta: 'Add a reward',
  },
  {
    id: 'handoff',
    title: 'Try it together',
    description: 'Approve your child’s first task and watch the points land.',
    icon: Sparkles,
    cta: 'Show me',
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const { success: showSuccess, error: showError } = useToast();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [familyCode, setFamilyCode] = useState<string>('');
  const [children, setChildren] = useState<Array<{ id: string; firstName: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [onboarding, dashboard] = await Promise.all([
        onboardingApi.get(),
        dashboardApi.getParentDashboard(),
      ]);
      setState((onboarding.data as { state: OnboardingState }).state);

      const data = dashboard.data as {
        family?: { familyCode?: string };
        children?: Array<{ user: { id: string; firstName?: string } }>;
      };
      setFamilyCode(data.family?.familyCode ?? '');
      setChildren(
        (data.children ?? []).map((c) => ({ id: c.user.id, firstName: c.user.firstName ?? 'Child' })),
      );
    } catch {
      showError('Could not load your setup progress');
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (step: OnboardingStep) => state?.completedSteps.includes(step) ?? false;

  const markDone = async (step: OnboardingStep) => {
    try {
      const res = await onboardingApi.completeStep(step);
      setState((res.data as { state: OnboardingState }).state);
    } catch {
      // Non-fatal: the parent has done the thing; only the checkmark failed.
    }
  };

  /** Step 4: seed the pre-submitted task, approve it for real, celebrate. */
  const handleFirstApproval = async () => {
    const child = children[0];
    if (!child) {
      showError('Add a child first — step 1.');
      return;
    }

    setBusy(true);
    try {
      const seeded = await onboardingApi.seedFirstApproval(child.id);
      const { assignmentId } = seeded.data as { assignmentId: string };

      // The real approval pipeline: points, ledger, socket event, achievements.
      await tasksApi.approveAssignment(assignmentId, true);

      setCelebrating(true);
      showSuccess(`${child.firstName} just earned their first points!`);
      await markDone('handoff');
      setTimeout(() => setCelebrating(false), 6000);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not run that just now');
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    await onboardingApi.dismiss().catch(() => undefined);
    router.push('/parent/dashboard');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(familyCode);
      showSuccess('Family code copied');
    } catch {
      showError('Could not copy — the code is on screen');
    }
  };

  if (!state) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      </ParentLayout>
    );
  }

  const completedCount = state.completedSteps.length;
  const allDone = completedCount === STEPS.length;

  return (
    <ParentLayout>
      {celebrating && <Confetti recycle={false} numberOfPieces={260} />}

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <BrandLogo variant="lockup" size={150} className="mx-auto mb-4" priority />
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {allDone ? 'You’re all set' : 'Let’s get you going'}
          </h1>
          <p className="text-slate-600 mt-1">
            {allDone
              ? 'Everything is ready. Your family can start earning.'
              : 'Four short steps. You can stop and come back any time.'}
          </p>

          <div className="mt-4 max-w-xs mx-auto">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary-500 rounded-full"
                animate={{ width: `${(completedCount / STEPS.length) * 100}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              {completedCount} of {STEPS.length} done
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {STEPS.map((step, index) => {
            const isDone = done(step.id);
            const isNext = !isDone && state.completedSteps.length === index;

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  'bg-white rounded-2xl border p-5',
                  isDone ? 'border-success-200 bg-success-50/30' : isNext ? 'border-primary-300' : 'border-slate-200',
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      isDone ? 'bg-success-100 text-success-700' : 'bg-primary-50 text-primary-600',
                    )}
                  >
                    {isDone ? <Check className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={cn('font-bold', isDone ? 'text-slate-500 line-through' : 'text-slate-900')}>
                      {step.title}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">{step.description}</p>

                    {!isDone && (
                      <div className="mt-3">
                        {step.id === 'handoff' ? (
                          <Button onClick={handleFirstApproval} disabled={busy} size="sm">
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            {step.cta}
                          </Button>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Link href={step.href!}>
                              <Button size="sm">
                                {step.cta}
                                <ArrowRight className="w-4 h-4" />
                              </Button>
                            </Link>
                            <Button variant="ghost" size="sm" onClick={() => markDone(step.id)}>
                              Already done
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {familyCode && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center">
            <p className="text-sm text-slate-500 mb-1">Your family code</p>
            <p className="font-display text-2xl font-bold tracking-widest text-slate-900">
              {familyCode}
            </p>
            <p className="text-xs text-slate-500 mt-1 mb-3">
              Your child signs in with this and their PIN — hand them the device.
            </p>
            <Button variant="ghost" size="sm" onClick={copyCode}>
              <Copy className="w-4 h-4" />
              Copy code
            </Button>
          </div>
        )}

        <div className="text-center pb-4">
          {allDone ? (
            <Button onClick={() => router.push('/parent/dashboard')}>Go to my dashboard</Button>
          ) : (
            <button
              onClick={handleDismiss}
              className="text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Skip setup — I&apos;ll find my way around
            </button>
          )}
        </div>
      </div>
    </ParentLayout>
  );
}
