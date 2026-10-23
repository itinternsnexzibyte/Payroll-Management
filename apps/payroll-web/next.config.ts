import type { NextConfig } from 'next';
import path from 'node:path';

// The browser only talks to this origin; /api/* is proxied to the Payroll API so the session
// cookie is first-party (SameSite=Strict). API_INTERNAL_URL is read at build time.
// Some local hosts supply "host:port" with no scheme, so add http:// when missing.
function apiOrigin(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return 'http://localhost:4001';
  const url = new URL(/^https?:\/\//i.test(v) ? v : `http://${v}`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API_INTERNAL_URL must not contain credentials, a query string, or a fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}
const API = apiOrigin(process.env.API_INTERNAL_URL);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        {
          key: 'Content-Security-Policy',
          value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allows a second instance (e.g. E2E tests) to run alongside the dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: { externalDir: true },
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
