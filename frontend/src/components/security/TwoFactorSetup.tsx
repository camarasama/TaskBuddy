/**
 * TwoFactorSetup — shared TOTP enrol/disable panel (FR-17).
 *
 * Originally the admin security page owned this flow inline (F-9). FR-17 opens 2FA to parents, so
 * the flow moved here and both the admin page and the parent settings page render it. It handles
 * three states: not enrolled → setup+verify; enrolled → offer disable (code-confirmed).
 */

'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldOff } from 'lucide-react';
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

export function TwoFactorSetup({
  initiallyEnabled,
  onChange,
}: {
  initiallyEnabled: boolean;
  onChange?: (enabled: boolean) => void;
}) {
  const { success, error: showError } = useToast();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [disarming, setDisarming] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const startSetup = async () => {
    setBusy(true);
    try {
      const otpauthUrl = (await authApi.mfaSetup()).data!.otpauthUrl;
      setSecret(secretFromUri(otpauthUrl));
      setQrDataUrl(await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 }));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Could not start 2FA setup.');
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
      setCode('');
      onChange?.(true);
      success('Two-factor authentication is now enabled.');
    } catch (err) {
      setCode('');
      showError(err instanceof ApiError ? err.message : 'That code was not valid. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableCode.length < 6) return;
    setBusy(true);
    try {
      await authApi.mfaDisable(disableCode);
      setEnabled(false);
      setDisarming(false);
      setDisableCode('');
      onChange?.(false);
      success('Two-factor authentication has been disabled.');
    } catch (err) {
      setDisableCode('');
      showError(err instanceof ApiError ? err.message : 'Could not disable 2FA. Check the code.');
    } finally {
      setBusy(false);
    }
  };

  if (enabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 p-4 text-green-800">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          <span>2FA is on. You&apos;ll enter a 6-digit code each time you sign in.</span>
        </div>

        {!disarming ? (
          <Button variant="ghost" onClick={() => setDisarming(true)} className="text-red-600">
            <ShieldOff className="w-4 h-4 mr-2" /> Turn off 2FA
          </Button>
        ) : (
          <form onSubmit={disable} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-sm text-slate-600">Enter a current code from your app to turn 2FA off:</p>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="text-center text-lg tracking-[0.4em]"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" loading={busy} disabled={disableCode.length < 6}>
                Confirm &amp; disable
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDisarming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (!qrDataUrl) {
    return (
      <Button onClick={startSetup} loading={busy} size="lg">
        Set up 2FA
      </Button>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-6 space-y-5">
      <div>
        <p className="text-sm text-slate-600 mb-3">1. Scan this QR code with your authenticator app:</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="2FA QR code" className="mx-auto rounded-lg" width={220} height={220} />
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
  );
}
