/**
 * components/admin/insights/NudgeTable.tsx - families in the at-risk, dormant and one-and-done
 * stages, where each one is in its re-engagement sequence, and the per-family controls.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminInsightsApi,
  STAGE_INFO,
  TRACK_INFO,
  type NudgeFamily,
  type NudgeList,
  type NudgeStage,
} from '@/lib/adminInsightsApi';
import { Card, CardHeader, ErrorBlock, INK2, shortDate } from './ui';

const STAGE_STYLE: Record<NudgeStage, string> = {
  one_and_done: 'text-[#B42318] bg-[#FDECEA]',
  dormant: 'text-[#A05A00] bg-[#FDF1E0]',
  at_risk: 'text-[#5A4A00] bg-[#FBF3D0]',
};

function sequenceText(f: NudgeFamily): string {
  if (f.paused) return 'Paused by admin';
  if (f.suspended) return 'Family suspended';
  if (f.reachableParents === 0) return 'No parent accepts email';
  const p = f.plan;
  if (!p) return 'No sequence applies';
  const track = TRACK_INFO[p.track].title;
  if (p.nextStep == null) {
    return p.sentSteps.length ? `${track}: finished` : `${track}: window passed`;
  }
  const due = p.nextDueAt && new Date(p.nextDueAt).getTime() <= Date.now() ? 'sends next run' : `sends ${shortDate(p.nextDueAt)}`;
  return `${track}: step ${p.nextStep} of 4 ${due}`;
}

const FILTERS: Array<{ key: 'all' | NudgeStage; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'one_and_done', label: 'One-and-done' },
  { key: 'dormant', label: 'Dormant' },
  { key: 'at_risk', label: 'At risk' },
];

export function NudgeTable() {
  const [filter, setFilter] = useState<'all' | NudgeStage>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NudgeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminInsightsApi.nudges({ stage: filter === 'all' ? undefined : filter, page });
      setData(res.data ?? null);
      setError(null);
    } catch {
      setError('Could not load the families list.');
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(f: NudgeFamily, kind: 'send' | 'pause') {
    setBusy(f.id + kind);
    setNotice(null);
    try {
      if (kind === 'send') {
        const r = await adminInsightsApi.sendNext(f.id);
        setNotice(`Sent step ${r.data?.step} to ${r.data?.recipients} parent(s) of ${f.familyName}.`);
      } else {
        await adminInsightsApi.setFamilyPause(f.id, !f.paused);
        setNotice(`${f.familyName}: re-engagement ${f.paused ? 'resumed' : 'paused'}.`);
      }
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <Card>
      <CardHeader
        title="Families that need a nudge"
        subtitle="The re-engagement sequence emails parents automatically. You can send the next step early or pause a family."
        right={
          <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              const n = data ? data.counts[f.key] : undefined;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setFilter(f.key); setPage(1); }}
                  className={`text-[13px] font-medium px-3 min-h-[32px] rounded-full border ${
                    on ? 'bg-[#1D1D1F] text-white border-[#1D1D1F]' : 'bg-white text-[#1D1D1F] border-[#D2D2D7] hover:bg-[#F5F5F7]'
                  }`}
                >
                  {f.label}{n != null ? ` ${n}` : ''}
                </button>
              );
            })}
          </div>
        }
      />
      {error && <ErrorBlock message={error} />}
      {notice && <p className="mb-3 text-[13px] text-[#0066CC]" role="status">{notice}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm border-collapse">
          <thead>
            <tr className={`text-left text-xs ${INK2}`}>
              {['Family', 'Members', 'Signed up', 'Last active', 'Stage', 'Sequence'].map((h) => (
                <th key={h} className="font-medium px-2.5 py-2 border-b border-[#E5E5EA]">{h}</th>
              ))}
              <th className="font-medium px-2.5 py-2 border-b border-[#E5E5EA] text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.families.map((f) => (
              <tr key={f.id}>
                <td className="px-2.5 py-3 border-b border-[#F0F0F3] font-medium">{f.familyName}</td>
                <td className={`px-2.5 py-3 border-b border-[#F0F0F3] ${INK2}`}>
                  {f.parents} parent{f.parents === 1 ? '' : 's'} · {f.children} child{f.children === 1 ? '' : 'ren'}
                </td>
                <td className={`px-2.5 py-3 border-b border-[#F0F0F3] ${INK2}`}>{shortDate(f.createdAt)}</td>
                <td className={`px-2.5 py-3 border-b border-[#F0F0F3] ${INK2}`}>{shortDate(f.lastActiveAt)}</td>
                <td className="px-2.5 py-3 border-b border-[#F0F0F3]">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STAGE_STYLE[f.stage]}`}>{STAGE_INFO[f.stage].label}</span>
                </td>
                <td className="px-2.5 py-3 border-b border-[#F0F0F3]">{sequenceText(f)}</td>
                <td className="px-2.5 py-3 border-b border-[#F0F0F3] text-right whitespace-nowrap">
                  <Link href={`/admin/families/${f.id}`} className="text-[13px] text-[#0066CC] px-2 py-1.5 hover:underline">View</Link>
                  <button
                    type="button"
                    disabled={!!busy || f.paused || f.reachableParents === 0}
                    onClick={() => act(f, 'send')}
                    className="text-[13px] text-[#0066CC] px-2 py-1.5 hover:underline disabled:text-[#AEAEB2] disabled:no-underline"
                  >
                    {busy === f.id + 'send' ? 'Sending…' : 'Send next now'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => act(f, 'pause')}
                    className="text-[13px] text-[#6E6E73] px-2 py-1.5 hover:underline"
                  >
                    {f.paused ? 'Resume' : 'Pause'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.families.length === 0 && (
              <tr><td colSpan={7} className={`px-2.5 py-8 text-center ${INK2}`}>No families in this stage. Good news.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && totalPages > 1 && (
        <div className={`flex items-center justify-end gap-3 mt-4 text-[13px] ${INK2}`}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="text-[#0066CC] disabled:text-[#AEAEB2] min-h-[32px] px-2">Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="text-[#0066CC] disabled:text-[#AEAEB2] min-h-[32px] px-2">Next</button>
        </div>
      )}
    </Card>
  );
}
