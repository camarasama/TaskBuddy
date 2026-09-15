/**
 * Multi-core mode (src/cluster.ts) must not break two invariants:
 *  - background jobs run on exactly one process, or crons/digests double-fire;
 *  - a signed-out token (access denylist, PR #201) is refused on EVERY worker, not just the one
 *    that handled the revoke - otherwise revocation is half-broken under clustering.
 * These test the pure logic without forking a real cluster.
 */
import {
  denyAccess,
  applyRemoteDeny,
  isAccessDenied,
  registerDenyPropagator,
  clearAccessDenylist,
  type DenylistEntry,
} from '../src/utils/accessDenylist';

describe('access denylist propagation', () => {
  beforeEach(() => clearAccessDenylist());

  it('a local deny fires the propagators (so it can be broadcast to other workers)', () => {
    const seen: DenylistEntry[] = [];
    registerDenyPropagator((e) => seen.push(e));
    const until = Date.now() + 60_000;

    denyAccess('jti-1', until);

    expect(isAccessDenied('jti-1')).toBe(true);
    expect(seen).toEqual([{ jti: 'jti-1', until }]);
  });

  it('a remote deny is applied but does NOT re-fire propagators (no infinite relay)', () => {
    const seen: DenylistEntry[] = [];
    registerDenyPropagator((e) => seen.push(e));

    applyRemoteDeny('jti-2', Date.now() + 60_000);

    expect(isAccessDenied('jti-2')).toBe(true);
    expect(seen).toEqual([]); // the whole point: a relayed message must not bounce back out
  });

  it('an already-expired deny neither stores nor propagates', () => {
    const seen: DenylistEntry[] = [];
    registerDenyPropagator((e) => seen.push(e));
    denyAccess('old', Date.now() - 1);
    expect(isAccessDenied('old')).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('cluster helpers', () => {
  const ORIG = process.env.CLUSTER_WORKERS;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.CLUSTER_WORKERS;
    else process.env.CLUSTER_WORKERS = ORIG;
    jest.resetModules();
  });

  const load = () => {
    jest.resetModules();
    return require('../src/cluster');
  };

  it('is single-process by default: not clustered, and this process runs the jobs', () => {
    delete process.env.CLUSTER_WORKERS;
    const c = load();
    expect(c.isClustered()).toBe(false);
    expect(c.runsBackgroundJobs()).toBe(true); // single process must run crons
  });

  it('CLUSTER_WORKERS=1 is still single-process (no accidental clustering at 1)', () => {
    process.env.CLUSTER_WORKERS = '1';
    const c = load();
    expect(c.isClustered()).toBe(false);
    expect(c.runsBackgroundJobs()).toBe(true);
  });

  it('CLUSTER_WORKERS=2 clusters; jobs gate to worker 1 only', () => {
    process.env.CLUSTER_WORKERS = '2';
    const c = load();
    expect(c.isClustered()).toBe(true);
    // In a jest process there is no cluster.worker, so worker?.id is undefined => not worker 1 =>
    // this process would NOT run jobs. That is the correct gate (only real worker 1 runs them).
    expect(c.runsBackgroundJobs()).toBe(false);
  });

  it('the worker relay sends local denials over IPC and applies remote ones', () => {
    process.env.CLUSTER_WORKERS = '2';
    const denylist = require('../src/utils/accessDenylist');
    denylist.clearAccessDenylist();
    const sent: unknown[] = [];
    (process as unknown as { send: (m: unknown) => void }).send = (m) => sent.push(m);

    const c = load();
    // load() reset modules, so re-require the denylist the freshly-loaded cluster wired into.
    const dl2 = require('../src/utils/accessDenylist');
    c.installWorkerDenylistRelay();

    const until = Date.now() + 60_000;
    dl2.denyAccess('local-jti', until);
    expect(sent).toContainEqual({ type: 'access-denylist:deny', jti: 'local-jti', until });

    // A message from the primary applies without looping back out.
    sent.length = 0;
    process.emit('message', { type: 'access-denylist:deny', jti: 'remote-jti', until } as never, undefined as never);
    expect(dl2.isAccessDenied('remote-jti')).toBe(true);
    expect(sent).toEqual([]);

    delete (process as unknown as { send?: unknown }).send;
  });
});
