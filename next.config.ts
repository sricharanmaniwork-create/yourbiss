import path from 'node:path';
import type { NextConfig } from 'next';

const HELMET_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    // Without this Turbopack walks up past the project and finds a stray
    // package-lock.json in the home directory.
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    return [
      {
        // The builder and every signed-in surface. Public pages get a relaxed
        // frame policy below so a booking/form block can be embedded on a site.
        source: '/((?!embed/).*)',
        headers: HELMET_HEADERS,
      },
      {
        source: '/embed/:path*',
        headers: [
          ...HELMET_HEADERS.filter((h) => h.key !== 'X-Frame-Options'),
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
