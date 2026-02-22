'use client';
/**
 * LeaderboardReport — R-06
 * Podium top 3 + full ranked table. Period toggle. PDF + CSV export.
 */

import { useEffect, useState, useCallback } from 'react';
import { reportsApi } from '@/lib/api';

interface LeaderboardRow {
  rank: number;
  childId: string;
  childName: string;
  avatarEmoji: string | null;
  score: number;
  tasksCompleted: number;
  currentStreak: number;
  level: number;
}

interface Report {
  period: string;
  rows: LeaderboardRow[];
  generatedAt: string;
}

type Period = 'weekly' | 'monthly' | 'all-time';

interface Props { familyId?: string; }

const MEDAL = ['🥇', '🥈', '🥉'];
const PODIUM_BG = ['from-amber-100 to-amber-50 border-amber-200', 'from-slate-100 to-slate-50 border-slate-200', 'from-orange-100 to-orange-50 border-orange-200'];

export default function LeaderboardReport({ familyId }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [period, setPeriod] = useState<Period>('weekly');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getLeaderboard(period, familyId) as Report); }
    finally { setLoading(false); }
  }, [period, familyId]);

  useEffect(() => { load(); }, [load]);

  const csvUrl = reportsApi.exportCsvUrl('leaderboard', { period, ...(familyId ? { familyId } : {}) });
  const pdfUrl = reportsApi.exportPdfUrl('leaderboard', { period, ...(familyId ? { familyId } : {}) });

  return (
    <div className="space-y-6">
      {/* Period toggle */}
      <div className="flex gap-2">
        {(['weekly', 'monthly', 'all-time'] as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              period === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {p === 'weekly' ? 'This Week' : p === 'monthly' ? 'This Month' : 'All Time'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500">Loading R-06…</div>
      ) : !report || report.rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          No leaderboard data for this period yet.
        </div>
      ) : (
        <>
          {/* Podium */}
          {report.rows.length >= 1 && (
            <div className="flex gap-3 justify-center">
              {/* Reorder for visual podium: 2nd | 1st | 3rd */}
              {[1, 0, 2].map((idx) => {
                const r = report.rows[idx];
                if (!r) return null;
                return (
                  <div key={r.childId} className={`flex-1 max-w-[180px] rounded-2xl border bg-gradient-to-b p-4 text-center ${PODIUM_BG[idx]} ${idx === 0 ? 'mt-4 scale-105' : 'mt-8'} transition-all`}>
                    <div className="text-3xl mb-1">{r.avatarEmoji ?? '🧒'}</div>
                    <div className="text-lg">{MEDAL[idx]}</div>
                    <div className="font-bold text-gray-800 text-sm mt-1">{r.childName.split(' ')[0]}</div>
                    <div className="text-xl font-black text-indigo-600 mt-1">{r.score}</div>
                    <div className="text-xs text-gray-500">pts</div>
                    <div className="text-xs text-gray-400 mt-1">🔥 {r.currentStreak}d streak</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Full table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Rank', 'Child', 'Score', 'Tasks', 'Streak', 'Level'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.rows.map((r) => (
                  <tr key={r.childId} className={`hover:bg-gray-50/50 ${r.rank <= 3 ? 'bg-indigo-50/30' : ''}`}>
                    <td className="px-4 py-3 font-bold text-gray-700">{MEDAL[r.rank - 1] ?? `#${r.rank}`}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <span className="mr-2">{r.avatarEmoji ?? '🧒'}</span>{r.childName}
                    </td>
                    <td className="px-4 py-3 font-bold text-indigo-600">{r.score}</td>
                    <td className="px-4 py-3 text-gray-600">{r.tasksCompleted}</td>
                    <td className="px-4 py-3 text-gray-600">🔥 {r.currentStreak}d</td>
                    <td className="px-4 py-3"><span className="font-semibold text-amber-500">Lv {r.level}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <a href={csvUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 transition-colors">↓ Export CSV</a>
            <a href={pdfUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 transition-colors">↓ Export PDF</a>
          </div>
        </>
      )}
    </div>
  );
}
