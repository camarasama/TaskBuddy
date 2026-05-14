'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email') ?? undefined;
  const { success: showSuccess, error: showError } = useToast();

  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (token) {
      setStatus('verifying');
      authApi.verifyEmail(token)
        .then(() => {
          setStatus('verified');
          showSuccess('Email verified! Redirecting…');
          setTimeout(() => router.push('/parent/dashboard'), 2000);
        })
        .catch(() => {
          setStatus('error');
        });
    }
  }, [token, router, showSuccess]);

  const handleResend = async () => {
    setResending(true);
    try {
      await authApi.resendVerification(emailParam);
      setResent(true);
      showSuccess('Verification email sent! Check your inbox.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend email';
      showError(message);
    } finally {
      setResending(false);
    }
  };

  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Verifying your email…</p>
        </div>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <CheckCircle2 className="w-14 h-14 text-success-500 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Email verified!</h1>
          <p className="text-slate-600">Redirecting you to your dashboard…</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 max-w-md w-full text-center">
          <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Link expired</h1>
          <p className="text-slate-600 mb-6">
            This verification link has expired or is invalid. Request a new one below.
          </p>
          {resent ? (
            <p className="text-success-600 font-medium">Check your inbox for a new link.</p>
          ) : (
            <Button onClick={handleResend} loading={resending} fullWidth>
              Resend verification email
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Default: no token — show "check your inbox" screen
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail className="w-8 h-8 text-primary-600" />
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Check your inbox</h1>
        <p className="text-slate-600 mb-6">
          We sent a verification link to your email address. Click the link to activate your account.
        </p>
        {resent ? (
          <p className="text-success-600 font-medium">New email sent! Check your inbox.</p>
        ) : (
          <Button variant="secondary" onClick={handleResend} loading={resending} fullWidth>
            Resend verification email
          </Button>
        )}
        <p className="mt-4 text-xs text-slate-400">The link expires after 24 hours.</p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    }>
      <VerifyEmailInner />
    </Suspense>
  );
}
