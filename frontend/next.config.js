/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// F-5 (Phase 4): Content-Security-Policy. Shipped as **Report-Only** first so violations are logged
// (browser console) without breaking the app.
//
// OI-2 (promote to enforcing): once a report-only window is clean, change CSP_HEADER below to
// 'Content-Security-Policy' — that single line is the whole flip. The Sentry ingest origin is
// already handled: it is derived from NEXT_PUBLIC_SENTRY_DSN at request time (see below), so no
// account-specific host has to be hardcoded and no origin is silently missing at enforce time.
const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/**
 * Origin (scheme + host, no credentials, no path) of the Sentry ingest endpoint, derived from the
 * DSN. A DSN looks like `https://<publicKey>@o123.ingest.sentry.io/456`; `URL.host` drops the
 * userinfo, so the public key never lands in a response header. Returns null when Sentry is
 * disabled (DSN unset — the documented way to turn it off) or the DSN is unparseable, so a bad
 * value degrades to "no extra origin" instead of poisoning connect-src.
 */
function sentryIngestOrigin() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const { protocol, host } = new URL(dsn);
    if (protocol !== 'https:' || !host) return null;
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

function buildCspDirectives() {
  const connectSrc = ["'self'", 'https://api.gettaskbuddy.com', 'wss://api.gettaskbuddy.com'];
  const ingest = sentryIngestOrigin();
  if (ingest) connectSrc.push(ingest); // error reporting must survive the enforce flip

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Next injects inline bootstrap scripts; tighten to nonces later
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.gettaskbuddy.com https://*.r2.cloudflarestorage.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:", // next-pwa service worker
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function buildSecurityHeaders() {
  return [
    { key: CSP_HEADER, value: buildCspDirectives() },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // camera stays enabled for evidence-photo capture; geolocation + microphone fully off.
    { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
  ];
}

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
  transpilePackages: ['@taskbuddy/shared'],
  // Turbopack for dev; production build uses --webpack flag for next-pwa compatibility
  turbopack: {},
  async headers() {
    return [{ source: '/(.*)', headers: buildSecurityHeaders() }];
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
