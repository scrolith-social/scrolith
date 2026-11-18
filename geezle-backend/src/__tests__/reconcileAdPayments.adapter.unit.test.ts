const mockPrisma = { adPayment: { findMany: jest.fn().mockResolvedValue([]) } };

jest.mock('../utils/prismaClient', () => ({
  __esModule: true,
  default: mockPrisma,
  disconnectPrisma: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('stripe', () => jest.fn());

import prisma, { disconnectPrisma } from '../utils/prismaClient';
import { closeReconciliationResources, reconcileAdPayments } from '../scripts/reconcileAdPayments';

describe('reconcileAdPayments Prisma adapter lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    process.env.NODE_ENV = 'test';
  });

  test('uses the shared adapter-safe client and does not construct Prisma directly', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    try {
      await expect(reconcileAdPayments()).resolves.toBeUndefined();
      expect(prisma).toBe(mockPrisma);
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });

  test('hard-off rejects reconciliation before reading payment records', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'false';
    try {
      await expect(reconcileAdPayments()).rejects.toMatchObject({
        code: 'MONEY_MOVEMENT_DISABLED',
        status: 503
      });
      expect(mockPrisma.adPayment.findMany).not.toHaveBeenCalled();
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });

  test('closes the shared Prisma client and pool exactly once when requested repeatedly', async () => {
    await closeReconciliationResources();
    await closeReconciliationResources();
    expect(disconnectPrisma).toHaveBeenCalledTimes(1);
  });
});
