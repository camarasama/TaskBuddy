'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

interface InvitePreview {
  familyName: string;
  inviterName: string;
  email: string;
  expiresAt: string;
}

interface FormData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  password?: string;
  confirmPassword?: string;
}

const MIN_PASSWORD_LENGTH = 8;

// Use NEXT_PUBLIC_API_URL for all fetch calls so the page works over ngrok too.
// In .env.local set: NEXT_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api/v1
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export default function AcceptInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { error: showError } = useToast();

  const token = searchParams.get('token') || '';

  // ── State ────────────────────────────────────────────────────────────────

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');

  const [form, setForm] = useState<FormData>({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
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
        const res = await fetch(`${API_BASE}/auth/invite-preview?token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!res.ok) {
          setPreviewError(json?.error?.message || 'Invalid or expired invitation link.');
          return;
        }
        setPreview(json.data);
      } catch {
        setPreviewError('Could not load invitation details. Please check your connection and try again.');
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

    if (!form.dateOfBirth) {
      newErrors.dateOfBirth = 'Date of birth is required';
    } else {
      const dob = new Date(form.dateOfBirth);
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      if (isNaN(dob.getTime())) {
        newErrors.dateOfBirth = 'Please enter a valid date';
      } else if (dob > today) {
        newErrors.dateOfBirth = 'Date of birth cannot be in the future';
      } else if (age < 18) {
        newErrors.dateOfBirth = 'You must be at least 18 years old';
      }
    }

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

    setSubmitError('');
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth,
          phone: form.phone.trim() || undefined,
          password: form.password,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        // Show inline — easier to read than a toast for longer error messages
        setSubmitError(json?.error?.message || 'Failed to accept invitation. Please try again.');
        return;
      }

      const { tokens } = json.data;
      localStorage.setItem('accessToken', tokens.accessToken);
      setSuccess(true);
      setTimeout(() => router.push('/parent/dashboard'), 1500);
    } catch {
      setSubmitError('Something went wrong. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function setField(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (submitError) setSubmitError('');
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

        {/* Preview error */}
        {!previewLoading && previewError && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Invitation unavailable</h2>
            <p className="text-sm text-slate-500 mb-6">{previewError}</p>
            <Link href="/login">
              <Button variant="secondary" fullWidth>Go to Login</Button>
            </Link>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="bg-white rounded-2xl shadow-lg p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-success-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-1">Welcome to the family! 🎉</h2>
            <p className="text-sm text-slate-500">Taking you to your dashboard…</p>
          </div>
        )}

        {/* Invite form */}
        {!previewLoading && !previewError && !success && preview && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">

            {/* Header banner */}
            <div className="bg-gradient-to-r from-primary-500 to-violet-500 px-6 py-5 text-white">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <p className="text-sm font-medium text-white/80">You've been invited!</p>
              </div>
              <p className="text-base font-semibold leading-snug">
                Join <span className="font-bold">{preview.familyName}</span> on TaskBuddy
              </p>
            </div>

            <div className="px-6 py-6">

              {/* Context strip */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 mb-5 text-sm text-slate-600">
                <span className="font-medium text-slate-800">{preview.inviterName}</span>
                {' '}invited{' '}
                <span className="font-medium text-primary-600">{preview.email}</span>
                {' '}to join as co-parent.
              </div>

              {/* Inline submit error — more readable than a toast for longer messages */}
              {submitError && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-200 mb-4">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 leading-relaxed">{submitError}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Name row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      First name <span className="text-red-400">*</span>
                    </label>
                    <Input
                      placeholder="Jane"
                      value={form.firstName}
                      onChange={(e) => setField('firstName', e.target.value)}
                      error={errors.firstName}
                      disabled={isSubmitting}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Last name <span className="text-red-400">*</span>
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

                {/* Date of birth */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Date of birth <span className="text-red-400">*</span>
                  </label>
                  <Input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setField('dateOfBirth', e.target.value)}
                    error={errors.dateOfBirth}
                    disabled={isSubmitting}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Phone number <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <Input
                    type="tel"
                    placeholder="+1 555 000 0000"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password <span className="text-red-400">*</span>
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

                {/* Confirm password */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Confirm password <span className="text-red-400">*</span>
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