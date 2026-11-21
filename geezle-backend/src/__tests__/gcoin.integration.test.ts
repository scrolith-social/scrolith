import request from 'supertest';
import app from '../../src/server';
import {
  TRANSFER_LIMIT_PER_MIN,
  CONVERSION_LIMIT_PER_DAY,
  shutdown as shutdownGcoinLimits
} from '../../src/middleware/gcoinLimits';

jest.setTimeout(120000);

const agent = request(app as any);

describe('Gcoin Redis atomic limiter integration', () => {
  let previousMoneyMovementGate: string | undefined;

  beforeAll(async () => {
    // This suite validates rate limiting on enabled synthetic Gcoin requests
    // in the guarded disposable database. The full runner keeps the feature
    // disabled by default; hard-off behavior is covered in separate suites.
    previousMoneyMovementGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';

    // seed a large balance for the dev user (admin bypass header required)
    await agent
      .post('/api/gcoin/admin/credit')
      .set('x-dev-role', 'admin')
      .send({ userId: 'dev-user-id-123', amount: 50000 })
      .expect(200);
  }, 30000);

  afterAll(async () => {
    try {
      // The local test adapter clears only its own synthetic limiter keys so
      // this suite cannot rate-limit a later isolated test file.
      await shutdownGcoinLimits();
    } finally {
      if (previousMoneyMovementGate === undefined) {
        delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
      } else {
        process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = previousMoneyMovementGate;
      }
    }
  });

  test('concurrent transfers respect per-minute limit', async () => {
    const concurrency = 20;
    const reqs = Array.from({ length: concurrency }).map((_, i) =>
      agent
        .post('/api/gcoin/transfer')
        .set('x-dev-role', 'freelancer')
        .send({ toEmail: 'bob+seed@local.dev', amount: 1, note: `itest-${i}` })
    );
    const results = await Promise.all(reqs.map(p => p.then(r => r).catch(e => ({ status: 500 }))));
    const success = results.filter(r => r && r.status === 200).length;
    const rateLimited = results.filter(r => r && r.status === 429).length;
    // Under atomic limiter, successes must not exceed per-minute limit
    expect(success).toBeGreaterThan(0);
    expect(success).toBeLessThanOrEqual(TRANSFER_LIMIT_PER_MIN);
    expect(rateLimited).toBeGreaterThan(0);
  }, 60000);

  test('concurrent conversions respect per-day limit', async () => {
    const concurrency = 10;
    const reqs = Array.from({ length: concurrency }).map((_, i) =>
      agent.post('/api/gcoin/conversions').set('x-dev-role', 'freelancer').send({ amount: 1 })
    );
    const results = await Promise.all(reqs.map(p => p.then(r => r).catch(e => ({ status: 500 }))));
    const success = results.filter(r => r && r.status === 200).length;
    const rateLimited = results.filter(r => r && r.status === 429).length;
    expect(success).toBeLessThanOrEqual(CONVERSION_LIMIT_PER_DAY);
    expect(success).toBeGreaterThan(0);
    expect(rateLimited).toBeGreaterThan(0);
  }, 60000);
});
