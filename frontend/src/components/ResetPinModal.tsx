'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Key, X, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface ResetPinModalProps {
  childId: string;
  childName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ResetPinModal({ childId, childName, onClose, onSuccess }: ResetPinModalProps) {
  const { error: showError, success: showSuccess } = useToast();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pinInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate PIN
    if (!/^\d{4}$/.test(pin)) {
      showError('PIN must be exactly 4 digits');
      return;
    }

    if (pin !== confirmPin) {
      showError('PINs do not match');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.setupPin(childId, pin);
      showSuccess(`PIN reset successfully for ${childName}`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset PIN';
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinChange = (value: string, setter: (v: string) => void) => {
    // Only allow digits, max 4 characters
    const sanitized = value.replace(/\D/g, '').slice(0, 4);
    setter(sanitized);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Reset PIN
              </h2>
              <p className="text-sm text-slate-500">For {childName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New PIN */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              New PIN
            </label>
            <div className="relative">
              <input
                ref={pinInputRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={pin}
                onChange={(e) => handlePinChange(e.target.value, setPin)}
                placeholder="Enter 4-digit PIN"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-center text-2xl tracking-widest"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Must be exactly 4 digits
            </p>
          </div>

          {/* Confirm PIN */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Confirm PIN
            </label>
            <input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
              placeholder="Confirm 4-digit PIN"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-center text-2xl tracking-widest"
            />
          </div>

          {/* PIN Match Indicator */}
          {pin.length === 4 && confirmPin.length > 0 && (
            <div className={`text-sm ${pin === confirmPin ? 'text-green-600' : 'text-red-600'}`}>
              {pin === confirmPin ? '✓ PINs match' : '✗ PINs do not match'}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              fullWidth
              loading={isLoading}
              disabled={pin.length !== 4 || pin !== confirmPin}
            >
              Reset PIN
            </Button>
          </div>
        </form>

        {/* Help Text */}
        <p className="mt-4 text-xs text-slate-500 text-center">
          {childName} will use this PIN to log in on shared devices
        </p>
      </motion.div>
    </div>
  );
}
