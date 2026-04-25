/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
  transpilePackages: ['@taskbuddy/shared'],
  // Turbopack for dev; production build uses --webpack flag for next-pwa compatibility
  turbopack: {},
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
  });
  module.exports = withPWA(nextConfig);
} else {
  module.exports = nextConfig;
}
