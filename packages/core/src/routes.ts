/**
 * Path prefixes on de-class.vta.dev. The server, the PWA and the service worker
 * all route by these, and Cloudflare Access applications are configured per prefix.
 */
export const ROUTES = {
  api: '/api',
  auth: '/auth',
  agent: '/agent/v1',
  demo: '/demo/',
  health: '/healthz',
} as const;
