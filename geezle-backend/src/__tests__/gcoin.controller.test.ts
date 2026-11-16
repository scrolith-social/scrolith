import request from 'supertest';
import app from '../testApp';
import prisma from '../utils/prismaClient';

describe('Gcoin API smoke tests', () => {
  beforeAll(async () => {
    // ensure prisma client is connected
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('GET /api/gcoin/settings returns 200', async () => {
    const res = await request(app).get('/api/gcoin/settings').set('x-dev-role', 'admin');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
  });

  test('GET /api/gcoin/wallet (dev user) returns wallet', async () => {
    const res = await request(app).get('/api/gcoin/wallets/dev-user-id-123').set('x-dev-role', 'admin');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('Gcoin transfer returns 503 without writing when money movement is disabled', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'false';
    try {
      const transactionsBefore = await prisma.gcoinTransaction.count();
      const res = await request(app)
        .post('/api/gcoin/transfer')
        .send({ amount: 1 })
        .set('x-dev-role', 'freelancer');
      const transactionsAfter = await prisma.gcoinTransaction.count();

      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('MONEY_MOVEMENT_DISABLED');
      expect(transactionsAfter).toBe(transactionsBefore);
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });

  test('POST /api/gcoin/transfer fails without recipient', async () => {
    const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    try {
      const res = await request(app)
        .post('/api/gcoin/transfer')
        .send({ amount: 1 })
        .set('x-dev-role', 'freelancer');
      expect(res.statusCode).toBe(400);
    } finally {
      if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
    }
  });
});
