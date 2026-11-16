import request from 'supertest';
import app from '../testApp';
import prisma from '../utils/prismaClient';

describe('Gcoin admin endpoints', () => {
  const devUserId = 'dev-user-id-123';
  let convId: string;

  beforeAll(async () => {
    // ensure wallet exists and has balance
    await prisma.gcoinWallet.deleteMany({ where: { userId: devUserId } });
    // ensure dev user exists before creating wallet to satisfy foreign key
    await prisma.user.upsert({ where: { id: devUserId }, update: {}, create: { id: devUserId, email: 'dev@example.com', role: 'USER', isActive: true } });
    await prisma.gcoinWallet.create({ data: { userId: devUserId, recipientId: 'GC-ADMIN-TEST', balance: 100, lifetimeEarned: 100, status: 'active' } });
    // create a pending conversion request directly
    const rec = await prisma.gcoinConversionRequest.create({ data: { userId: devUserId, amountGcoin: 10, amountFiat: 0.1, status: 'pending' } });
    convId = rec.id;
    // set up a unique suspicious user and wallet for fraud report (avoid collisions)
    const suspiciousId = `suspicious-user-${Date.now()}`;
    const suspiciousEmail = `suspicious+${Date.now()}@local.dev`;
    await prisma.user.create({ data: { id: suspiciousId, email: suspiciousEmail, name: 'Suspicious Seed', role: 'USER' } });
    const recipientId = `GC-SUS-${Date.now()}`;
    await prisma.gcoinWallet.create({ data: { userId: suspiciousId, recipientId, balance: 1, lifetimeEarned: 1, fraudScore: 5, status: 'active' } as any });
    // attach to test context for cleanup/assertion
    (global as any).__suspiciousId = suspiciousId;
  });

  afterAll(async () => {
    await prisma.gcoinConversionRequest.deleteMany({ where: { userId: devUserId } });
    await prisma.gcoinWallet.deleteMany({ where: { userId: devUserId } });
    const cleanupSuspicious = (global as any).__suspiciousId;
    if (cleanupSuspicious) {
      await prisma.gcoinWallet.deleteMany({ where: { userId: cleanupSuspicious } });
      await prisma.user.deleteMany({ where: { id: cleanupSuspicious } });
    }
    await prisma.$disconnect();
  });

  test('money-movement hard-off rejects approval without changing balances or request state', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'false';
    try {
      const beforeRequest = await prisma.gcoinConversionRequest.findUnique({ where: { id: convId } });
      const beforeGcoin = await prisma.gcoinWallet.findUnique({ where: { userId: devUserId } });
      const beforeFiat = await prisma.wallet.findUnique({ where: { userId: devUserId } });
      const res = await request(app)
        .post(`/api/gcoin/conversions/${convId}`)
        .set('x-dev-role', 'admin')
        .send({ action: 'approve', note: 'should remain blocked in test' });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('MONEY_MOVEMENT_DISABLED');
      const afterRequest = await prisma.gcoinConversionRequest.findUnique({ where: { id: convId } });
      const afterGcoin = await prisma.gcoinWallet.findUnique({ where: { userId: devUserId } });
      const afterFiat = await prisma.wallet.findUnique({ where: { userId: devUserId } });
      expect(afterRequest?.status).toBe(beforeRequest?.status);
      expect(Number(afterGcoin?.balance || 0)).toBe(Number(beforeGcoin?.balance || 0));
      expect(afterFiat ? Number(afterFiat.balance) : null).toEqual(beforeFiat ? Number(beforeFiat.balance) : null);
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });

  test('Admin can approve a conversion request with an explicit synthetic test opt-in', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    try {
      const res = await request(app)
        .post(`/api/gcoin/conversions/${convId}`)
        .set('x-dev-role', 'admin')
        .send({ action: 'approve', note: 'approved in synthetic test' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      const updated = await prisma.gcoinConversionRequest.findUnique({ where: { id: convId } });
      expect(updated?.status).toBe('approved');
      // The synthetic fiat wallet is credited only in this explicitly opted-in test.
      const fiat = await prisma.wallet.findUnique({ where: { userId: devUserId } });
      expect(fiat).toBeTruthy();
      expect(Number(fiat?.balance || 0)).toBeGreaterThan(0);
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });

  test('Admin summary endpoint returns expected fields', async () => {
    const res = await request(app).get('/api/gcoin/admin/summary').set('x-dev-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    const data = res.body.data;
    expect(data).toHaveProperty('totalSupply');
    expect(data).toHaveProperty('totalLifetimeEarned');
    expect(data).toHaveProperty('platformFees');
  });

  test('Admin fraud reports returns suspicious wallets', async () => {
    const res = await request(app).get('/api/gcoin/admin/fraud').set('x-dev-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    const data = res.body.data;
    expect(Array.isArray(data.suspiciousWallets)).toBe(true);
    // the seeded suspicious wallet should be present with expected userId and fraudScore
    const expectedId = (global as any).__suspiciousId;
    expect(expectedId).toBeTruthy();
    expect(data.suspiciousWallets.find((w: any) => w.userId === expectedId && Number(w.fraudScore) >= 5)).toBeTruthy();
  });
});
