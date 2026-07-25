'use client';

/**
 * WebhookSettings — FR-18 parent-facing management for outbound webhooks.
 *
 * Lives in its own component rather than inline in parent/settings/page.tsx, which is already ~900
 * lines against a 500-line project rule (same reasoning as <TwoFactorSetup> in FR-17).
 *
 * Two things here are security-shaped rather than cosmetic:
 *  - The signing secret is shown ONCE on creation. The list endpoint never returns it, so seeing it
 *    again is an explicit, audit-logged reveal. The UI says so plainly instead of quietly hiding it.
 *  - The server refuses any URL that is not https and does not resolve to a public address. That
 *    rejection is surfaced verbatim, because "why won't it take my n8n box on 192.168.1.20" is the
 *    single most likely support question and a generic "invalid URL" would waste the parent's time.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  Eye,
  Copy,
  Check,
  AlertTriangle,
  CircleSlash,
} from 'lucide-react';
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS } from '@taskbuddy/shared';
import type { WebhookEvent, WebhookSubscriptionSummary } from '@taskbuddy/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { webhooksApi, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export function WebhookSettings() {
  const { success, error: showError } = useToast();

  const [subscriptions, setSubscriptions] = useState<WebhookSubscriptionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<Set<WebhookEvent>>(new Set());
  const [urlError, setUrlError] = useState('');

  // Secret shown once after creation, plus any explicit reveal. Keyed by subscription id.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await webhooksApi.list();
      setSubscriptions(res.data?.subscriptions ?? []);
    } catch {
      showError('Could not load your webhooks.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEvent = (event: WebhookEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setUrlError('');

    if (selected.size === 0) {
      showError('Choose at least one event to send.');
      return;
    }

    setBusy(true);
    try {
      const res = await webhooksApi.create(url.trim(), Array.from(selected));
      const created = res.data?.subscription;
      const secret = res.data?.secret;
      if (created && secret) {
        setSubscriptions((prev) => [created, ...prev]);
        setRevealed((prev) => ({ ...prev, [created.id]: secret }));
      }
      setUrl('');
      setSelected(new Set());
      setShowForm(false);
      success('Webhook added — copy the signing secret now.');
    } catch (err) {
      // The server's SSRF refusal is specific and actionable; show it rather than flattening it.
      const message = err instanceof ApiError ? err.message : 'Could not add that webhook.';
      setUrlError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal(id: string) {
    try {
      const res = await webhooksApi.reveal(id);
      if (res.data?.secret) setRevealed((prev) => ({ ...prev, [id]: res.data!.secret }));
    } catch {
      showError('Could not reveal that secret.');
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await webhooksApi.remove(id);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
      success('Webhook removed.');
    } catch {
      showError('Could not remove that webhook.');
    } finally {
      setBusy(false);
    }
  }

  async function copySecret(id: string, secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      showError('Could not copy — select the text and copy it manually.');
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading webhooks…</p>;
  }

  return (
    <div className="space-y-4">
      {subscriptions.length === 0 && !showForm && (
        <p className="text-sm text-slate-600">
          No webhooks yet. Add one to POST TaskBuddy events to n8n, Zapier, IFTTT or your own
          service.
        </p>
      )}

      {/* ── Existing subscriptions ─────────────────────────────────────────── */}
      <ul className="space-y-3">
        {subscriptions.map((sub) => (
          <li
            key={sub.id}
            className="rounded-lg border border-slate-200 p-4"
            data-testid="webhook-row"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 break-all text-sm">{sub.url}</p>
                <p className="text-xs text-slate-500 mt-0.5">Added {formatDate(sub.createdAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(sub.id)}
                disabled={busy}
                aria-label={`Remove webhook ${sub.url}`}
              >
                <Trash2 className="w-4 h-4 text-danger-600" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {sub.events.map((event) => (
                <span
                  key={event}
                  className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs"
                >
                  {WEBHOOK_EVENT_LABELS[event] ?? event}
                </span>
              ))}
            </div>

            {/* Auto-disabled after repeated failures — say why, and what to do about it. */}
            {!sub.isActive && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-danger-50 p-3">
                <CircleSlash className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
                <p className="text-xs text-danger-700">
                  Switched off automatically after {sub.failureCount} failed deliveries
                  {sub.disabledAt ? ` on ${formatDate(sub.disabledAt)}` : ''}. Remove it and add it
                  again once the endpoint is healthy.
                </p>
              </div>
            )}

            {sub.isActive && sub.failureCount > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-warning-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                {sub.failureCount} recent failure{sub.failureCount > 1 ? 's' : ''}
                {sub.lastFailureAt ? ` — last ${formatDate(sub.lastFailureAt)}` : ''}
              </p>
            )}

            {sub.recentFailures.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-slate-500 cursor-pointer">
                  Recent delivery failures
                </summary>
                <ul className="mt-2 space-y-1">
                  {sub.recentFailures.map((failure, i) => (
                    <li key={`${failure.at}-${i}`} className="text-xs text-slate-600">
                      <span className="font-mono">{formatDate(failure.at)}</span> · {failure.event} ·{' '}
                      {failure.status ? `HTTP ${failure.status} · ` : ''}
                      {failure.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* ── Signing secret ─────────────────────────────────────────────── */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              {revealed[sub.id] ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded bg-slate-50 px-2 py-1.5 text-xs font-mono text-slate-800">
                    {revealed[sub.id]}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copySecret(sub.id, revealed[sub.id])}
                  >
                    {copied === sub.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => handleReveal(sub.id)}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  Show signing secret
                </Button>
              )}
              <p className="mt-1.5 text-xs text-slate-500">
                Verify each delivery with{' '}
                <code className="font-mono">
                  HMAC-SHA256(&quot;&lt;X-TaskBuddy-Timestamp&gt;.&lt;raw body&gt;&quot;, secret)
                </code>{' '}
                and compare it to <code className="font-mono">X-TaskBuddy-Signature</code>. The
                timestamp is inside the signed string, so a replayed request cannot be made to look
                fresh.
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* ── Add form ───────────────────────────────────────────────────────── */}
      {showForm ? (
        <form onSubmit={handleCreate} className="rounded-lg border border-slate-200 p-4 space-y-4">
          <Input
            label="Endpoint URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/taskbuddy"
            error={urlError}
            helper="Must be https and reachable on the public internet. Addresses on a home or private network are refused."
            required
          />

          <fieldset>
            <legend className="text-sm font-medium text-slate-700 mb-2">Send these events</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(event)}
                    onChange={() => toggleEvent(event)}
                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  {WEBHOOK_EVENT_LABELS[event]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!url.trim() || selected.size === 0}>
              Add webhook
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setUrlError('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add webhook
        </Button>
      )}

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Webhook className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Deliveries are signed and never follow redirects. An endpoint that keeps failing is switched
        off automatically and you will get a notification.
      </p>
    </div>
  );
}
