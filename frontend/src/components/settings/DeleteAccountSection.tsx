'use client';

/**
 * The danger zone: schedule the whole family account for deletion, or call it off.
 *
 * ## Two states, one section
 *
 * Scheduled and not-scheduled are different enough that they render as different things rather than
 * one form with a flag. A parent inside the recovery window does not need the deletion form again;
 * they need the date and one button that stops it.
 *
 * ## Why the confirmation is a typed word rather than a second "Are you sure?"
 *
 * A second dialog is dismissed with the same reflex that opened the first. Typing DELETE cannot be
 * done by reflex. The password beside it is doing a different job: the typed word proves intent,
 * the password proves identity, and a phone left unlocked on a kitchen table defeats only one of
 * them. Both are re-checked server-side; neither is a client-side formality.
 *
 * ## Why this is not shown to co-parents
 *
 * Only the primary parent may delete the family, so showing a co-parent a form that will 403 is
 * worse than showing them nothing. They get a line explaining who can do it. The server enforces
 * this regardless; `isPrimaryParent` here only decides what is worth rendering.
 *
 * It arrives as a prop rather than from `useAuth`, because the session user does not carry it. The
 * settings page already loads the parent list to render the co-parents section and derives it
 * there; taking it as a prop reuses that answer instead of fetching the same list twice.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldOff } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { familyApi, type AccountDeletionStatus } from '@/lib/api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DeleteAccountSection({ isPrimaryParent }: { isPrimaryParent: boolean }) {
  const { success, error: showError } = useToast();

  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await familyApi.getDeletionStatus();
      setStatus(res.data ?? null);
    } catch {
      // Deliberately silent. A failed status read must not put an error toast on a settings page
      // the parent opened for something else entirely; the section simply does not render, and the
      // server remains the authority on whether a deletion exists.
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSchedule = async () => {
    setIsSubmitting(true);
    try {
      const res = await familyApi.scheduleDeletion({ password, confirm });
      setStatus(res.data ?? null);
      setIsOpen(false);
      setPassword('');
      setConfirm('');
      success('Your account is scheduled for deletion. We have emailed the details.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not schedule deletion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    try {
      const res = await familyApi.cancelDeletion();
      setStatus(res.data ?? null);
      success('Your account will not be deleted.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not cancel deletion');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !status) return null;

  // ── Scheduled: the only thing that matters is the date and the way out ──────
  if (status.scheduled && status.purgeAfter) {
    return (
      <section className="bg-white rounded-xl p-6 border-2 border-red-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <h2 className="font-display font-bold text-lg text-red-900">
            Your account is scheduled for deletion
          </h2>
        </div>

        <p className="text-slate-700 mb-2">
          Everything in your family account will be permanently erased on{' '}
          <strong className="text-red-700">{formatDate(status.purgeAfter)}</strong>. That includes
          every child profile, every photo, and all tasks, points and rewards.
        </p>
        <p className="text-sm text-slate-500 mb-5">
          Your children cannot sign in while this is scheduled. Nothing has been deleted yet, and
          cancelling restores everything exactly as it was.
        </p>

        {isPrimaryParent ? (
          <Button variant="success" onClick={handleCancel} loading={isSubmitting}>
            Keep my account
          </Button>
        ) : (
          <p className="text-sm text-slate-500">
            Only the primary parent can cancel this. Ask them to open Settings before{' '}
            {formatDate(status.purgeAfter)}.
          </p>
        )}
      </section>
    );
  }

  // ── Not scheduled ───────────────────────────────────────────────────────────
  return (
    <section className="bg-white rounded-xl p-6 border border-red-200">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
          <ShieldOff className="w-5 h-5 text-red-500" />
        </div>
        <h2 className="font-display font-bold text-lg text-slate-900">Delete account</h2>
      </div>

      {!isPrimaryParent ? (
        <p className="text-sm text-slate-500">
          Only the primary parent can delete the family account. If you want to leave this family,
          ask them to remove you as a co-parent instead.
        </p>
      ) : !isOpen ? (
        <>
          <p className="text-slate-600 mb-4">
            Permanently delete your family account and everything in it. You will have{' '}
            {status.graceDays} days to change your mind before anything is erased.
          </p>
          <Button variant="destructive" onClick={() => setIsOpen(true)}>
            Delete account
          </Button>
        </>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="font-medium text-red-900 mb-2">This deletes, for everyone in the family:</p>
            <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
              <li>Every child profile, including their photos and evidence uploads</li>
              <li>All tasks, points, streaks, achievements and rewards</li>
              <li>Your account and every co-parent&apos;s account</li>
            </ul>
            <p className="text-sm text-red-800 mt-3">
              Nothing is erased for {status.graceDays} days. After that it cannot be recovered, by
              you or by us.
            </p>
          </div>

          <Input
            type="password"
            label="Your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Confirm it is you"
          />

          <Input
            label="Type DELETE to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
          />

          <div className="flex gap-3">
            <Button
              variant="destructive"
              onClick={handleSchedule}
              loading={isSubmitting}
              disabled={!password || confirm.trim().toUpperCase() !== 'DELETE'}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Schedule deletion'
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setIsOpen(false);
                setPassword('');
                setConfirm('');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
