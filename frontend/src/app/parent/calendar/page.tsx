'use client';

/**
 * /parent/calendar — the family week (growth roadmap §5.3).
 *
 * **Read-only, deliberately.** The roadmap says ship read-only first, and drag-to-reschedule is a
 * much larger problem — recurrence expansion, conflict re-checking, undo. Shipping a week people
 * actually look at is how you find out whether the drag is even wanted.
 *
 * Children are columns and days are rows, which survives a phone better than the reverse: a family
 * has two or three children and always seven days.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { Button } from '@/components/ui/Button';
import { dashboardApi } from '@/lib/api';
import type { CalendarWeek } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-success-50 border-success-200 text-success-800',
  completed: 'bg-warning-50 border-warning-200 text-warning-800',
  in_progress: 'bg-primary-50 border-primary-200 text-primary-800',
  rejected: 'bg-red-50 border-red-200 text-red-700',
  pending: 'bg-slate-50 border-slate-200 text-slate-700',
};

/** YYYY-MM-DD, UTC — matches how the server keys the week. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftWeeks(date: string, weeks: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return isoDate(d);
}

export default function CalendarPage() {
  const { error: showError } = useToast();
  const [anchor, setAnchor] = useState<string>(() => isoDate(new Date()));
  const [week, setWeek] = useState<CalendarWeek | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (date: string) => {
      setLoading(true);
      try {
        const res = await dashboardApi.calendar(date);
        setWeek(res.data as CalendarWeek);
      } catch {
        showError('Failed to load the calendar');
      } finally {
        setLoading(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    void load(anchor);
  }, [anchor, load]);

  const todayKey = isoDate(new Date());

  return (
    <ParentLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Family week</h1>
            <p className="text-slate-600 mt-1">
              What each child has on, and where two things clash.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAnchor((a) => shiftWeeks(a, -1))}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(isoDate(new Date()))}>
              This week
            </Button>
            <button
              onClick={() => setAnchor((a) => shiftWeeks(a, 1))}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : !week ? null : week.children.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <p className="font-bold text-slate-900 mb-1">No children yet</p>
            <p className="text-sm text-slate-500 mb-4">Add a child and their week will appear here.</p>
            <Link href="/parent/children">
              <Button>Add a child</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-24" />
                  {week.children.map((child) => (
                    <th
                      key={child.childId}
                      className="text-left text-sm font-bold text-slate-900 px-2 pb-1"
                    >
                      {child.firstName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {week.dates.map((date, dayIndex) => (
                  <tr key={date}>
                    <td className="align-top pt-2 pr-2">
                      <div
                        className={cn(
                          'text-xs font-medium',
                          date === todayKey ? 'text-primary-600' : 'text-slate-500',
                        )}
                      >
                        {DAY_NAMES[dayIndex]}
                        {date === todayKey && ' · today'}
                      </div>
                      <div className="text-xs text-slate-400">{date.slice(8)}</div>
                    </td>

                    {week.children.map((child) => {
                      const day = child.days.find((d) => d.date === date);
                      return (
                        <td
                          key={`${child.childId}-${date}`}
                          className={cn(
                            'align-top rounded-lg p-1.5 min-w-[120px]',
                            date === todayKey ? 'bg-primary-50/40' : 'bg-slate-50/60',
                          )}
                        >
                          {day && day.entries.length > 0 ? (
                            <div className="space-y-1">
                              {day.entries.map((e) => (
                                <Link
                                  key={e.assignmentId}
                                  href={`/parent/tasks/${e.taskId}`}
                                  className={cn(
                                    'block rounded-md border px-2 py-1 text-xs',
                                    STATUS_STYLE[e.status] ?? STATUS_STYLE.pending,
                                  )}
                                >
                                  <div className="flex items-start gap-1">
                                    {e.overlaps && (
                                      <AlertTriangle
                                        className="w-3 h-3 text-amber-600 shrink-0 mt-0.5"
                                        aria-label="Clashes with another task"
                                      />
                                    )}
                                    <span className="font-medium leading-tight">{e.title}</span>
                                  </div>
                                  {/* Only shown when the task genuinely has a time — inventing one
                                      would be fabricating something a parent then plans around. */}
                                  {e.isTimed && e.startTime && (
                                    <div className="flex items-center gap-1 mt-0.5 opacity-75">
                                      <Clock className="w-2.5 h-2.5" />
                                      {new Date(e.startTime).toUTCString().slice(17, 22)}
                                    </div>
                                  )}
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <div className="h-6" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Read-only for now. Times are UTC. A ⚠ marks two tasks that overlap for the same child.
        </p>
      </div>
    </ParentLayout>
  );
}
