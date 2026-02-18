// frontend/src/components/tasks/OverlapWarningModal.tsx
// CR-09: Shown when POST /tasks or PUT /tasks/:id returns warnings[] in the response.
// Two actions: "Assign Anyway" (proceed) or "Go Back" (return to form to adjust time).

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface OverlapWarning {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  startTime: string; // ISO string from API
  endTime: string;   // ISO string from API
  childId: string;
  childFirstName: string;
}

interface OverlapWarningModalProps {
  warnings: OverlapWarning[];
  onAssignAnyway: () => void;
  onGoBack: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OverlapWarningModal({
  warnings,
  onAssignAnyway,
  onGoBack,
}: OverlapWarningModalProps) {
  if (warnings.length === 0) return null;

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
          className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Schedule Conflict
                </h3>
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

          {/* Conflict list */}
          <div className="space-y-3 mb-6">
            {warnings.map((w) => (
              <div
                key={w.assignmentId}
                className="bg-amber-50 border border-amber-200 rounded-xl p-4"
              >
                <p className="text-sm font-semibold text-slate-900 mb-1">
                  ⚠️ {w.childFirstName} already has &ldquo;{w.taskTitle}&rdquo;
                </p>
                <p className="text-sm text-amber-700">
                  from {formatTime(w.startTime)} to {formatTime(w.endTime)}
                </p>
              </div>
            ))}
          </div>

          <p className="text-sm text-slate-600 mb-6">
            You can assign the task anyway, or go back to adjust the start time or duration.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              fullWidth
              onClick={onGoBack}
            >
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
