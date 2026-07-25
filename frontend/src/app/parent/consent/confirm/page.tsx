'use client';

/**
 * /parent/consent/confirm — the landing page for the emailed consent link.
 *
 * Public by design: the parent may open this on a phone with no TaskBuddy session, and requiring a
 * login here would strand exactly the people the flow depends on. Possession of the token is the
 * proof, and the API verifies it.
 *
 * Reads the token from window.location rather than useSearchParams(), because the latter opts a
 * route out of static prerendering unless the whole tree is wrapped in Suspense — the same trap that
 * failed the build in U2.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { consentApi } from '@/lib/api';

type State = 'verifying' | 'done' | 'failed';

export default function ConsentConfirmPage() {
  const [state, setState] = useState<State>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('failed');
      setMessage('That link is missing its confirmation code.');
      return;
    }

    let cancelled = false;
    consentApi
      .verify(token)
      .then(() => {
        if (!cancelled) setState('done');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState('failed');
        setMessage(
          err instanceof Error ? err.message : 'That confirmation link is not valid or has expired.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center">
        <BrandLogo variant="lockup" size={150} className="mx-auto mb-6" priority />

        {state === 'verifying' && (
          <>
            <Loader2 className="w-10 h-10 text-primary-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Confirming…</p>
          </>
        )}

        {state === 'done' && (
          <>
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-50 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-success-600" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900 mb-2">Thank you</h1>
            <p className="text-sm text-slate-600 mb-6">
              Your consent is recorded. You can add your children to TaskBuddy now.
            </p>
            <Link href="/parent/children">
              <Button fullWidth>Add a child</Button>
            </Link>
          </>
        )}

        {state === 'failed' && (
          <>
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-red-500" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
              That link didn&apos;t work
            </h1>
            <p className="text-sm text-slate-600 mb-6">{message}</p>
            <Link href="/parent/consent">
              <Button fullWidth>Send me a new link</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
