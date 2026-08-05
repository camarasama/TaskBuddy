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

/**
 * Sentry's BUILD-time plugin — source maps and the release stamp.
 *
 * ## What was missing, and what it cost
 *
 * `src/instrumentation-client.ts` and `src/instrumentation.ts` initialise the SDK, so events have
 * always arrived. But `withSentryConfig` was never applied, and it is a *separate* job: it uploads
 * source maps and injects a release identifier. Without it every browser stack trace was minified
 * (`TypeError: i is not a function`, frames named `uS`/`uE`) and every event carried `release: null`,
 * so Sentry had nothing to match a map against even if one had existed. Diagnosing one crash meant
 * downloading the deployed chunk and reading it at a byte offset by hand.
 *
 * Initialising the SDK and uploading source maps are easy to conflate. They are not the same thing —
 * the mobile app has both (verified 2026-08-02); the web had only the first.
 *
 * ## Wrapping order
 *
 * Sentry goes OUTERMOST, around next-pwa's output. Its webpack plugin has to see the final compiler
 * configuration, including the chunks next-pwa adds; wrapping the other way round would leave the
 * service worker's bundle unmapped.
 *
 * ## Degrades to a normal build without credentials
 *
 * The upload needs SENTRY_AUTH_TOKEN at BUILD time — and this project builds on the VPS, so the
 * token has to exist there, not just on a laptop. Without it the build still succeeds and simply
 * uploads nothing, matching how `mobile/app.config.ts` treats the same three variables. An auth
 * token must never be committed, so an absent one cannot be allowed to break a deploy.
 *
 * `silent` is tied to the token's presence rather than hardcoded: when it is missing, the plugin's
 * warning is the only clue that traces will be unreadable, and silencing that would rebuild exactly
 * the situation this block exists to fix.
 */
function withSentry(config) {
  const { withSentryConfig } = require('@sentry/nextjs');
  const hasUploadToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,

    /**
     * The release identifier every event gets stamped with, and the key uploaded maps are filed
     * under. Both sides must agree or the maps are uploaded into a bucket nothing looks in.
     *
     * Left to the plugin's own detection (the git SHA of the build tree) unless SENTRY_RELEASE is
     * set. Auto-detection is right for this project because the VPS builds from a checkout of the
     * deployed commit, so the release lands equal to the SHA — which makes "which deploy introduced
     * this" answerable without any extra bookkeeping. The override exists for a build from a
     * detached or dirty tree, where the SHA would be misleading.
     */
    release: process.env.SENTRY_RELEASE ? { name: process.env.SENTRY_RELEASE } : undefined,

    silent: hasUploadToken,

    /**
     * Both of these live under `webpack` rather than at the top level. The flat `automaticVercelMonitors`
     * and `disableLogger` still work in @sentry/nextjs 10.63 but emit deprecation warnings on every
     * build, and a deprecated option in a file nobody reads is how a future SDK bump breaks a deploy.
     */
    webpack: {
      // Not a Vercel deployment — this would otherwise wire up cron monitors that do not exist.
      automaticVercelMonitors: false,
      treeshake: {
        // Strips Sentry's own debug logging from the client bundle. Pure size win for a family
        // audience on cheap phones and metered data.
        removeDebugLogging: true,
      },
    },

    sourcemaps: {
      /**
       * ⚠️ Without a token, generate NOTHING.
       *
       * This guard is the whole safety of the block and was added after watching a
       * credential-less build emit `chunks/9959-….js.map` at 2.4 MB. Next does not produce browser
       * source maps in production on its own — **this plugin turns them on** so it has something to
       * upload. When the upload cannot happen, `deleteSourcemapsAfterUpload` has nothing to clean up
       * either, so the maps survive into `.next/static` and are served to anyone who asks for them.
       *
       * That failure is silent and points the wrong way: a build with no credentials looks like
       * "Sentry is off", while actually publishing the app's original source. And the VPS has no
       * SENTRY_AUTH_TOKEN today, so this is the live path, not a hypothetical one.
       *
       * With the flag, a token-less build behaves exactly as it did before this file was touched.
       */
      disable: !hasUploadToken,

      /**
       * Delete the maps once they are uploaded.
       *
       * Sentry does not need them at runtime — it resolves stack traces server-side from what was
       * uploaded — so serving them publicly is cost without benefit.
       *
       * Pointed enough to state: the postcss advisory patched in #126 was precisely about an
       * attacker-controlled `sourceMappingURL` causing arbitrary `.map` files to be read. Shipping
       * real maps to production while fixing that would be an odd trade.
       */
      deleteSourcemapsAfterUpload: true,
    },

    /**
     * Uploads maps for the framework and vendor chunks too, not only application code.
     *
     * This case argues for it directly: the crash under investigation lives entirely inside React's
     * reconciler chunk. Application-only maps would have left that trace exactly as unreadable as it
     * was before.
     */
    widenClientFileUpload: true,
  });
}

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
  module.exports = withSentry(withPWA(nextConfig));
} else {
  // Dev is deliberately untouched: no upload, no release injection, and no plugin in the Turbopack
  // path — this config's `turbopack: {}` branch is what `next dev` uses, and the Sentry webpack
  // plugin has no business there.
  module.exports = nextConfig;
}
