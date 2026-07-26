'use client';

/**
 * QuietHoursCard — per-child quiet hours and schooltime mode (growth roadmap §6).
 *
 * The card states the family time zone on its face, because that is what the times below are
 * interpreted in. A window set against the wrong zone silences the wrong hours while the parent
 * believes they are covered, which is worse than not having the feature.
 *
 * It also says plainly what suppression does and does not do: the notification still arrives in the
 * app, it just does not buzz, and nothing is held back and released in a burst later.
 */

import { useEffect, useState } from 'react';
import { Moon, School, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export interface QuietHoursValues {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  schooltimeEnabled: boolean;
  schooltimeStart: string;
  schooltimeEnd: string;
  schooltimeDays: number[];
}

interface Props {
  childId: string;
  childName: string;
  initial: Partial<QuietHoursValues>;
}

const DEFAULTS: QuietHoursValues = {
  quietHoursEnabled: false,
  quietHoursStart: '20:00',
  quietHoursEnd: '07:00',
  schooltimeEnabled: false,
  schooltimeStart: '08:30',
  schooltimeEnd: '15:30',
  schooltimeDays: [1, 2, 3, 4, 5],
};

export function QuietHoursCard({ childId, childName, initial }: Props) {
  const { success: showSuccess, error: showError } = useToast();
  const [values, setValues] = useState<QuietHoursValues>({ ...DEFAULTS, ...initial });
  const [timezone, setTimezone] = useState<string>('UTC');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    familyApi
      .getSettings()
      .then((res) => setTimezone((res.data as { timezone?: string })?.timezone ?? 'UTC'))
      .catch(() => setTimezone('UTC'));
  }, []);

  const set = <K extends keyof QuietHoursValues>(key: K, value: QuietHoursValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleDay = (day: number) =>
    setValues((v) => ({
      ...v,
      schooltimeDays: v.schooltimeDays.includes(day)
        ? v.schooltimeDays.filter((d) => d !== day)
        : [...v.schooltimeDays, day].sort((a, b) => a - b),
    }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await familyApi.updateChild(childId, values);
      showSuccess('Quiet hours saved');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save quiet hours');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center gap-2 mb-1">
        <Moon className="w-5 h-5 text-indigo-500" />
        <h2 className="font-display text-lg font-bold text-slate-900">Quiet hours</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Times are in <span className="font-medium text-slate-700">{timezone.replace(/_/g, ' ')}</span>,
        your family time zone — change it in Settings. {childName} still receives every notification
        in the app; it just won&apos;t buzz their device during these windows.
      </p>

      <div className="space-y-5">
        <div>
          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={values.quietHoursEnabled}
              onChange={(e) => set('quietHoursEnabled', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm font-medium text-slate-700">Overnight quiet hours</span>
          </label>
          <div className="flex items-center gap-2 pl-6">
            <input
              type="time"
              value={values.quietHoursStart}
              onChange={(e) => set('quietHoursStart', e.target.value)}
              disabled={!values.quietHoursEnabled}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
              type="time"
              value={values.quietHoursEnd}
              onChange={(e) => set('quietHoursEnd', e.target.value)}
              disabled={!values.quietHoursEnabled}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={values.schooltimeEnabled}
              onChange={(e) => set('schooltimeEnabled', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <School className="w-4 h-4 text-slate-400" />
              Schooltime mode
            </span>
          </label>
          <div className="flex items-center gap-2 pl-6 mb-3">
            <input
              type="time"
              value={values.schooltimeStart}
              onChange={(e) => set('schooltimeStart', e.target.value)}
              disabled={!values.schooltimeEnabled}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
              type="time"
              value={values.schooltimeEnd}
              onChange={(e) => set('schooltimeEnd', e.target.value)}
              disabled={!values.schooltimeEnabled}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pl-6">
            {DAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                disabled={!values.schooltimeEnabled}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                  values.schooltimeDays.includes(day.value)
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
          {values.schooltimeEnabled && values.schooltimeDays.length === 0 && (
            <p className="text-xs text-amber-600 mt-2 pl-6">
              No days selected, so schooltime mode won&apos;t apply to anything.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save quiet hours'}
        </Button>
        <p className="text-xs text-slate-400">
          Notifications held during a window aren&apos;t re-sent afterwards.
        </p>
      </div>
    </div>
  );
}
