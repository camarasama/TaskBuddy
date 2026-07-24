// frontend/src/components/tasks/OverlapWarningModal.tsx
// CR-09: Shown when POST /tasks or PUT /tasks/:id returns warnings[] in the response.
// FR-12: the plain conflict list is now a visual day timeline — each child's existing commitments
// are drawn as blocks on a shared hour axis, with the proposed slot (when provided) overlaid, so a
// parent can see the clash at a glance instead of reading times.

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface OverlapWarning {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  startTime: Date | string; // ISO string over the wire, typed Date to match the shared API type
  endTime: Date | string;
  childId: string;
  childFirstName: string;
}

/** The slot the parent is trying to assign, so the timeline can show it against the conflicts. */
export interface ProposedSlot {
  title: string;
  startTime: Date | string;
  endTime: Date | string;
}

interface OverlapWarningModalProps {
  warnings: OverlapWarning[];
  proposed?: ProposedSlot;
  onAssignAnyway: () => void;
  onGoBack: () => void;
}

const toDate = (v: Date | string) => (typeof v === 'string' ? new Date(v) : v);
const formatTime = (v: Date | string) =>
  toDate(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** Minutes since midnight, for positioning on the axis. */
const minutesOfDay = (v: Date | string) => {
  const d = toDate(v);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * A single child's day, hour-labelled, with their conflicting commitments as blocks and (optionally)
 * the proposed slot overlaid. The axis auto-fits the union of everything shown, padded to whole
 * hours, so a 3-4pm clash doesn't render a 24-hour ruler.
 */
function DayTimeline({
  childName,
  blocks,
  proposed,
}: {
  childName: string;
  blocks: { id: string; title: string; start: number; end: number }[];
  proposed?: { title: string; start: number; end: number };
}) {
  const all = [...blocks, ...(proposed ? [proposed] : [])];
  const minRaw = Math.min(...all.map((b) => b.start));
  const maxRaw = Math.max(...all.map((b) => b.end));
  const axisStart = Math.floor(minRaw / 60) * 60;
  const axisEnd = Math.max(Math.ceil(maxRaw / 60) * 60, axisStart + 60);
  const span = axisEnd - axisStart;
  const pct = (mins: number) => `${((mins - axisStart) / span) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / span) * 100}%`;

  const hourMarks: number[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hourMarks.push(m);
  const hourLabel = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-slate-900 mb-2">{childName}&apos;s day</p>

      {/* Existing commitments */}
      <div className="relative h-9">
        {blocks.map((b) => (
          <div
            key={b.id}
            className="absolute top-0 h-6 rounded-md bg-amber-400/80 border border-amber-500 px-1.5 overflow-hidden"
            style={{ left: pct(b.start), width: width(b.start, b.end) }}
            title={`${b.title} (${hourLabel(b.start)}–${hourLabel(b.end)})`}
          >
            <span className="text-[11px] leading-6 text-amber-900 whitespace-nowrap">{b.title}</span>
          </div>
        ))}
      </div>

      {/* Proposed slot on its own row, so an overlap is visually obvious */}
      {proposed && (
        <div className="relative h-9">
          <div
            className="absolute top-0 h-6 rounded-md bg-primary-500 border border-primary-600 px-1.5 overflow-hidden"
            style={{ left: pct(proposed.start), width: width(proposed.start, proposed.end) }}
            title={`New: ${proposed.title}`}
          >
            <span className="text-[11px] leading-6 text-white whitespace-nowrap">
              New: {proposed.title}
            </span>
          </div>
        </div>
      )}

      {/* Hour axis */}
      <div className="relative h-4 mt-1 border-t border-amber-300">
        {hourMarks.map((m) => (
          <span
            key={m}
            className="absolute -translate-x-1/2 text-[10px] text-amber-700"
            style={{ left: pct(m) }}
          >
            {hourLabel(m)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function OverlapWarningModal({
  warnings,
  proposed,
  onAssignAnyway,
  onGoBack,
}: OverlapWarningModalProps) {
  if (warnings.length === 0) return null;

  // Group conflicts by child so each gets one timeline row.
  const byChild = new Map<string, { name: string; warnings: OverlapWarning[] }>();
  for (const w of warnings) {
    const entry = byChild.get(w.childId) ?? { name: w.childFirstName, warnings: [] };
    entry.warnings.push(w);
    byChild.set(w.childId, entry);
  }

  const proposedMins = proposed
    ? {
        title: proposed.title || 'this task',
        start: minutesOfDay(proposed.startTime),
        end: minutesOfDay(proposed.endTime),
      }
    : undefined;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onGoBack}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">Schedule Conflict</h3>
                <p className="text-sm text-slate-500">
                  {warnings.length} conflict{warnings.length > 1 ? 's' : ''} detected
                </p>
              </div>
            </div>
            <button
              onClick={onGoBack}
              className="p-1 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Visual timelines, one per affected child */}
          <div className="space-y-3 mb-4">
            {Array.from(byChild.entries()).map(([childId, { name, warnings: ws }]) => (
              <DayTimeline
                key={childId}
                childName={name}
                blocks={ws.map((w) => ({
                  id: w.assignmentId,
                  title: w.taskTitle,
                  start: minutesOfDay(w.startTime),
                  end: minutesOfDay(w.endTime),
                }))}
                proposed={proposedMins}
              />
            ))}
          </div>

          {/* Text detail — precise times, and a fallback for screen readers */}
          <ul className="space-y-1 mb-6 text-sm text-slate-600">
            {warnings.map((w) => (
              <li key={w.assignmentId}>
                ⚠️ {w.childFirstName} already has &ldquo;{w.taskTitle}&rdquo; from{' '}
                {formatTime(w.startTime)} to {formatTime(w.endTime)}
              </li>
            ))}
          </ul>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={onGoBack}>
              Go Back
            </Button>
            <Button
              fullWidth
              onClick={onAssignAnyway}
              className="bg-amber-500 hover:bg-amber-600 text-white border-transparent"
            >
              Assign Anyway
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
