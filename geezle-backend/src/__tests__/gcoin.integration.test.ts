import request from 'supertest';
import app from '../testApp';
import prisma from '../utils/prismaClient';
import {
  TRANSFER_LIMIT_PER_MIN,
  CONVERSION_LIMIT_PER_DAY,
  resetAll,
  closeGcoinLimitStore,
  clearUserLimitState
} from '../middleware/gcoinLimits';

jest.setTimeout(120000);

const agent = request(app as any);

async function runBounded<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const batch = items.slice(offset, offset + concurrency);
    results.push(...await Promise.all(batch.map(operation)));
  }
  return results;
}

describe('Gcoin Redis atomic limiter integration', () => {
  beforeAll(async () => {
    resetAll();
    await clearUserLimitState('dev-user-id-123');
    // seed a large balance for the dev user (admin bypass header required)
    await agent
      .post('/api/gcoin/admin/credit')
      .set('x-dev-role', 'admin')
      .send({ userId: 'dev-user-id-123', amount: 50000 })
      .expect(200);
  }, 30000);

  afterAll(async () => {
    try {
      resetAll();
    } finally {
      try {
        await clearUserLimitState('dev-user-id-123');
      } finally {
        try {
          await closeGcoinLimitStore();
        } finally {
          await prisma.$disconnect();
        }
      }
    }
  });

  test('concurrent transfers respect per-minute limit', async () => {
    const requests = Array.from({ length: 20 }, (_, i) => i);
    const results = await runBounded(requests, 4, (i) =>
      agent.post('/api/gcoin/transfer')
        .send({ toEmail: 'dev@example.com', amount: 1, note: `itest-${i}` })
    );
    const success = results.filter(r => r && r.status === 200).length;
    const rateLimited = results.filter(r => r && r.status === 429).length;
    expect(results.every(r => r.status === 200 || r.status === 429)).toBe(true);
    expect(success).toBeGreaterThan(0);
    expect(rateLimited).toBeGreaterThan(0);
    // The route returns 429 when tryRecordTransfer rejects a request.
    expect(success).toBeLessThanOrEqual(TRANSFER_LIMIT_PER_MIN);
  }, 60000);

  test('concurrent conversions respect per-day limit', async () => {
    const requests = Array.from({ length: 10 }, (_, i) => i);
    const results = await runBounded(requests, 4, () =>
      agent.post('/api/gcoin/conversions')
        .send({ amount: 1 })
    );
    const success = results.filter(r => r && r.status === 200).length;
    const rateLimited = results.filter(r => r && r.status === 429).length;
    expect(results.every(r => r.status === 200 || r.status === 429)).toBe(true);
    expect(success).toBeGreaterThan(0);
    expect(rateLimited).toBeGreaterThan(0);
    // The route returns 429 when tryRecordConversion rejects a request.
    expect(success).toBeLessThanOrEqual(CONVERSION_LIMIT_PER_DAY);
  }, 60000);
});
