import request from 'supertest';
import app from '../server';
import prisma from '../utils/prismaClient';

describe('Gcoin rewards integration', () => {
  let userId: string;
  let previousMoneyMovementGate: string | undefined;
  let previousGcoinSettings: any;
  beforeAll(async () => {
    previousMoneyMovementGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    previousGcoinSettings = await prisma.gcoinSettings.findUnique({ where: { id: 'default' } });
    userId = 'itest-user-' + Date.now().toString().slice(-6);
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, role: 'USER' } });
    // ensure any prior artifacts for this id are removed
    await prisma.gcoinEarningEvent.deleteMany({ where: { actorId: userId } });
    await prisma.gcoinTransaction.deleteMany({ where: { userId } });
    await prisma.gcoinWallet.deleteMany({ where: { userId } });
    await prisma.gcoinSettings.upsert({
      where: { id: 'default' },
      update: {
        conversionRate: 1,
        minWithdrawal: 0,
        conversionEnabled: true,
        autoApproveConversions: false,
        userTransfersEnabled: true,
        transferFeeType: 'percentage',
        transferFeeValue: 0,
        likesUnit: 1,
        coinPerLikesUnit: 1,
        adminFeePercent: 0
      },
      create: {
        id: 'default',
        conversionRate: 1,
        minWithdrawal: 0,
        conversionEnabled: true,
        autoApproveConversions: false,
        userTransfersEnabled: true,
        transferFeeType: 'percentage',
        transferFeeValue: 0,
        likesUnit: 1,
        coinPerLikesUnit: 1,
        adminFeePercent: 0
      } as any
    });
  });

  afterAll(async () => {
    try {
      await prisma.gcoinTransaction.deleteMany({ where: { userId } });
      await prisma.gcoinEarningEvent.deleteMany({ where: { actorId: userId } });
      await prisma.transaction.deleteMany({ where: { userId } });
      await prisma.gcoinWallet.deleteMany({ where: { userId } });
      await prisma.gcoinConversionRequest.deleteMany({ where: { userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      if (previousGcoinSettings) {
        const { id, ...settingsData } = previousGcoinSettings;
        await prisma.gcoinSettings.upsert({
          where: { id },
          create: previousGcoinSettings,
          update: settingsData
        });
      } else {
        await prisma.gcoinSettings.deleteMany({ where: { id: 'default' } });
      }
    } finally {
      if (previousMoneyMovementGate === undefined) {
        delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      } else {
        process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = previousMoneyMovementGate;
      }
      await prisma.$disconnect();
    }
  });

  test('POST /api/gcoin/rewards awards coins and creates ledger entries', async () => {
    // inspect settings to determine unit threshold
    const settings = await prisma.gcoinSettings.findFirst();
    const unit = (settings && settings.likesUnit) ? Number(settings.likesUnit) : 1;
    // submit a reward that should award 1 unit (use current configured likesUnit)
    const res = await request(app).post('/api/gcoin/rewards').set('x-dev-role', 'admin').send({ userId, type: 'like', count: unit });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // response reports awarded value
    expect(Number(res.body.data?.awarded || 0)).toBeGreaterThan(0);
    // Expect either an earning event or a gcoin transaction to exist (some environments may record one or both)
    const ev = await prisma.gcoinEarningEvent.findFirst({ where: { actorId: userId, eventType: 'like_award' } });
    const gt = await prisma.gcoinTransaction.findFirst({ where: { userId, type: 'reward' } });
    expect(ev !== null || gt !== null).toBeTruthy();
  }, 15000);
});
