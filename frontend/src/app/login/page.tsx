'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { CheckCircle2, Mail, Lock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { error: showError } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message);
      } else {
        showError('Failed to sign in. Please try again.');
      }
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
        {/* Back to home */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to home</span>
        </Link>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-2xl text-slate-900">
              TaskBuddy
            </span>
          </div>

          <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
            Welcome Back!
          </h1>
          <p className="text-slate-600 text-center mb-8">
            Sign in to manage your family tasks
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input
                  type="email"
                  placeholder="Email address"
                  className="pl-12"
                  error={errors.email?.message}
                  {...register('email')}
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input
                  type="password"
                  placeholder="Password"
                  className="pl-12"
                  error={errors.password?.message}
                  {...register('password')}
                />
              </div>
            </div>

            <Button type="submit" fullWidth size="lg" loading={isLoading}>
              Sign In
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-center text-slate-600">
              Don&apos;t have an account?{' '}
              <Link
                href="/register"
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                Create one
              </Link>
            </p>
          </div>

          <div className="mt-4">
            <Link
              href="/child/login"
              className="block text-center text-sm text-slate-500 hover:text-slate-700"
            >
              Are you a child? Log in with your PIN
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
