'use client';

import { useState } from 'react';
import { X, Mail, Send, Loader2, Heart, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const RELATIONSHIP_OPTIONS = [
  { value: 'spouse',   label: 'Spouse',   icon: '💍' },
  { value: 'partner',  label: 'Partner',  icon: '🤝' },
  { value: 'guardian', label: 'Guardian', icon: '🛡️' },
  { value: 'other',    label: 'Other',    icon: '👤' },
] as const;

type RelationshipValue = (typeof RELATIONSHIP_OPTIONS)[number]['value'];

interface InviteCoParentModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function InviteCoParentModal({ onClose, onSuccess }: InviteCoParentModalProps) {
  const { success: showSuccess, error: showError } = useToast();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [relationship, setRelationship] = useState<RelationshipValue | ''>('');
  const [relationshipError, setRelationshipError] = useState('');
  const [otherText, setOtherText] = useState('');
  const [otherError, setOtherError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Shown in place of the form when SMTP isn't configured
  const [fallbackLink, setFallbackLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  // ── Validation ──────────────────────────────────────────────────────────

  function validate(): boolean {
    let valid = true;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email address');
      valid = false;
    } else {
      setEmailError('');
    }
    if (!relationship) {
      setRelationshipError('Please select a relationship type');
      valid = false;
    } else {
      setRelationshipError('');
    }
    if (relationship === 'other' && !otherText.trim()) {
      setOtherError('Please describe the relationship');
      valid = false;
    } else {
      setOtherError('');
    }
    return valid;
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      const result = await familyApi.inviteCoParent(
        email.trim(),
        relationship as RelationshipValue,
        relationship === 'other' ? otherText.trim() : undefined,
      );

      const { emailSent, acceptUrl } = (result.data as any) || {};

      if (emailSent) {
        showSuccess(`Invitation email sent to ${email.trim()}`);
        onSuccess();
      } else {
        // SMTP not configured — show the link so it can be shared manually
        setFallbackLink(acceptUrl || '');
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Failed to send invitation';
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(fallbackLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !fallbackLink) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-violet-500" />
            <h2 className="text-lg font-semibold text-slate-800">Invite an Adult</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Fallback: email failed, show link to copy ── */}
        {fallbackLink ? (
          <div className="px-6 py-6 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <Mail className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Email couldn't be sent — SMTP isn't configured yet. Copy the link
                below and send it to <strong>{email}</strong> manually.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Invite link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={fallbackLink}
                  className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-600 focus:outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button variant="secondary" onClick={copyLink} title="Copy link">
                  {linkCopied
                    ? <Check className="w-4 h-4 text-green-600" />
                    : <Copy className="w-4 h-4" />
                  }
                </Button>
              </div>
              <p className="text-xs text-slate-400 mt-1">This link expires in 7 days.</p>
            </div>

            <Button fullWidth onClick={() => { onSuccess(); }}>
              Done
            </Button>
          </div>

        ) : (

          /* ── Normal invite form ── */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            <p className="text-sm text-slate-500 leading-relaxed">
              They'll receive a link to create their account and join your family
              with full parent access — tasks, approvals, rewards and more.
            </p>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="email"
                  placeholder="their@email.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                  error={emailError}
                  disabled={isLoading}
                  autoFocus
                />
              </div>
            </div>

            {/* Relationship type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Their relationship to you
              </label>
              <div className="grid grid-cols-2 gap-2">
                {RELATIONSHIP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isLoading}
                    onClick={() => {
                      setRelationship(opt.value);
                      setRelationshipError('');
                      if (opt.value !== 'other') setOtherError('');
                    }}
                    className={[
                      'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left',
                      relationship === opt.value
                        ? 'border-violet-500 bg-violet-50 text-violet-700 ring-1 ring-violet-300'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span className="text-base leading-none">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
              {relationshipError && (
                <p className="text-xs text-red-500 mt-1.5">{relationshipError}</p>
              )}
            </div>

            {/* Free-text for "Other" */}
            {relationship === 'other' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Describe their relationship
                </label>
                <Input
                  placeholder="e.g. Grandparent, Aunt, Nanny…"
                  value={otherText}
                  onChange={(e) => { setOtherText(e.target.value); setOtherError(''); }}
                  error={otherError}
                  disabled={isLoading}
                />
              </div>
            )}

            <p className="text-xs text-slate-400">Invitation link expires after 7 days.</p>

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="secondary" fullWidth onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" fullWidth loading={isLoading}>
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" />Send Invite</>
                )}
              </Button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}