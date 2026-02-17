'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-95',
  {
    variants: {
      variant: {
        primary: 'bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-500',
        secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus:ring-slate-400',
        success: 'bg-success-500 text-white hover:bg-success-600 focus:ring-success-500',
        warning: 'bg-warning-500 text-white hover:bg-warning-600 focus:ring-warning-500',
        gold: 'bg-gold-500 text-white hover:bg-gold-600 focus:ring-gold-500',
        xp: 'bg-xp-500 text-white hover:bg-xp-600 focus:ring-xp-500',
        outline: 'border-2 border-slate-300 bg-transparent hover:bg-slate-50 focus:ring-slate-400',
        ghost: 'bg-transparent hover:bg-slate-100 focus:ring-slate-400',
        destructive: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
      },
      size: {
        sm: 'px-3 py-1.5 text-sm min-h-[36px]',
        md: 'px-4 py-2 text-base min-h-[44px]',
        lg: 'px-6 py-3 text-lg min-h-[52px]',
        xl: 'px-8 py-4 text-xl min-h-[60px]',
        icon: 'w-10 h-10 p-0',
        'icon-sm': 'w-8 h-8 p-0',
        'icon-lg': 'w-12 h-12 p-0',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span>Loading...</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
