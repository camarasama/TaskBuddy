'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';

// This page is mounted at /invite/accept?token=<hex>
// The invitee is NOT authenticated — this is a public page.

interface InvitePreview {
  familyName: string;
  inviterName: string;
  email: string;
  expiresAt: string;
}

interface FormData {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  password?: string;
  confirmPassword?: string;
}

const MIN_PASSWORD_LENGTH = 8;

export default function AcceptInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();           // used to populate auth context after accept
  const { error: showError } = useToast();

  const token = searchParams.get('token') || '';

  // ── State ────────────────────────────────────────────────────────────────

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');

  const [form, setForm] = useState<FormData>({
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Fetch invite preview on mount ───────────────────────────────────────

  useEffect(() => {
    if (!token) {
      setPreviewError('No invitation token found. Please check the link and try again.');
      setPreviewLoading(false);
      return;
    }

    async function fetchPreview() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
        const res = await fetch(`${apiBase}/auth/invite-preview?token=${encodeURIComponent(token)}`);
        const json = await res.json();

        if (!res.ok) {
          setPreviewError(json?.error?.message || 'Invalid or expired invitation link.');
          return;
        }

        setPreview(json.data);
      } catch {
        setPreviewError('Could not load invitation details. Please try again.');
      } finally {
        setPreviewLoading(false);
      }
    }

    fetchPreview();
  }, [token]);

  // ── Validation ───────────────────────────────────────────────────────────

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!form.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!form.lastName.trim()) newErrors.lastName = 'Last name is required';

    if (form.password.length < MIN_PASSWORD_LENGTH) {
      newErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }

    if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
      const res = await fetch(`${apiBase}/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          password: form.password,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        showError(json?.error?.message || 'Failed to accept invitation');
        return;
      }

      // Store access token and redirect to parent dashboard
      const { tokens, user } = json.data;
      localStorage.setItem('accessToken', tokens.accessToken);

      setSuccess(true);

      // Small delay so the success state renders before navigation
      setTimeout(() => {
        router.push('/parent/dashboard');
      }, 1500);
    } catch {
      showError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Field helper ─────────────────────────────────────────────────────────

  function setField(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-violet-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Loading */}
        {previewLoading && (
          <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
            <p className="text-slate-500 text-sm">Loading your invitation…</p>
          </div>
        )}

        {/* Error: bad / expired token */}
        {!previewLoading && previewError && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Invitation unavailable</h1>
            <p className="text-slate-500 text-sm mb-6">{previewError}</p>
            <Link href="/login">
              <Button variant="secondary" fullWidth>
                Go to Login
              </Button>
            </Link>
          </div>
        )}

        {/* Success state */}
        {success && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-green-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Welcome to the family!</h1>
            <p className="text-slate-500 text-sm">Redirecting to your dashboard…</p>
          </div>
        )}

        {/* Main form */}
        {!previewLoading && !previewError && !success && preview && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Branded header */}
            <div className="bg-gradient-to-r from-primary-500 to-violet-500 px-6 py-8 text-center">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <Users className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-white text-xl font-bold">You've been invited!</h1>
              <p className="text-white/80 text-sm mt-1">
                Join <span className="font-semibold text-white">{preview.familyName}</span> on TaskBuddy
              </p>
            </div>

            <div className="px-6 py-6">
              {/* Context strip */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 mb-6 text-sm text-slate-600">
                <span className="font-medium text-slate-800">{preview.inviterName}</span> invited{' '}
                <span className="font-medium text-primary-600">{preview.email}</span> to join as co-parent.
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      First name
                    </label>
                    <Input
                      placeholder="Jane"
                      value={form.firstName}
                      onChange={(e) => setField('firstName', e.target.value)}
                      error={errors.firstName}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Last name
                    </label>
                    <Input
                      placeholder="Smith"
                      value={form.lastName}
                      onChange={(e) => setField('lastName', e.target.value)}
                      error={errors.lastName}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <Input
                    type="password"
                    placeholder="At least 8 characters"
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                    error={errors.password}
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Confirm password
                  </label>
                  <Input
                    type="password"
                    placeholder="Re-enter password"
                    value={form.confirmPassword}
                    onChange={(e) => setField('confirmPassword', e.target.value)}
                    error={errors.confirmPassword}
                    disabled={isSubmitting}
                  />
                </div>

                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  loading={isSubmitting}
                  className="mt-2"
                >
                  Create Account & Join Family
                </Button>
              </form>

              <p className="text-center text-xs text-slate-400 mt-4">
                Already have an account?{' '}
                <Link href="/login" className="text-primary-600 hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
