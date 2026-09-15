/**
 * Optional multi-core mode for the API (2026-09-15 load test: the server is CPU-bound on one core).
 *
 * OFF by default. `CLUSTER_WORKERS` unset or <= 1 means the single-process server exactly as before;
 * nothing in this file runs. Set `CLUSTER_WORKERS=2` on the VPS to fork two API workers across the two
 * cores. index.ts branches on `isClustered()`.
 *
 * Two things a naive cluster gets wrong, handled here and in index.ts:
 *   1. Background jobs (crons, digest, retention, seeds) must run on exactly ONE worker, or they
 *      double-fire: double emails, a retention purge racing itself. `runsBackgroundJobs()` gates them.
 *   2. The signed-out access-token denylist (utils/accessDenylist) is per-process memory. Without
 *      sharing it, a token revoked on worker A still works on worker B - re-opening the revocation
 *      hole PR #201 closed. `installDenylistRelay()` bridges every worker's denials over cluster IPC.
 *
 * Live updates keep working across workers via `@socket.io/cluster-adapter` + `@socket.io/sticky`,
 * wired in index.ts. No Redis needed: the cluster adapter uses Node's built-in worker IPC.
 */
import cluster from 'node:cluster';
import {
  applyRemoteDeny,
  registerDenyPropagator,
  type DenylistEntry,
} from './utils/accessDenylist';

export const CLUSTER_WORKERS = Math.max(1, parseInt(process.env.CLUSTER_WORKERS || '1', 10));

/** True only when more than one API worker is requested. */
export function isClustered(): boolean {
  return CLUSTER_WORKERS > 1;
}

/**
 * Should THIS process run the crons/seeds? Yes in single-process mode; in cluster mode only worker 1,
 * so the schedulers exist once across the fleet.
 */
export function runsBackgroundJobs(): boolean {
  if (!isClustered()) return true;
  return cluster.worker?.id === 1;
}

const DENY_MSG = 'access-denylist:deny' as const;
interface DenyMessage {
  type: typeof DENY_MSG;
  jti: string;
  until: number;
}

function isDenyMessage(m: unknown): m is DenyMessage {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === DENY_MSG;
}

/**
 * Called in the PRIMARY: relay a deny from any worker to every worker (including the sender, which
 * ignores its own echo because the entry is already set locally). This is the fan-out that keeps all
 * workers' denylists in step.
 */
export function installPrimaryDenylistRelay(): void {
  cluster.on('message', (_worker, message) => {
    if (!isDenyMessage(message)) return;
    for (const id in cluster.workers) {
      cluster.workers[id]?.send(message);
    }
  });
}

/**
 * Called in each WORKER: send local denials up to the primary (which fans them out), and apply
 * denials arriving from the primary without re-propagating (or they would loop forever).
 */
export function installWorkerDenylistRelay(): void {
  registerDenyPropagator((entry: DenylistEntry) => {
    process.send?.({ type: DENY_MSG, jti: entry.jti, until: entry.until } satisfies DenyMessage);
  });
  process.on('message', (message: unknown) => {
    if (isDenyMessage(message)) applyRemoteDeny(message.jti, message.until);
  });
}
