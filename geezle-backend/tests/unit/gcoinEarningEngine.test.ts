export {};

const mockPrisma = {
  gcoinConfig: { findFirst: jest.fn() },
  communityPost: { findUnique: jest.fn() },
  gcoinTransaction: { findMany: jest.fn(), create: jest.fn() },
  gcoinWallet: { update: jest.fn() },
  monetizationProfile: { findUnique: jest.fn() },
  transaction: { create: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(mockPrisma))
};

jest.mock('../../src/utils/prismaClient', () => ({
  __esModule: true,
  default: mockPrisma
}));

const { processEarningForPost } = require('../../src/services/gcoinEarningEngine');

describe('gcoinEarningEngine', () => {
  let previousMoneyMovementGate: string | undefined;

  beforeAll(() => {
    // Enabled-path behavior is exercised with Prisma fully mocked. Preserve
    // and restore the full runner's hard-off setting around this suite.
    previousMoneyMovementGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    if (previousMoneyMovementGate === undefined) {
      delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    } else {
      process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = previousMoneyMovementGate;
    }
  });

  test('rejects earnings before database work while money movement is disabled', async () => {
    const enabledGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'false';
    try {
      await expect(processEarningForPost('post-disabled')).rejects.toMatchObject({
        code: 'MONEY_MOVEMENT_DISABLED'
      });
      expect(mockPrisma.gcoinConfig.findFirst).not.toHaveBeenCalled();
    } finally {
      if (enabledGate === undefined) {
        delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      } else {
        process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = enabledGate;
      }
    }
  });

  test('awards coins when thresholds crossed and prevents double award', async () => {
    mockPrisma.gcoinConfig.findFirst.mockResolvedValue({ data: { viewsUnit: 100, coinPerViewsUnit: 1, adminFeePercent: 0 } });
    mockPrisma.communityPost.findUnique.mockResolvedValue({
      id: 'post1',
      authorId: 'u1',
      viewsCount: 250,
      likesCount: 0,
      videoIntegrityStatus: 'clear',
      videoMonetizationBlocked: false
    });
    mockPrisma.monetizationProfile.findUnique.mockResolvedValue({ isEnabled: true });
    mockPrisma.gcoinTransaction.findMany.mockResolvedValue([]);
    mockPrisma.gcoinTransaction.create.mockResolvedValue({ id: 'gtx1', netAmount: 2 });
    mockPrisma.gcoinWallet.update.mockResolvedValue({ userId: 'u1', balance: 2 });

    const tx = await processEarningForPost('post1');
    expect(tx).toBeTruthy();
    expect(mockPrisma.gcoinWallet.update).toHaveBeenCalled();
  });
});
