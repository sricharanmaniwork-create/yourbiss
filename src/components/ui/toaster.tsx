'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      gap={8}
      visibleToasts={4}
      toastOptions={{
        style: {
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 6px 16px rgba(16, 24, 40, 0.12)',
          fontSize: '13px',
          color: '#111827',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
