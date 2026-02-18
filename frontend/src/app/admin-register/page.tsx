/**
 * app/admin-register/page.tsx — M8
 *
 * Admin registration page. Accessible at /admin-register. Placed OUTSIDE app/admin/ so AdminLayout
 * route guard does not apply — this page must be publicly accessible.
 * Does NOT require an existing admin session — the gate is the ADMIN_INVITE_CODE
 * env var that must be matched. After successful registration the admin is NOT
 * auto-logged in; they are redirected to /login with a success message.
 *
 * Acceptance test T2: Use POST /auth/admin/register with the correct
 * ADMIN_INVITE_CODE → admin lands on /admin/dashboard after login.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/api';

export default function AdminRegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName:  '',
    lastName:   '',
    email:      '',
    password:   '',
    inviteCode: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  }

  async function handleSubmit(e: React.MouseEvent) {
    e.preventDefault();

    const { firstName, lastName, email, password, inviteCode } = form;

    if (!firstName || !lastName || !email || !password || !inviteCode) {
      setError('All fields are required.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await adminApi.register({ firstName, lastName, email, password, inviteCode });
      // Redirect to login with a success message via query param
      router.push('/login?registered=admin');
    } catch (err: any) {
      const message =
        err?.data?.error?.message ||
        err?.message ||
        'Registration failed. Check your invite code and try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">🛡️</div>
          <h1 className="text-2xl font-bold text-slate-800">Create Admin Account</h1>
          <p className="text-slate-500 text-sm mt-1">
            Enter your invite code to register an admin account.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  First Name
                </label>
                <input
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  placeholder="Ada"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Last Name
                </label>
                <input
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  placeholder="Lovelace"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Email Address
              </label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="admin@taskbuddy.app"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Password
              </label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Min 8 characters"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Invite Code */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Admin Invite Code
              </label>
              <input
                name="inviteCode"
                type="password"
                value={form.inviteCode}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Provided by the system administrator via ADMIN_INVITE_CODE.
              </p>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors mt-2"
            >
              {isLoading ? 'Creating account…' : 'Create Admin Account'}
            </button>
          </div>

          <p className="text-center text-xs text-slate-400 mt-5">
            Already have an account?{' '}
            <a href="/login" className="text-indigo-600 hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
