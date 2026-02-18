'use client';

/**
 * register/page.tsx — Updated M7 (CR-02)
 *
 * Changes from M7:
 *  - Added dateOfBirth field (required, date picker)
 *  - Added phoneNumber field (optional, E.164 with +233 default prefix)
 *  - Both fields are passed through to the auth service on submit
 *  - Phone field shows country code hint and optional label
 */

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { CheckCircle2, User, Mail, Lock, Home, ArrowLeft, Calendar, Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';

const MIN_PASSWORD_LENGTH = 8;

/**
 * M7 — CR-02: registerSchema updated to include dateOfBirth and phoneNumber.
 * These mirror the backend Zod schema in auth.ts (routes).
 *
 * dateOfBirth: required. The HTML date input natively produces YYYY-MM-DD.
 * phoneNumber: optional. Validated to be E.164 format if provided.
 *              The +233 hint is shown in the UI but the field is freeform
 *              so parents in other countries can enter their own prefix.
 */
const registerSchema = z
  .object({
    familyName: z.string().min(2, 'Family name must be at least 2 characters').max(100),
    firstName: z.string().min(1, 'First name is required').max(50),
    lastName: z.string().min(1, 'Last name is required').max(50),
    email: z.string().email('Please enter a valid email'),
    // M7 — CR-02: Required date of birth
    dateOfBirth: z.string().min(1, 'Date of birth is required').regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'Please select a valid date'
    ),
    // M7 — CR-02: Optional phone in E.164 format
    phoneNumber: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Use international format e.g. +233201234567'
      )
      .optional()
      .or(z.literal('')), // allow empty string (treated as not provided)
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false);
  const { register: registerUser } = useAuth();
  const { error: showError } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterForm) => {
    setIsLoading(true);
    try {
      // M7 — CR-02: Pass dateOfBirth and phoneNumber to the register function.
      // phoneNumber is omitted if empty string (treat as not provided).
      await registerUser(data.familyName, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        dateOfBirth: data.dateOfBirth,
        phoneNumber: data.phoneNumber || undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message);
      } else {
        showError('Failed to create account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // M7 — CR-02: Calculate max date for DOB picker (must be at least 18 years old)
  const maxDobDate = new Date();
  maxDobDate.setFullYear(maxDobDate.getFullYear() - 18);
  const maxDobString = maxDobDate.toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-xp-50 flex items-center justify-center p-4 py-12">
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
            Create Your Family Account
          </h1>
          <p className="text-slate-600 text-center mb-8">
            Start your family&apos;s task adventure today!
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">

              {/* Family Name */}
              <div className="relative">
                <Home className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input
                  placeholder="Family Name (e.g., The Mensahs)"
                  className="pl-12"
                  error={errors.familyName?.message}
                  {...register('familyName')}
                />
              </div>

              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    placeholder="First Name"
                    className="pl-12"
                    error={errors.firstName?.message}
                    {...register('firstName')}
                  />
                </div>
                <Input
                  placeholder="Last Name"
                  error={errors.lastName?.message}
                  {...register('lastName')}
                />
              </div>

              {/* Email */}
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

              {/* M7 — CR-02: Date of Birth (required) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Date of Birth <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                  <Input
                    type="date"
                    className="pl-12"
                    max={maxDobString}
                    error={errors.dateOfBirth?.message}
                    {...register('dateOfBirth')}
                  />
                </div>
              </div>

              {/* M7 — CR-02: Phone Number (optional) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Phone Number{' '}
                  <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    type="tel"
                    placeholder="+233201234567"
                    className="pl-12"
                    error={errors.phoneNumber?.message}
                    {...register('phoneNumber')}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  International format with country code (e.g. +233 for Ghana)
                </p>
              </div>

              {/* Password */}
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

              {/* Confirm Password */}
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input
                  type="password"
                  placeholder="Confirm Password"
                  className="pl-12"
                  error={errors.confirmPassword?.message}
                  {...register('confirmPassword')}
                />
              </div>
            </div>

            <Button type="submit" fullWidth size="lg" loading={isLoading}>
              Create Account
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-center text-slate-600">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}