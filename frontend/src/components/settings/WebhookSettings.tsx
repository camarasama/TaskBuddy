'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  MAX_WEBHOOKS_PER_FAMILY,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
  type WebhookSubscription,
} from '@taskbuddy/shared';
import { AlertTriangle, Check, Copy, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { webhooksApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDateTime } from '@/lib/utils';

/**
 * FR-18 — webhook management for the parent settings page.
 *
 * The one piece of real UX weight here is the signing secret: the server returns it exactly once,
 * so it is shown in a panel that stays until the parent dismisses it, with a copy button and an
 * explicit warning. Everything else is CRUD plus delivery health, which matters because a webhook
 * that silently stopped working is worse than one that was never set up.
 */
export function WebhookSettings() {
  const { success: showSuccess, error: showError } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['task.approved']);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await webhooksApi.list();
      setWebhooks(res.data?.webhooks ?? []);
    } catch {
      showError('Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const atCap = webhooks.length >= MAX_WEBHOOKS_PER_FAMILY;

  const toggleEvent = (event: WebhookEvent) =>
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));

  const resetForm = () => {
    setShowForm(false);
    setUrl('');
    setDescription('');
    setEvents(['task.approved']);
  };

  const handleCreate = async () => {
    if (events.length === 0) {
      showError('Choose at least one event');
      return;
    }
    setSaving(true);
    try {
      const res = await webhooksApi.create({
        url: url.trim(),
        events,
        description: description.trim() || undefined,
      });
      setNewSecret(res.data?.secret ?? null);
      resetForm();
      await load();
      showSuccess('Webhook created');
    } catch (err) {
      // The server's message names the exact problem (bad scheme, private address, cap reached).
      showError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (webhook: WebhookSubscription) => {
    setBusyId(webhook.id);
    try {
      await webhooksApi.update(webhook.id, { isActive: !webhook.isActive });
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update webhook');
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (webhook: WebhookSubscription) => {
    setBusyId(webhook.id);
    try {
      const res = await webhooksApi.test(webhook.id);
      if (res.data?.delivered) showSuccess(`Test delivered (HTTP ${res.data.status})`);
      else showError(res.data?.error ?? 'Test delivery failed');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (webhook: WebhookSubscription) => {
    if (!confirm(`Delete the webhook for ${webhook.url}?`)) return;
    setBusyId(webhook.id);
    try {
      await webhooksApi.remove(webhook.id);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhook.id));
      showSuccess('Webhook deleted');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setBusyId(null);
    }
  };

  const copySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError('Copy failed — select the secret and copy it manually');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Send an HTTPS request to another service when something happens in your family — a Zapier or
        n8n catch hook, a smart-home automation, your own script. Each delivery is signed so your
        receiver can verify it came from TaskBuddy.
      </p>

      {/* The secret is shown once and never again. */}
      {newSecret && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 text-sm">
                Copy your signing secret now — it won&apos;t be shown again.
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Your receiver uses it to verify the <code>X-TaskBuddy-Signature</code> header. If you
                lose it, delete this webhook and create a new one.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs font-mono text-slate-800">
                  {newSecret}
                </code>
                <Button size="sm" onClick={copySecret} className="shrink-0">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <button
                onClick={() => setNewSecret(null)}
                className="mt-2 text-xs font-semibold text-amber-900 underline underline-offset-2"
              >
                I&apos;ve saved it
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : webhooks.length === 0 ? (
        <p className="text-sm text-slate-500">No webhooks yet.</p>
      ) : (
        <ul className="space-y-3">
          {webhooks.map((webhook) => (
            <li
              key={webhook.id}
              className={cn(
                'rounded-xl border p-4',
                webhook.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm text-slate-900 truncate">{webhook.url}</p>
                  {webhook.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{webhook.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.events.map((event) => (
                      <span
                        key={event}
                        className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full"
                      >
                        {WEBHOOK_EVENT_LABELS[event as WebhookEvent] ?? event}
                      </span>
                    ))}
                    <span
                      className={cn(
                        'text-xs font-semibold px-2 py-0.5 rounded-full',
                        webhook.isActive
                          ? 'bg-success-100 text-success-700'
                          : 'bg-slate-200 text-slate-600'
                      )}
                    >
                      {webhook.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleTest(webhook)}
                    disabled={busyId === webhook.id}
                    title="Send a test ping"
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(webhook)}
                    disabled={busyId === webhook.id}
                    title="Delete"
                    className="p-2 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Delivery health — a webhook that quietly stopped working must be visible. */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {webhook.lastDeliveryAt ? (
                  <span>
                    Last delivery {formatDateTime(webhook.lastDeliveryAt as unknown as string)}
                    {webhook.lastStatus ? ` · HTTP ${webhook.lastStatus}` : ''}
                  </span>
                ) : (
                  <span>No deliveries yet</span>
                )}
                <button
                  onClick={() => handleToggle(webhook)}
                  disabled={busyId === webhook.id}
                  className="font-semibold text-slate-600 underline underline-offset-2 disabled:opacity-50"
                >
                  {webhook.isActive ? 'Pause' : 'Resume'}
                </button>
              </div>
              {webhook.lastError && (
                <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {webhook.disabledAt
                    ? 'Paused automatically after repeated failures. '
                    : `Failing (${webhook.consecutiveFailures} in a row). `}
                  {webhook.lastError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Endpoint URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/…"
            />
            <p className="text-xs text-slate-500 mt-1">
              Must be an https address reachable from the internet.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Label <span className="text-slate-400">(optional)</span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Zapier — log approvals to a spreadsheet"
              maxLength={120}
            />
          </div>
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-1.5">Send when</span>
            <div className="space-y-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  {WEBHOOK_EVENT_LABELS[event]}
                  <code className="text-xs text-slate-400">{event}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleCreate} disabled={saving || !url.trim()}>
              {saving ? 'Creating…' : 'Create webhook'}
            </Button>
            <Button size="sm" variant="secondary" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setShowForm(true)} disabled={atCap}>
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add webhook
          </span>
        </Button>
      )}
      {atCap && !showForm && (
        <p className="text-xs text-slate-500">
          You&apos;ve reached the limit of {MAX_WEBHOOKS_PER_FAMILY} webhooks. Delete one to add
          another.
        </p>
      )}
    </div>
  );
}

/** Section icon, exported so the settings page header matches the other sections. */
export const WebhookSectionIcon = Webhook;
