import { rejectAd } from '../community.ads.controller';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    refunds: { create: jest.fn().mockResolvedValue({ id: 're_1' }) }
  }));
});

jest.mock('../../services/stripeConfig.service', () => ({
  getStripeClient: jest.fn().mockResolvedValue({
    refunds: { create: jest.fn().mockResolvedValue({ id: 're_1' }) }
  })
}));

const mockUpdate = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockCommunityAdUpdate = jest.fn();

jest.mock('../../utils/prismaClient', () => ({
  communityAd: { update: (...args: any[]) => mockCommunityAdUpdate(...args) },
  adPayment: {
    findMany: (...args: any[]) => mockFindMany(...args),
    update: (...args: any[]) => mockUpdate(...args),
    create: (...args: any[]) => mockCreate(...args)
  }
}));

describe('rejectAd refund flow', () => {
  const originalGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;

  beforeEach(() => {
    mockFindMany.mockReset();
    mockUpdate.mockReset();
    mockCreate.mockReset();
    mockCommunityAdUpdate.mockReset();
  });

  afterAll(() => {
    if (originalGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = originalGate;
  });

  test('marks payments refunded and creates refund records when refund=true', async () => {
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    const payments = [{ id: 'p1', transactionId: 'pi_1', amount: 25, currency: 'USD' }];
    mockFindMany.mockResolvedValueOnce(payments);

    const req: any = {
      params: { id: 'ad123' },
      body: { refund: true },
      app: { get: () => ({ emit: () => {} }) }
    };

    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await rejectAd(req, res);

    // original payment marked refunded
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'refunded' } });

    // refund record created with negative amount
    expect(mockCreate).toHaveBeenCalledWith({ data: {
      adId: 'ad123',
      transactionId: 're_1',
      amount: -25,
      currency: 'USD',
      status: 'refunded'
    } });

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('rejects requested refund before changing ad/payment state while the hard-off is active', async () => {
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const req: any = {
      params: { id: 'ad-disabled' },
      body: { refund: true },
      app: { get: () => ({ emit: () => {} }) }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await rejectAd(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MONEY_MOVEMENT_DISABLED' }));
    expect(mockCommunityAdUpdate).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('keeps non-financial ad rejection available while the hard-off is active', async () => {
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const req: any = {
      params: { id: 'ad-no-refund' },
      body: { refund: false, notes: 'Synthetic moderation reason' },
      app: { get: () => ({ emit: () => {} }) }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await rejectAd(req, res);

    expect(mockCommunityAdUpdate).toHaveBeenCalledWith({ where: { id: 'ad-no-refund' }, data: { status: 'REJECTED' } });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
