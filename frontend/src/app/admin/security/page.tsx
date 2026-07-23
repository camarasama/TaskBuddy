/**
 * app/admin/security/page.tsx - F-9
 *
 * Admin two-factor (TOTP) enrollment. Calls POST /auth/mfa/setup to get an otpauth:// URL, renders
 * it as a QR (plus the manual secret), then confirms the first code via POST /auth/mfa/enable.
 * Wrapped by AdminLayout (admin-only guard + chrome).
 */

'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck } from 'lucide-react';
import { authApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

/** The base32 secret embedded in an otpauth:// URL, for manual authenticator entry. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export default function AdminSecurityPage() {
  const { success, error: showError } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    try {
      const res = await authApi.mfaSetup();
      const otpauthUrl = res.data!.otpauthUrl;
      setSecret(secretFromUri(otpauthUrl));
      setQrDataUrl(await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 }));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Could not start MFA setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return;
    setBusy(true);
    try {
      await authApi.mfaEnable(code);
      setEnabled(true);
      setQrDataUrl(null);
      success('Two-factor authentication is now enabled.');
    } catch (err) {
      setCode('');
      showError(err instanceof ApiError ? err.message : 'That code was not valid. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="w-6 h-6 text-primary-600" />
        <h1 className="text-2xl font-bold text-slate-900">Two-factor authentication</h1>
      </div>
      <p className="text-slate-600 mb-6">
        Protect your admin account with a time-based one-time code from an authenticator app
        (Google Authenticator, 1Password, Authy, …).
      </p>

      {enabled ? (
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800">
          MFA is enabled. You&apos;ll be asked for a 6-digit code the next time you sign in.
        </div>
      ) : !qrDataUrl ? (
        <Button onClick={startSetup} loading={busy} size="lg">
          Set up 2FA
        </Button>
      ) : (
        <div className="rounded-2xl border border-slate-200 p-6 space-y-5">
          <div>
            <p className="text-sm text-slate-600 mb-3">
              1. Scan this QR code with your authenticator app:
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="MFA QR code" className="mx-auto rounded-lg" width={220} height={220} />
            {secret && (
              <p className="text-xs text-slate-500 text-center mt-3">
                Can&apos;t scan? Enter this key manually:
                <br />
                <span className="font-mono break-all text-slate-700">{secret}</span>
              </p>
            )}
          </div>

          <form onSubmit={confirm} className="space-y-4">
            <p className="text-sm text-slate-600">2. Enter the 6-digit code it shows:</p>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="text-center text-lg tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
            <Button type="submit" fullWidth size="lg" loading={busy} disabled={code.length < 6}>
              Verify &amp; enable
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
