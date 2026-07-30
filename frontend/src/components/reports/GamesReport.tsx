'use client';
/**
 * GamesReport - R-12 (growth roadmap §6)
 *
 * Games have been awarding real points since they shipped and appearing in no report. The per-child
 * table is the part parents actually come here for: it shows points earned today against
 * `maxGamePointsPerDay`, which is the answer to "why did my child only get 10 points for that?" and
 * was previously displayed nowhere in the product.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { GamesReport as GamesReportData } from '@taskbuddy/shared';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';
import { formatLabel } from '@/lib/utils';

interface Props { familyId?: string; childId?: string; startDate?: string; endDate?: string; }

export default function GamesReport({ familyId, childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<GamesReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getGames({ familyId, childId, startDate, endDate })); }
    finally { setLoading(false); }
  }, [familyId, childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('games', { familyId, childId, startDate, endDate })
        : reportsApi.exportPdfUrl('games', { familyId, childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-12…</div>;
  if (!report) return null;

  const played = report.games.filter((g) => g.plays > 0);
  const atCap = report.children.filter((c) => c.atDailyCap).length;
  const flagged = report.avoidance.filter((a) => a.needsAttention);
  const masteryPlayed = report.mastery.filter((m) => m.plays > 0);
  const exhausted = report.coverage.filter((c) => c.exhausted);

  /** Accuracy colouring mirrors the 60% reward floor, so the report and the game agree on "doing well". */
  const accuracyTone = (accuracy: number | null) => {
    if (accuracy === null) return 'text-gray-300';
    if (accuracy >= 80) return 'text-green-600';
    if (accuracy >= 60) return 'text-gray-700';
    return 'text-amber-600';
  };

  return (
    <div className="space-y-6">
      {/*
        Above everything else on purpose. Counts of plays are context; this is the only section that tells
        a parent to do something, and a report skimmed from the top must deliver it first.
      */}
      {flagged.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">Worth a look</h3>
          <p className="text-xs text-amber-800 mb-3">
            Subjects a child both plays least and finds hardest. Neither number means much alone.
          </p>
          <ul className="space-y-2">
            {flagged.map((a) => (
              <li key={`${a.childId}-${a.category}`} className="text-sm text-amber-900">
                <span className="font-semibold">{a.childName}</span> — {formatLabel(a.category)}:{' '}
                {a.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Plays', value: report.totals.plays, color: 'text-indigo-600' },
          { label: 'Completions', value: report.totals.completions, color: 'text-green-600' },
          { label: 'Points Awarded', value: report.totals.pointsAwarded, color: 'text-amber-500' },
          { label: 'At Daily Cap', value: atCap, color: atCap > 0 ? 'text-amber-500' : 'text-gray-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {played.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Plays vs Completions</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={played.map((g) => ({ name: g.title, plays: g.plays, completions: g.completions }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="plays" fill="#c7d2fe" radius={[0, 4, 4, 0]} name="Plays" />
              <Bar dataKey="completions" fill="#4f46e5" radius={[0, 4, 4, 0]} name="Completions" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>

      {masteryPlayed.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4 pb-1">Accuracy by subject</h3>
          <p className="text-xs text-gray-500 px-4 pb-2">
            Counted over questions, not games — scraping 3 of 5 four times is not 100%.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50"><tr>{['Child', 'Subject', 'Level', 'Plays', 'Questions', 'Accuracy'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {masteryPlayed.map((m) => (
                  <tr key={`${m.childId}-${m.category}-${m.level}`} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-700 font-medium">{m.childName}</td>
                    <td className="px-3 py-2 text-gray-600">{formatLabel(m.category)}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatLabel(m.level)}</td>
                    <td className="px-3 py-2 text-gray-600">{m.plays}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{m.questionsCorrect}/{m.questionsAnswered}</td>
                    <td className={`px-3 py-2 font-semibold ${accuracyTone(m.accuracy)}`}>
                      {/* Never played shows a dash, not 0% — 0% would read as "gets everything wrong". */}
                      {m.accuracy === null ? '—' : `${m.accuracy}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.recentSessions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4 pb-2">Recent games</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50"><tr>{['When', 'Child', 'Game', 'Subject', 'Level', 'Score', 'Points'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {report.recentSessions.map((s) => (
                  <tr key={s.sessionId} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {s.playedAt ? new Date(s.playedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{s.childName}</td>
                    <td className="px-3 py-2 text-gray-600">{s.title}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatLabel(s.category)}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatLabel(s.level)}</td>
                    <td className={`px-3 py-2 font-semibold ${accuracyTone(s.totalQuestions > 0 ? (s.correctCount / s.totalQuestions) * 100 : null)}`}>
                      {s.correctCount}/{s.totalQuestions}
                    </td>
                    <td className="px-3 py-2 text-amber-600 font-semibold">{s.pointsAwarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {exhausted.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Question banks finished</h3>
          <p className="text-xs text-gray-500 mb-3">
            These children have now seen every question in these games, so questions have begun repeating
            — least-recently-seen first. This is working as designed, not a fault.
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            {exhausted.map((c) => (
              <li key={`${c.childId}-${c.gameId}`}>
                <span className="font-medium">{c.childName}</span> — {c.title} ({c.seen}/{c.bankSize})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4 pb-2">By Game</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Game', 'Subject', 'Level', 'Plays', 'Completions', 'Pass Rate', 'Avg Points', 'Total Points'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {report.games.map((g) => (
                <tr key={g.gameId} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-700 font-medium">{g.title}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{formatLabel(g.category)}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{formatLabel(g.level)}</td>
                  <td className="px-3 py-2 text-gray-600">{g.plays}</td>
                  <td className="px-3 py-2 text-gray-600">{g.completions}</td>
                  {/* Never played is shown as a dash, not 0% — 0% would read as "everyone fails". */}
                  <td className="px-3 py-2 text-gray-600">{g.passRate === null ? '—' : `${g.passRate}%`}</td>
                  <td className="px-3 py-2 text-gray-600">{g.averagePointsAwarded}</td>
                  <td className="px-3 py-2 text-amber-600 font-semibold">{g.pointsAwardedTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4 pb-2">By Child</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Child', 'Plays', 'Points Earned', 'Today', 'Daily Cap'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {report.children.map((c) => (
                <tr key={c.childId} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-700 font-medium">{c.childName}</td>
                  <td className="px-3 py-2 text-gray-600">{c.plays}</td>
                  <td className="px-3 py-2 text-amber-600 font-semibold">{c.pointsEarnedTotal}</td>
                  <td className="px-3 py-2">
                    <span className="text-gray-600">{c.pointsToday}</span>
                    {c.atDailyCap && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-medium">
                        cap reached
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{c.dailyCap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-xs text-gray-500 bg-gray-50 border-t">
          Games can award up to the daily cap per child. Once a child reaches it, further games are
          still playable but award no more points that day.
        </div>
      </div>
    </div>
  );
}
