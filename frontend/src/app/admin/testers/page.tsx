'use client';

/**
 * app/admin/testers/page.tsx — the closed-test roster.
 *
 * Google's production-access gate needs **12 testers opted in for 14 consecutive days**. The thing
 * that goes wrong is never technical: people agree to help, mean to enrol later, and don't — and
 * nobody notices because "invited" and "opted in" look the same in a spreadsheet. So the number this
 * page leads with is `optedIn`, not the roster size, and it states the shortfall rather than leaving
 * it to be worked out.
 *
 * ## Why "has an account" is shown separately from status
 *
 * `status` is a fact about the conversation — what the person said. `activity.hasAccount` is a fact
 * about the database — whether anyone has signed up with that address. They disagree constantly, and
 * the disagreement is the useful signal: someone marked `active` with no account has probably
 * enrolled on Play but never opened the app, which is a different nudge from someone who never
 * enrolled at all. The reminder email picks its wording from exactly this.
 *
 * ## ⚠️ Personal data
 *
 * This holds names, emails and phone numbers of **adults who are not TaskBuddy users**, and shows
 * their sign-ins and actions. PRIVACY.md does not currently describe any of that. The invite email
 * tells each tester plainly that their activity is visible, which is the minimum — the policy still
 * needs a paragraph before this roster is filled with real people.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  testersApi,
  type TesterRow,
  type TesterStatus,
  type TesterSummary,
} from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const STATUS_LABELS: Record<TesterStatus, string> = {
  invited: 'On the list',
  opted_in: 'Invite sent',
  active: 'Opted in on Play',
  declined: 'Declined',
};

const STATUS_STYLES: Record<TesterStatus, string> = {
  invited: 'bg-slate-100 text-slate-700',
  opted_in: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-rose-100 text-rose-700',
};

const EMPTY = { firstName: '', lastName: '', email: '', phone: '', notes: '' };

function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AdminTestersPage() {
  const { success: showSuccess, error: showError } = useToast();
  const [testers, setTesters] = useState<TesterRow[]>([]);
  const [summary, setSummary] = useState<TesterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await testersApi.list();
      setTesters(res.data?.testers ?? []);
      setSummary(res.data?.summary ?? null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not load the roster');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, message: string) => {
      setBusyId(id);
      try {
        await action();
        await load();
        showSuccess(message);
      } catch (err) {
        // The invite/remind endpoints answer with a readable message when PLAY_OPT_IN_URL is unset,
        // so surfacing it verbatim is more useful than a generic failure.
        showError(err instanceof Error ? err.message : 'That did not work');
      } finally {
        setBusyId(null);
      }
    },
    [load, showSuccess, showError],
  );

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    try {
      await testersApi.create({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm(EMPTY);
      await load();
      showSuccess('Added to the roster');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not add them');
    } finally {
      setAdding(false);
    }
  }

  const canAdd =
    form.firstName.trim() && form.lastName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Closed-test roster</h1>
        <p className="mt-1 text-sm text-slate-500">
          Google needs 12 testers opted in for 14 days in a row before TaskBuddy can be released.
        </p>
      </div>

      {/* The number that matters, and the gap — not the roster size, which flatters. */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div
            className={`rounded-xl border p-4 ${
              summary.shortfall > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opted in</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {summary.optedIn}
              <span className="text-base font-normal text-slate-500"> / {summary.required}</span>
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {summary.shortfall > 0
                ? `${summary.shortfall} more needed`
                : 'Enough to start the clock'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">On the roster</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{summary.total}</p>
            <p className="mt-1 text-xs text-slate-600">Aim for 14–15 to cover drop-outs</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed up</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{summary.withAccount}</p>
            <p className="mt-1 text-xs text-slate-600">Have an account with that email</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Not invited</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{summary.neverInvited}</p>
            <p className="mt-1 text-xs text-slate-600">No invite email sent yet</p>
          </div>
        </div>
      )}

      <form onSubmit={add} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-slate-900">Add a tester</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="First name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Last name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <button
          type="submit"
          disabled={!canAdd || adding}
          className="mt-3 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add to roster'}
        </button>
        {/* The email is the join key to accounts, so it is the one field that has to be right. */}
        <p className="mt-2 text-xs text-slate-500">
          Use the email they&apos;ll sign up with — it&apos;s how their activity gets matched.
        </p>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : testers.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nobody on the roster yet.
        </p>
      ) : (
        <div className="space-y-3">
          {testers.map((tester) => {
            const busy = busyId === tester.id;
            const open = expanded === tester.id;
            return (
              <div key={tester.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {tester.firstName} {tester.lastName}
                    </p>
                    <p className="text-sm text-slate-500">{tester.email}</p>
                    {tester.phone && <p className="text-sm text-slate-500">{tester.phone}</p>}
                    {tester.notes && (
                      <p className="mt-1 text-xs italic text-slate-500">{tester.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[tester.status]}`}
                    >
                      {STATUS_LABELS[tester.status]}
                    </span>
                    {/*
                      Shown next to the status because the two disagreeing IS the signal: marked
                      opted-in but no account means they enrolled and never opened the app.
                    */}
                    <span className="text-xs text-slate-500">
                      {tester.activity.hasAccount ? 'Has an account' : 'No account yet'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>Invited {when(tester.invitedAt)}</span>
                  <span>Reminded {when(tester.lastRemindedAt)}</span>
                  <span>Last seen {when(tester.activity.lastLoginAt)}</span>
                  <span>{tester.activity.actionCount} actions (30d)</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void run(tester.id, () => testersApi.invite(tester.id), 'Invite sent')}
                    disabled={busy}
                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {tester.invitedAt ? 'Send invite again' : 'Send invite'}
                  </button>
                  <button
                    onClick={() => void run(tester.id, () => testersApi.remind(tester.id), 'Reminder sent')}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Send reminder
                  </button>

                  <select
                    value={tester.status}
                    disabled={busy}
                    onChange={(e) =>
                      void run(
                        tester.id,
                        () => testersApi.update(tester.id, { status: e.target.value as TesterStatus }),
                        'Status updated',
                      )
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    {(Object.keys(STATUS_LABELS) as TesterStatus[]).map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABELS[value]}
                      </option>
                    ))}
                  </select>

                  {tester.activity.recentActions.length > 0 && (
                    <button
                      onClick={() => setExpanded(open ? null : tester.id)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      {open ? 'Hide activity' : 'Activity'}
                    </button>
                  )}

                  <button
                    onClick={() =>
                      void run(tester.id, () => testersApi.remove(tester.id), 'Removed from roster')
                    }
                    disabled={busy}
                    className="ml-auto rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>

                {open && (
                  <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-600">
                    {tester.activity.recentActions.map((entry, index) => (
                      <li key={index}>
                        {new Date(entry.createdAt).toLocaleString()} — {entry.action} on{' '}
                        {entry.resourceType}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
