'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowLeft, Users, Delete, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';

const STORAGE_KEY_FAMILY_CODE = 'taskbuddy_child_familyCode';
const STORAGE_KEY_NAME = 'taskbuddy_child_name';

function getSavedCredentials(): { familyCode: string; childName: string } | null {
  if (typeof window === 'undefined') return null;
  const familyCode = localStorage.getItem(STORAGE_KEY_FAMILY_CODE);
  const childName = localStorage.getItem(STORAGE_KEY_NAME);
  if (familyCode && childName) {
    return { familyCode, childName };
  }
  return null;
}

function saveCredentials(familyCode: string, childName: string) {
  localStorage.setItem(STORAGE_KEY_FAMILY_CODE, familyCode);
  localStorage.setItem(STORAGE_KEY_NAME, childName);
}

function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY_FAMILY_CODE);
  localStorage.removeItem(STORAGE_KEY_NAME);
}

export default function ChildLoginPage() {
  const saved = getSavedCredentials();
  const [step, setStep] = useState<'family' | 'name' | 'pin'>(saved ? 'pin' : 'family');
  const [familyCode, setFamilyCode] = useState(saved?.familyCode || '');
  const [childName, setChildName] = useState(saved?.childName || '');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { childLogin } = useAuth();
  const { error: showError } = useToast();
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Focus PIN input when reaching PIN step
  useEffect(() => {
    if (step === 'pin' && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [step]);

  const handlePinKeyPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);

      // Auto-submit when PIN is exactly 4 digits
      if (newPin.length === 4) {
        setTimeout(() => {
          handleLogin(newPin);
        }, 200);
      }
    }
  };

  const handlePinDelete = () => {
    setPin(pin.slice(0, -1));
  };

  const handleLogin = async (pinToUse: string) => {
    if (pinToUse.length < 4) return;

    setIsLoading(true);
    try {
      // Pass familyCode (uppercased) — the backend resolves it to a familyId
      await childLogin(familyCode.toUpperCase().trim(), childName, pinToUse);
      // Save on successful login so next visit skips straight to PIN
      saveCredentials(familyCode.toUpperCase().trim(), childName);
    } catch (err) {
      setPin('');
      if (err instanceof ApiError) {
        showError(err.message);
      } else {
        showError('Failed to log in. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFamilySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (familyCode.trim()) {
      setStep('name');
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (childName.trim()) {
      setStep('pin');
    }
  };

  const handleChangeIdentity = () => {
    clearCredentials();
    setPin('');
    setFamilyCode('');
    setChildName('');
    setStep('family');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-xp-50 via-white to-gold-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Back */}
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
            <div className="w-12 h-12 bg-gradient-to-br from-xp-400 to-xp-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <span className="font-display font-bold text-2xl text-slate-900">
              TaskBuddy
            </span>
          </div>

          {/* Step: Family Code */}
          {step === 'family' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
                Hey there!
              </h1>
              <p className="text-slate-600 text-center mb-8">
                Enter your family code to get started
              </p>

              <form onSubmit={handleFamilySubmit} className="space-y-6">
                <div className="relative">
                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    placeholder="e.g. HAPPY-LION-4821"
                    className="pl-12 text-center text-lg font-mono uppercase tracking-wider"
                    value={familyCode}
                    onChange={(e) => setFamilyCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button type="submit" fullWidth size="lg" disabled={!familyCode.trim()}>
                  Next
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500">
                Ask your parent for your family code!
              </p>
            </motion.div>
          )}

          {/* Step: Child Name */}
          {step === 'name' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
                Who are you?
              </h1>
              <p className="text-slate-600 text-center mb-8">
                Enter your name or username
              </p>

              <form onSubmit={handleNameSubmit} className="space-y-6">
                <Input
                  placeholder="Your Name"
                  className="text-center text-lg"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => setStep('family')}
                  >
                    Back
                  </Button>
                  <Button type="submit" fullWidth size="lg" disabled={!childName.trim()}>
                    Next
                  </Button>
                </div>
              </form>
            </motion.div>
          )}

          {/* Step: PIN Entry */}
          {step === 'pin' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              {/* Welcome Back Banner — shows the readable family code, not a UUID */}
              <div className="bg-xp-50 rounded-xl p-3 mb-6">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-xp-700 font-medium truncate">
                      Welcome back, <strong>{childName}</strong>
                    </p>
                    <p className="text-xs text-xp-500 font-mono truncate">
                      {familyCode.toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={handleChangeIdentity}
                    className="flex-shrink-0 ml-2 p-1.5 rounded-lg hover:bg-xp-100 transition-colors"
                    title="Change family or name"
                  >
                    <Edit2 className="w-4 h-4 text-xp-600" />
                  </button>
                </div>
              </div>

              <h1 className="font-display text-2xl font-bold text-slate-900 text-center mb-2">
                Enter Your PIN
              </h1>
              <p className="text-slate-600 text-center mb-8">
                Type your secret PIN to log in
              </p>

              {/* PIN Display */}
              <div className="flex justify-center gap-3 mb-8">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-14 h-16 rounded-xl border-2 flex items-center justify-center transition-all ${
                      pin.length > i
                        ? 'border-xp-500 bg-xp-50'
                        : 'border-slate-200'
                    }`}
                  >
                    {pin.length > i && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-4 h-4 rounded-full bg-xp-500"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Number Pad */}
              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((item, index) => (
                  <div key={index}>
                    {item === null ? (
                      <div />
                    ) : item === 'del' ? (
                      <button
                        type="button"
                        onClick={handlePinDelete}
                        disabled={isLoading || pin.length === 0}
                        className="w-full aspect-square rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center text-slate-600 transition-colors disabled:opacity-50"
                      >
                        <Delete className="w-6 h-6" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePinKeyPress(item.toString())}
                        disabled={isLoading || pin.length >= 4}
                        className="w-full aspect-square rounded-2xl bg-slate-50 hover:bg-xp-50 active:bg-xp-100 flex items-center justify-center text-2xl font-bold text-slate-900 transition-colors disabled:opacity-50 border border-slate-200"
                      >
                        {item}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Hidden input for keyboard support */}
              <input
                ref={pinInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => {
                  const newPin = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(newPin);
                  if (newPin.length === 4) {
                    handleLogin(newPin);
                  }
                }}
                className="sr-only"
                autoFocus
              />

              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleChangeIdentity}
                >
                  Not you? Change account
                </Button>
              </div>

              {isLoading && (
                <div className="mt-4 flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-4 border-xp-500 border-t-transparent" />
                </div>
              )}
            </motion.div>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200">
            <Link
              href="/login"
              className="block text-center text-sm text-slate-500 hover:text-slate-700"
            >
              Are you a parent? Sign in here
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}