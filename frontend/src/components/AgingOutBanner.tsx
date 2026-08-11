'use client';

/**
 * The decision a parent has to make when a child turns 18.
 *
 * ## Why a banner on the dashboard and not a page of its own
 *
 * A page has to be found. This has a deadline attached, and its default is irreversible: after 30
 * days the points are cleared automatically. Something with those two properties should be in front
 * of the person who has to act, not behind a menu item they have no reason to open.
 *
 * It renders nothing at all when there is nothing pending, which is almost always.
 *
 * ## The wording carries the consequence
 *
 * "Clear the points" rather than "discard", and the deadline is stated with what happens when it
 * passes. A parent choosing between two buttons must be able to tell which one destroys something.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface Transition {
  id: string;
  childId: string;
  pointsAtDetection: number;
  deadlineAt: string;
}
interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

export function AgingOutBanner() {
  const { success: showSuccess, error: showError } = useToast();
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [siblings, setSiblings] = useState<Person[]>([]);
  const [children, setChildren] = useState<Person[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await familyApi.transitions();
      const data = res.data;
      if (!data) return;
      setTransitions(data.transitions ?? []);
      setSiblings(data.siblings ?? []);
      setChildren((data.children ?? []) as Person[]);
    } catch {
      // Silent: this is a secondary panel on a dashboard. A failed poll must not put an error in
      // front of a parent who came here to do something else.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: 'transfer' | 'discard' | 'invite') {
    setBusyId(id);
    try {
      await familyApi.resolveTransition(id, {
        decision,
        transferToChildId: decision === 'transfer' ? recipient[id] : undefined,
      });
      showSuccess(
        decision === 'transfer'
          ? 'Points passed on'
          : decision === 'discard'
            ? 'Points cleared'
            : 'Invitation sent',
      );
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save that choice');
    } finally {
      setBusyId(null);
    }
  }

  if (transitions.length === 0) return null;

  return (
    <div className="space-y-4">
      {transitions.map((t) => {
        const child = children.find((c) => c.id === t.childId);
        const name = child ? child.firstName : 'Your child';
        const deadline = new Date(t.deadlineAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
        });
        const chosen = recipient[t.id] ?? '';

        return (
          <div key={t.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-display font-bold text-slate-900">{name} has turned 18</h3>
                <p className="text-sm text-slate-700 mt-1">
                  TaskBuddy is for ages 10 to 16, so this account needs a decision.{' '}
                  {name} has <strong>{t.pointsAtDetection} points</strong> unspent. Nothing changes
                  for them until you choose.
                </p>
                <p className="text-sm text-amber-800 mt-2">
                  If you have not chosen by <strong>{deadline}</strong>, the points are cleared
                  automatically. That cannot be undone.
                </p>

                <div className="mt-4 space-y-3">
                  {siblings.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="input max-w-xs"
                        value={chosen}
                        onChange={(e) => setRecipient((r) => ({ ...r, [t.id]: e.target.value }))}
                        aria-label={`Who receives ${name}'s points`}
                      >
                        <option value="">Choose who gets the points…</option>
                        {siblings.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.firstName} {s.lastName}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => decide(t.id, 'transfer')}
                        loading={busyId === t.id}
                        disabled={!chosen || busyId !== null}
                      >
                        Pass the points on
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => decide(t.id, 'invite')}
                      disabled={busyId !== null}
                    >
                      Invite them as a co-parent
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => decide(t.id, 'discard')}
                      disabled={busyId !== null}
                    >
                      Clear the points
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
