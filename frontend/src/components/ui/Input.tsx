'use client';

import { forwardRef, InputHTMLAttributes, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helper, id, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const inputId = id || props.name;
    const isPassword = type === 'password';

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <input
            type={isPassword && showPassword ? 'text' : type}
            id={inputId}
            className={cn(
              'w-full px-4 py-3 rounded-lg border bg-white text-slate-900 placeholder-slate-400',
              'focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200',
              error
                ? 'border-red-300 focus:ring-red-500'
                : 'border-slate-300 focus:ring-primary-500',
              isPassword && 'pr-12',
              className
            )}
            ref={ref}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          )}
        </div>
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
        {helper && !error && (
          <p className="mt-1.5 text-sm text-slate-500">{helper}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
