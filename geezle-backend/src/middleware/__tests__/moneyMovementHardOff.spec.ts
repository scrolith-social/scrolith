import { isMoneyMovementEnabled } from '../../config/moneyMovement';
import { isMoneyMovementMutation, moneyMovementHardOff } from '../moneyMovementHardOff';

describe('server-side money-movement hard-off', () => {
  test('requires an explicit true setting and does not infer activation from test mode', () => {
    expect(isMoneyMovementEnabled({})).toBe(false);
    expect(isMoneyMovementEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(isMoneyMovementEnabled({ PAYMENT_TEST_MODE: 'true' })).toBe(false);
    expect(isMoneyMovementEnabled({ SCROLITH_MONEY_MOVEMENT_ENABLED: 'false' })).toBe(false);
    expect(isMoneyMovementEnabled({ SCROLITH_MONEY_MOVEMENT_ENABLED: 'true' })).toBe(true);
  });

  test.each([
    ['POST', '/api/wallet/admin/gateways/activation'],
    ['POST', '/api/wallet/topup/initiate'],
    ['POST', '/api/payments/create-intent'],
    ['POST', '/api/payments/webhook'],
    ['POST', '/api/payments/stripe/webhook'],
    ['POST', '/api/webhooks/stripe'],
    ['POST', '/api/payments/antom/notify'],
    ['POST', '/api/withdrawal/request'],
    ['POST', '/api/admin/withdrawals/intent-1/mark-paid'],
    ['POST', '/api/admin/community/gcoin/credit'],
    ['POST', '/api/escrow/order-1/release'],
    ['POST', '/api/gcoin/transfer'],
    ['POST', '/api/community/gcoin/donate'],
    ['POST', '/api/commerce/gigs/gig-1/purchase'],
    ['POST', '/api/marketplace/listings/listing-1/orders'],
    ['POST', '/api/live/sessions/session-1/gifts'],
    ['POST', '/api/contracts/contract-1/pay'],
    ['POST', '/api/plans/purchase'],
    ['POST', '/api/community/ads/ad-1/pay'],
    ['POST', '/api/insights/streak/reward-drops/drop-1/claim'],
    ['POST', '/api/insights/engagement-phase/fan-channels/channel-1/subscribe'],
    ['POST', '/api/insights/engagement-phase/premium-series/series-1/unlock'],
    ['POST', '/api/insights/engagement-phase/bounties/questions/question-1/award'],
    ['POST', '/api/admin/community/ads/ad-1/refund'],
    ['GET', '/api/payments/dragonpay/callback?reference=synthetic']
  ])('classifies %s %s as a money-moving operation', (method, originalUrl) => {
    expect(isMoneyMovementMutation({ method, originalUrl } as any)).toBe(true);
  });

  test.each([
    ['POST', '/api/wallet/admin/gateways'],
    ['GET', '/api/wallet/me'],
    ['GET', '/api/payments/methods/active'],
    ['GET', '/api/wallet/topup/status/intent-1'],
    ['POST', '/api/feed/posts'],
    ['POST', '/api/community/posts'],
    ['POST', '/api/marketplace/listings'],
    ['POST', '/api/monetization/apply'],
    ['POST', '/api/live/sessions/session-1/reactions']
  ])('does not classify unrelated/read-only %s %s as money movement', (method, originalUrl) => {
    expect(isMoneyMovementMutation({ method, originalUrl } as any)).toBe(false);
  });

  test('returns a fail-closed response without invoking downstream handlers', () => {
    const oldValue = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const res: any = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    const next = jest.fn();
    try {
      moneyMovementHardOff({ method: 'POST', originalUrl: '/api/wallet/topup/initiate' } as any, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MONEY_MOVEMENT_DISABLED' }));
      expect(next).not.toHaveBeenCalled();
    } finally {
      if (oldValue === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = oldValue;
    }
  });

  test('allows a non-financial mutation while the hard-off is active', () => {
    const oldValue = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const res: any = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    try {
      moneyMovementHardOff({ method: 'POST', originalUrl: '/api/feed/posts' } as any, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      if (oldValue === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = oldValue;
    }
  });

  test('allows gateway credential settings while keeping gateway activation blocked', () => {
    const oldValue = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const settingsResponse: any = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
    const activationResponse: any = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
    settingsResponse.status.mockReturnValue(settingsResponse);
    activationResponse.status.mockReturnValue(activationResponse);
    const settingsNext = jest.fn();
    const activationNext = jest.fn();
    try {
      moneyMovementHardOff({ method: 'POST', originalUrl: '/api/wallet/admin/gateways' } as any, settingsResponse, settingsNext);
      expect(settingsNext).toHaveBeenCalledTimes(1);
      expect(settingsResponse.status).not.toHaveBeenCalled();

      moneyMovementHardOff({ method: 'POST', originalUrl: '/api/wallet/admin/gateways/activation' } as any, activationResponse, activationNext);
      expect(activationResponse.status).toHaveBeenCalledWith(503);
      expect(activationResponse.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MONEY_MOVEMENT_DISABLED' }));
      expect(activationNext).not.toHaveBeenCalled();
    } finally {
      if (oldValue === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = oldValue;
    }
  });
});
