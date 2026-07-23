/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// F-5 (Phase 4): Content-Security-Policy. Shipped as **Report-Only** first so violations are logged
// (browser console) without breaking the app; promote to enforcing `Content-Security-Policy` once the
// report-only period is clean. Notes for the enforce step: the Sentry ingest host (from
// NEXT_PUBLIC_SENTRY_DSN) will need adding to connect-src; watch for any other flagged origin.
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next injects inline bootstrap scripts; tighten to nonces later
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.gettaskbuddy.com https://*.r2.cloudflarestorage.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.gettaskbuddy.com wss://api.gettaskbuddy.com",
  "worker-src 'self' blob:", // next-pwa service worker
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: cspDirectives },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // camera stays enabled for evidence-photo capture; geolocation + microphone fully off.
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
  transpilePackages: ['@taskbuddy/shared'],
  // Turbopack for dev; production build uses --webpack flag for next-pwa compatibility
  turbopack: {},
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },
};

// PWA only applies in production builds (webpack mode)
// next-pwa v5 API: withPWA(config)(nextConfig)
if (isProd) {
  const withPWA = require('next-pwa')({
    dest: 'public',
    register: true,
    skipWaiting: true,
    disable: false,
    customWorkerDir: 'src/service-worker',
  });
  module.exports = withPWA(nextConfig);
} else {
  module.exports = nextConfig;
}
