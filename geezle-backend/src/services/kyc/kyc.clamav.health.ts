import type { RequestHandler } from 'express';
import { pingClamAv } from './kyc.clamav.service';

/** Minimal status-only endpoint used by the ACA sidecar readiness probe. */
export const clamAvHealthHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ready = await pingClamAv(1000);
    return res.status(ready ? 200 : 503).json({ status: ready ? 'READY' : 'NOT_READY' });
  } catch {
    return res.status(503).json({ status: 'NOT_READY' });
  }
};
