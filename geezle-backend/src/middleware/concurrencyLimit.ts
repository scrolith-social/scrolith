import type { RequestHandler } from 'express';

export const createConcurrencyLimit = (options: {
  max: number;
  shouldLimit: () => boolean;
  message: string;
  retryAfterSeconds?: number;
}): RequestHandler => {
  let active = 0;
  const max = Math.max(1, Math.trunc(options.max));
  return (_req, res, next) => {
    if (!options.shouldLimit()) return next();
    if (active >= max) {
      res.setHeader('Retry-After', String(options.retryAfterSeconds ?? 5));
      res.status(503).json({ success: false, error: options.message });
      return;
    }

    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
};
