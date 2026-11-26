import type { Request, Response } from 'express';

export const isBasicHealthPath = (req: { method?: string; originalUrl?: string }) => {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return (method === 'GET' || method === 'HEAD') &&
    (path === '/api/health' || path === '/api/health/clamav');
};

/** Exact, read-only readiness probes bypass the global API limiter so a failed
 * dependency can be reported as NOT_READY instead of being masked as 429.
 * Readiness remains dependency-aware in its handler; product/API traffic keeps
 * its regular distributed rate limits.
 */
export const isReadinessPath = (req: { method?: string; originalUrl?: string }) => {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return (method === 'GET' || method === 'HEAD') &&
    (path === '/api/readyz' || path === '/api/health/ready');
};

export const buildPublicHealthPayload = () => ({ status: 'OK' });

export const handleBasicHealth = (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).json(buildPublicHealthPayload());
  } catch {
    console.error('Health check failed', { reason: 'handler_error' });
    if (req.method === 'HEAD') {
      res.status(500).end();
      return;
    }
    res.status(500).json({ status: 'ERROR' });
  }
};
