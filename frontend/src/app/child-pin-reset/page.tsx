'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authApi, ApiError } from '@/lib/api';
import { VALIDATION } from '@taskbuddy/shared';

/**
 * Sibling of reset-password's schema, same reasoning: import the server's rule
 * (VALIDATION.PIN.PATTERN) rather than restating `/^\d{4}$/` here. reset-password's own comment
 * documents what happens when a client-side floor drifts from the server's - a submit that looks
 * accepted by the form and is then rejected by the API. There's only one PIN rule in this app, so
 * there's nothing to drift yet, but importing it now means there never will be.
 */
const pinResetSchema = z
  .object({
    newPin: z
      .string()
      .regex(VALIDATION.PIN.PATTERN, `PIN must be exactly ${VALIDATION.PIN.LENGTH} digits`),
    confirmPin: z.string(),
  })
  .refine((data) => data.newPin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });

type PinResetForm = z.infer<typeof pinResetSchema>;

function ChildPinResetInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  // The backend deliberately sends the identical message for an expired token and one that never
  // existed at all (anti-enumeration - see backend/src/routes/auth.ts on this route). We relay
  // whatever string comes back rather than branching on it; inventing a client-side distinction
  // between "expired" and "invalid" would recreate the exact oracle the server avoids.
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PinResetForm>({ resolver: zodResolver(pinResetSchema) });

  const onSubmit = async (data: PinResetForm) => {
    if (!token) return;
    setServerError(null);
    setIsLoading(true);
    try {
      // Token and PIN travel straight into the request body and nowhere else - no storage, no
      // console - so there's nothing here to accidentally persist or log.
      await authApi.completeChildPinReset(token, data.newPin);
      setSucceeded(true);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Could not reset the PIN. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-xp-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Link
          href="/child/login"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to child sign-in</span>
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-2xl text-slate-900">TaskBuddy</span>
          </div>

          {!token ? (
            <div className="text-center" role="alert">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-red-600" />
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Invalid link</h1>
              <p className="text-slate-600">
                This PIN reset link is missing its token. Head back to the sign-in screen and have
                your child request a new one.
              </p>
              <Link
                href="/child/login"
                className="inline-block mt-8 text-primary-600 hover:text-primary-700 font-medium"
              >
                Back to child sign-in
              </Link>
            </div>
          ) : succeeded ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-primary-600" />
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">PIN reset</h1>
              <p className="text-slate-600">Your child can now sign in with their new PIN.</p>
              <Link
                href="/child/login"
                className="inline-block mt-8 text-primary-600 hover:text-primary-700 font-medium"
              >
                Take me to child sign-in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
                Set a new PIN
              </h1>
              <p className="text-slate-600 text-center mb-8">
                Choose a new 4-digit PIN for your child to sign in with.
              </p>

              {/* role="alert" + aria-live so a screen reader announces the server's message the
                  moment it arrives, not just when focus happens to land on it. */}
              {serverError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2"
                >
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{serverError}</p>
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/*
                  Unlike reset-password above, these fields carry a real <label> (via Input's
                  `label` prop) rather than relying on a placeholder - the task calls out labelling
                  explicitly. That rules out reset-password's left-icon-inside-the-field layout: an
                  absolutely-positioned icon centered on the *whole* wrapper (label + input) lands
                  on top of the label once one is added, not on the input. ResetPinModal - the
                  other PIN-entry precedent in this codebase - already solves this by skipping the
                  icon for PIN fields, so this follows that rather than reset-password's icon.
                */}
                <div className="space-y-4">
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={VALIDATION.PIN.LENGTH}
                    autoComplete="off"
                    label="New PIN"
                    placeholder="4-digit PIN"
                    className="text-center text-lg tracking-[0.5em]"
                    error={errors.newPin?.message}
                    aria-invalid={!!errors.newPin}
                    {...register('newPin')}
                  />

                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={VALIDATION.PIN.LENGTH}
                    autoComplete="off"
                    label="Confirm new PIN"
                    placeholder="Re-enter the PIN"
                    className="text-center text-lg tracking-[0.5em]"
                    error={errors.confirmPin?.message}
                    aria-invalid={!!errors.confirmPin}
                    {...register('confirmPin')}
                  />
                </div>

                <Button type="submit" fullWidth size="lg" loading={isLoading}>
                  Set new PIN
                </Button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function ChildPinResetPage() {
  return (
    <Suspense>
      <ChildPinResetInner />
    </Suspense>
  );
}
