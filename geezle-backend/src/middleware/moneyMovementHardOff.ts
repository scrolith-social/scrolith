import type { NextFunction, Request, Response } from 'express';
import { isMoneyMovementEnabled } from '../config/moneyMovement';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CALLBACK_PATH = /^\/api\/payments\/(?:dragonpay\/callback|[^/]+\/(?:callback|return))(?:\/|$)/i;
const FINANCIAL_NAMESPACE = /^\/api\/(?:wallet|withdrawal|payments?|payouts|escrow|gcoin|founding-partners)(?:\/|$)/i;
const ADMIN_FINANCIAL_NAMESPACE = /^\/api\/admin\/(?:withdrawals|payouts(?:\/stripe)?|wallet|gcoin|finance|founding-partners|community\/gcoin)(?:\/|$)/i;
const MONEY_ACTION_PATHS = [
  /^\/api\/webhooks\/stripe(?:\/|$)/i,
  /^\/api\/commerce\/.*\/(?:purchase|checkout|payment)(?:\/|$)/i,
  /^\/api\/marketplace\/.*\/(?:orders|checkout)(?:\/|$)/i,
  /^\/api\/contracts\/[^/]+\/(?:pay|settle|settlement|release|refund)(?:\/|$)/i,
  /^\/api\/plans\/(?:purchase|checkout|subscribe)(?:\/|$)/i,
  /^\/api\/marketing\/affiliate\/withdraw(?:\/|$)/i,
  /^\/api\/live\/sessions\/[^/]+\/gifts(?:\/|$)/i,
  /^\/api\/insights\/streak\/reward-drops\/[^/]+\/claim(?:\/|$)/i,
  /^\/api\/insights\/engagement-phase\/fan-channels\/[^/]+\/subscribe(?:\/|$)/i,
  /^\/api\/insights\/engagement-phase\/premium-series\/[^/]+\/unlock(?:\/|$)/i,
  /^\/api\/insights\/engagement-phase\/bounties\/questions\/[^/]+\/award(?:\/|$)/i,
  /^\/api\/community\/(?:gcoin(?:\/|$)|ads\/[^/]+\/pay(?:\/|$))/i,
  /^\/api\/admin\/community\/ads\/[^/]+\/(?:pay|refund)(?:\/|$)/i,
  /^\/api\/phase3\/.*\/(?:payout|withdraw|transfer|settle|release|refund)(?:\/|$)/i
];

export const isMoneyMovementMutation = (request: Pick<Request, 'method' | 'originalUrl'>): boolean => {
  const method = String(request.method || '').toUpperCase();
  const path = String(request.originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (!WRITE_METHODS.has(method)) return (method === 'GET' || method === 'HEAD') && CALLBACK_PATH.test(path);
  return FINANCIAL_NAMESPACE.test(path) || ADMIN_FINANCIAL_NAMESPACE.test(path) || MONEY_ACTION_PATHS.some((pattern) => pattern.test(path));
};

/** Blocks all server-side financial mutations while the explicit pilot gate is off. */
export const moneyMovementHardOff = (req: Request, res: Response, next: NextFunction): void => {
  if (!isMoneyMovementMutation(req) || isMoneyMovementEnabled()) {
    next();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({
    success: false,
    code: 'MONEY_MOVEMENT_DISABLED',
    error: 'Money movement is disabled by server policy.'
  });
};
