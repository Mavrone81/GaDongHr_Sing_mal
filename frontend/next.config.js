/** @type {import('next').NextConfig} */

// SECURITY (H-18): Strong default security headers, including CSP. Closes
// the defense-in-depth gap behind the three stored-XSS sinks fixed in
// C-13, C-14, H-01 — even if a future XSS lands, inline script execution
// is blocked.
//
// `connect-src` enumerates the API gateway URL so apiFetch keeps working
// from the browser. Adjust via NEXT_PUBLIC_API_URL at build time.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const apiOrigin = (() => {
  try { return new URL(apiUrl).origin; } catch { return apiUrl; }
})();

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' kept on script-src for Next.js's runtime chunks/initData;
  // tighten to nonces once we move to nonce-based hydration.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${apiOrigin}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy',     value: csp },
  { key: 'X-Frame-Options',             value: 'DENY' },
  { key: 'X-Content-Type-Options',      value: 'nosniff' },
  { key: 'Referrer-Policy',             value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',          value: 'camera=(self), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security',   value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};

module.exports = nextConfig;
