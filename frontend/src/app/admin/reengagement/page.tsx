/**
 * app/admin/reengagement/page.tsx - the "come back" email sequence (2026-10-26).
 *
 * Results per step, the global pause, a test send of any step to the admin's own inbox, and the
 * guardrails in plain words. The families list is the same table as on the Overview.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminInsightsApi, TRACK_INFO, type ReengagementStats, type Track } from '@/lib/adminInsightsApi';
import {
  Card,
  CardHeader,
  ErrorBlock,
  INK2,
  KpiTile,
  LoadingBlock,
  PageShell,
  PageTitle,
  StatusPill,
} from '@/components/admin/insights/ui';
import { NudgeTable } from '@/components/admin/insights/NudgeTable';
import { Check } from 'lucide-react';

const GUARDRAILS = [
  { title: 'Parents only', body: 'Never emails a child, and children never see the sequence.' },
  { title: 'Stops on return', body: 'Any activity by a parent or child ends the sequence for the whole family.' },
  { title: 'Gentle pace', body: 'Four emails per track at most, at least 3 days apart, and never more than one lifecycle email a day.' },
  { title: 'Easy to stop', body: 'One-click unsubscribe in the mail app plus a link in every email.' },
  { title: 'Sent once a day', body: 'At 17:00 UTC, early evening in Europe and West Africa.' },
  { title: 'Skips the wrong people', body: 'Suspended families, families scheduled for deletion, test accounts and unverified emails.' },
  { title: 'No backlog', body: 'A family that is already late in the schedule gets only the latest step, and long-gone families are left alone.' },
  { title: 'Measured', body: '"Came back" means someone in the family used the app within 7 days of the email.' },
];

function rate(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : 'No data';
}

export default function ReengagementPage() {
  const [stats, setStats] = useState<ReengagementStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTrack, setTestTrack] = useState<Track>('setup');
  const [testStep, setTestStep] = useState(1);

  const load = useCallback(async () => {
    try {
      const res = await adminInsightsApi.reengagement();
      setStats(res.data ?? null);
      setError(null);
    } catch {
      setError('Could not load re-engagement results.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function togglePause() {
    if (!stats) return;
    setBusy(true);
    try {
      await adminInsightsApi.setGlobalPause(!stats.paused);
      setNotice(stats.paused ? 'Sequence resumed. The next run is at 17:00 UTC.' : 'Sequence paused. Nothing will be sent until you resume.');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await adminInsightsApi.sendTest(testTrack, testStep);
      setNotice(`Test email sent to ${r.data?.sentTo}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'The test email could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageTitle
        eyebrow="Insights"
        title="Re-engagement"
        subtitle="Two automatic email tracks bring parents back. Each stops the moment anyone in the family is active again."
        right={
          stats && (
            <>
              {stats.paused ? <StatusPill tone="warn">Paused</StatusPill> : <StatusPill tone="good">Sequence running</StatusPill>}
              <button
                type="button"
                onClick={togglePause}
                disabled={busy}
                className="border border-[#D2D2D7] bg-white text-[13px] font-medium px-3.5 min-h-[36px] rounded-[9px] hover:bg-[#F5F5F7]"
              >
                {stats.paused ? 'Resume all' : 'Pause all'}
              </button>
            </>
          )
        }
      />

      {error && <ErrorBlock message={error} />}
      {notice && <p className="text-[13px] text-[#0066CC]" role="status">{notice}</p>}
      {!stats && !error && <LoadingBlock />}

      {stats && (
        <>
          <section aria-label="Results" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <KpiTile label="Families in a track" value={String(stats.familiesInTrack)} note="Emailed in the last 30 days, not back yet" />
            <KpiTile label="Emails sent (30 days)" value={String(stats.emailsSent30d)} note={`To ${stats.familiesEmailed30d} families`} />
            <KpiTile label="Came back within 7 days" value={rate(stats.familiesReturned30d, stats.familiesEmailed30d)} note={`${stats.familiesReturned30d} families active again`} />
            <KpiTile label="Unsubscribed" value={String(stats.unsubscribes)} note="Parents who stopped tips and reminders" />
          </section>

          <section className="flex flex-wrap gap-4">
            {stats.steps.map((t) => {
              const info = TRACK_INFO[t.track];
              return (
                <Card key={t.track} className="flex-[1_1_420px]">
                  <CardHeader title={`Track ${t.track === 'setup' ? 1 : 2} · ${info.title}`} subtitle={info.who} />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[440px] text-[13px] border-collapse">
                      <thead>
                        <tr className={`text-left text-xs ${INK2}`}>
                          <th className="font-medium px-2 py-1.5 border-b border-[#E5E5EA]">When</th>
                          <th className="font-medium px-2 py-1.5 border-b border-[#E5E5EA]">Subject</th>
                          <th className="font-medium px-2 py-1.5 border-b border-[#E5E5EA] text-right">Sent</th>
                          <th className="font-medium px-2 py-1.5 border-b border-[#E5E5EA] text-right">Came back</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.steps.map((s, i) => (
                          <tr key={s.step}>
                            <td className={`px-2 py-2.5 border-b border-[#F0F0F3] whitespace-nowrap ${INK2}`}>Day {info.days[i]}</td>
                            <td className="px-2 py-2.5 border-b border-[#F0F0F3] font-medium">{info.subjects[i]}</td>
                            <td className="px-2 py-2.5 border-b border-[#F0F0F3] text-right tabular-nums">{s.sent}</td>
                            <td className="px-2 py-2.5 border-b border-[#F0F0F3] text-right tabular-nums font-semibold">{rate(s.cameBack, s.sent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </section>

          <Card>
            <CardHeader title="Send a test to yourself" subtitle="Renders the real template with sample data and sends it to your admin email. Nothing is recorded." />
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[13px]">
                <span className={INK2}>Track</span>
                <select
                  value={testTrack}
                  onChange={(e) => setTestTrack(e.target.value as Track)}
                  className="border border-[#D2D2D7] rounded-[9px] px-3 min-h-[36px] bg-white"
                >
                  <option value="setup">Track 1 · Finish setting up</option>
                  <option value="lapsed">Track 2 · We miss you</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className={INK2}>Email</span>
                <select
                  value={testStep}
                  onChange={(e) => setTestStep(Number(e.target.value))}
                  className="border border-[#D2D2D7] rounded-[9px] px-3 min-h-[36px] bg-white max-w-[320px]"
                >
                  {TRACK_INFO[testTrack].subjects.map((s, i) => (
                    <option key={s} value={i + 1}>Day {TRACK_INFO[testTrack].days[i]}: {s}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={sendTest}
                disabled={busy}
                className="bg-[#0066CC] hover:bg-[#004C99] text-white text-[13px] font-semibold px-4 min-h-[36px] rounded-[9px] disabled:opacity-60"
              >
                Send test to me
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Guardrails" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-6 gap-y-3.5">
              {GUARDRAILS.map((g) => (
                <div key={g.title} className="flex gap-2.5 items-start">
                  <Check className="w-[18px] h-[18px] text-[#0066CC] shrink-0 mt-px" strokeWidth={2.2} aria-hidden="true" />
                  <div>
                    <div className="text-sm font-semibold">{g.title}</div>
                    <div className={`text-[13px] leading-snug ${INK2}`}>{g.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <NudgeTable />
        </>
      )}
    </PageShell>
  );
}
