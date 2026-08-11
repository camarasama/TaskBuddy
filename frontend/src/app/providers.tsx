'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ReactErrorReporter } from '@/components/ReactErrorReporter';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ToastProvider>
        {/*
          Innermost, so the component stack it records is the page's own tree rather than a stack
          that stops at <AuthProvider>. It changes nothing about what the user sees — see the note on
          the component itself.
        */}
        <ReactErrorReporter>{children}</ReactErrorReporter>
      </ToastProvider>
    </AuthProvider>
  );
}
