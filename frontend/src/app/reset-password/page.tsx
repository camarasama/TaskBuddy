'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { CheckCircle2, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authApi, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const MIN_PASSWORD_LENGTH = 8;

const resetSchema = z
  .object({
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetForm = z.infer<typeof resetSchema>;

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { success: showSuccess, error: showError } = useToast();

  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  const onSubmit = async (data: ResetForm) => {
    if (!token) return;
    setIsLoading(true);
    try {
      await authApi.resetPassword(token, data.newPassword);
      showSuccess('Password reset! Please sign in with your new password.');
      router.push('/login');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not reset your password. Please try again.';
      showError(message);
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
          href="/login"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to sign in</span>
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-2xl text-slate-900">TaskBuddy</span>
          </div>

          {!token ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-red-600" />
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Invalid link</h1>
              <p className="text-slate-600">
                This password reset link is missing its token. Request a new one from the sign-in page.
              </p>
              <Link
                href="/forgot-password"
                className="inline-block mt-8 text-primary-600 hover:text-primary-700 font-medium"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
                Choose a new password
              </h1>
              <p className="text-slate-600 text-center mb-8">
                Enter a new password for your account.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4">
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="New password"
                      className="pl-12"
                      error={errors.newPassword?.message}
                      {...register('newPassword')}
                    />
                  </div>

                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      className="pl-12"
                      error={errors.confirmPassword?.message}
                      {...register('confirmPassword')}
                    />
                  </div>
                </div>

                <Button type="submit" fullWidth size="lg" loading={isLoading}>
                  Reset password
                </Button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}
