'use client';

import { useState } from 'react';
import { X, Mail, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface InviteCoParentModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function InviteCoParentModal({ onClose, onSuccess }: InviteCoParentModalProps) {
  const { success: showSuccess, error: showError } = useToast();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function validate(): boolean {
    if (!email.trim()) {
      setEmailError('Email address is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email address');
      return false;
    }
    setEmailError('');
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      await familyApi.inviteCoParent(email.trim());
      showSuccess(`Invitation sent to ${email.trim()}`);
      onSuccess();
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

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Invite Co-Parent</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Enter the email address of the person you'd like to invite. They'll receive a link
            to create their account and join your family with full co-parent access.
          </p>

          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              type="email"
              placeholder="co-parent@email.com"
              className="pl-10"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
              error={emailError}
              autoFocus
              disabled={isLoading}
            />
          </div>

          <p className="text-xs text-slate-400">
            The invitation link expires after 7 days.
          </p>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Invite
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
