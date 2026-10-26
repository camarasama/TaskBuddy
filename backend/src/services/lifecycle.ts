/**
 * services/lifecycle.ts - which lifecycle stage a family is in. Pure, no I/O.
 *
 * Every family is in exactly one stage, checked in this order:
 *
 *   new           signed up less than 7 days ago
 *   engaged       active in the last 7 days
 *   churned       silent for more than 60 days
 *   one_and_done  never came back after their signup day
 *   at_risk       last active 7 to 21 days ago
 *   dormant       last active 22 to 60 days ago
 *
 * "Came back" means an activity day strictly after the signup day (UTC).
 */

export type Stage = 'new' | 'engaged' | 'at_risk' | 'dormant' | 'one_and_done' | 'churned';

export const STAGES: readonly Stage[] = ['new', 'engaged', 'at_risk', 'dormant', 'one_and_done', 'churned'];

/** Stages the "needs a nudge" table lists. */
export const NUDGE_STAGES: readonly Stage[] = ['one_and_done', 'dormant', 'at_risk'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleInput {
  createdAt: Date;
  lastActiveAt: Date | null;
  cameBack: boolean;
}

export function stageOf(f: LifecycleInput, now: Date): Stage {
  const age = Math.floor((now.getTime() - f.createdAt.getTime()) / DAY_MS);
  if (age < 7) return 'new';
  const last = f.lastActiveAt ?? f.createdAt;
  const quiet = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
  if (quiet < 7) return 'engaged';
  if (quiet > 60) return 'churned';
  if (!f.cameBack) return 'one_and_done';
  if (quiet <= 21) return 'at_risk';
  return 'dormant';
}
