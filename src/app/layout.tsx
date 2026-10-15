import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { optionalEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: {
    default: 'Yourbiss',
    template: '%s · Yourbiss',
  },
  description:
    'One workspace for your website, forms, bookings, store and CRM. Build pages by dragging blocks, take bookings, and collect responses.',
  applicationName: 'Yourbiss',
  metadataBase: new URL(readBaseUrl()),
  icons: { icon: '/favicon.ico' },
  robots: { index: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2e6be6',
};

function readBaseUrl() {
  // Metadata is built before a request exists, so the configured public URL is
  // the only sane origin. `optionalEnv` never throws, which keeps a build with
  // missing credentials from failing here.
  return optionalEnv('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000';
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
