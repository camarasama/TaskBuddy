/**
 * app/admin/security/page.tsx — F-9 (admin 2FA) / FR-17 (shared component).
 *
 * The TOTP enrol/disable flow now lives in <TwoFactorSetup> and is shared with the parent settings
 * page. This page just frames it for admins. Wrapped by AdminLayout (admin-only guard + chrome).
 */

'use client';

import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TwoFactorSetup } from '@/components/security/TwoFactorSetup';

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const enabled = Boolean((user as { mfaEnabledAt?: string | null } | null)?.mfaEnabledAt);

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="w-6 h-6 text-primary-600" />
        <h1 className="text-2xl font-bold text-slate-900">Two-factor authentication</h1>
      </div>
      <p className="text-slate-600 mb-6">
        Protect your admin account with a time-based one-time code from an authenticator app
        (Google Authenticator, 1Password, Authy, …). If 2FA is mandatory for admins, it cannot be
        turned off here.
      </p>

      <TwoFactorSetup initiallyEnabled={enabled} />
    </div>
  );
}
