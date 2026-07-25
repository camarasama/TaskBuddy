'use client';

/**
 * /parent/consent — COPPA verifiable parental consent (growth roadmap §3.2).
 *
 * Child creation is blocked until this completes, so this screen is not optional decoration — it is
 * the unblock. It is reached from the 403 CONSENT_REQUIRED response, from Settings, and from the
 * setup wizard.
 *
 * The copy deliberately explains WHY rather than just asking for a click. A parent who does not
 * understand why they are being emailed is a parent who abandons setup here, and this sits directly
 * in front of the activation funnel.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { Button } from '@/components/ui/Button';
import { consentApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

type Status = 'none' | 'pending' | 'verified' | 'revoked';

export default function ConsentPage() {
  const { success: showSuccess, error: showError } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await consentApi.status();
      setStatus((res.data as { status: Status }).status);
    } catch {
      showError('Could not check your consent status');
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRequest = async () => {
    setSending(true);
    try {
      const res = await consentApi.request();
      showSuccess((res.data as { message: string }).message);
      setStatus('pending');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not send the confirmation email');
    } finally {
      setSending(false);
    }
  };

  if (status === null) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      </ParentLayout>
    );
  }

  if (status === 'verified') {
    return (
      <ParentLayout>
        <Card>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-50 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-success-600" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900 mb-1">You&apos;re all set</h1>
          <p className="text-sm text-slate-500 mb-5">
            We have your consent on record. You can add your children now.
          </p>
          <Link href="/parent/children">
            <Button>Add a child</Button>
          </Link>
        </Card>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <Card>
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary-50 flex items-center justify-center">
          {status === 'pending' ? (
            <Mail className="w-6 h-6 text-primary-600" />
          ) : (
            <ShieldCheck className="w-6 h-6 text-primary-600" />
          )}
        </div>

        <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
          {status === 'pending' ? 'Check your email' : 'Confirm you are the parent'}
        </h1>

        {status === 'pending' ? (
          <p className="text-sm text-slate-600 mb-5 leading-relaxed">
            We&apos;ve sent you a confirmation link. Open it and TaskBuddy will let you add your
            children straight away. It can take a minute to arrive — check your spam folder too.
          </p>
        ) : (
          <div className="text-sm text-slate-600 mb-5 leading-relaxed space-y-2 text-left">
            <p>
              TaskBuddy is used by children, so before we create an account for yours the law
              requires us to confirm that you are their parent or guardian.
            </p>
            <p>
              We&apos;ll email you a link. Following it records your consent — that&apos;s the whole
              process, and it only needs doing once.
            </p>
            <p className="text-slate-500">
              We use your child&apos;s information only to run TaskBuddy. We never sell it or share
              it with advertisers, and you can withdraw consent at any time.
            </p>
          </div>
        )}

        <Button onClick={handleRequest} disabled={sending} fullWidth>
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Mail className="w-4 h-4" />
          )}
          {status === 'pending' ? 'Send it again' : 'Email me the link'}
        </Button>
      </Card>
    </ParentLayout>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">{children}</div>
    </div>
  );
}
