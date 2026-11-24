import { randomUUID } from 'crypto';
import prisma from '../../../utils/prismaClient';
import { createQuotaService } from '../usage';

const USER_PREFIX = 'scrolitha-ai-quota-test-';
const ENV_KEYS = [
  'SCROLITHA_AI_DAILY_REQUESTS',
  'SCROLITHA_AI_MONTHLY_TOKENS',
  'SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS',
  'SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS',
  'SCROLITHA_AI_MONTHLY_BUDGET_USD',
  'SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD',
  'SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS',
  'SCROLITHA_AI_CONCURRENCY',
  'SCROLITHA_AI_RATE_PER_MINUTE'
];
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function assertDisposableDatabaseTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Quota DB tests require an explicit disposable DATABASE_URL.');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('Quota DB tests require a parseable disposable DATABASE_URL.');
  }

  const databaseName = target.pathname.replace(/^\//, '');
  const port = target.port || '5432';
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase());
  const localPostgresProfile = process.env.TEST_DB_KIND === 'local-postgres' &&
    process.env.TEST_DB_INSTANCE === 'local-postgres-test' && port !== '5432';
  const githubServiceProfile = process.env.CI === 'true' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    target.hostname.toLowerCase() === '127.0.0.1' && port === '5432' &&
    process.env.TEST_DB_KIND === 'local-disposable' &&
    process.env.TEST_DB_INSTANCE === 'local-disposable-postgres-test';
  if (!loopback || !/(?:test|e2e)/i.test(databaseName) ||
      process.env.TEST_DB_NAME !== databaseName || process.env.TEST_DB_PORT !== port ||
      process.env.TEST_DB_PROJECT !== 'local-only' ||
      !(localPostgresProfile || githubServiceProfile)) {
    throw new Error('Quota DB tests refuse non-loopback, owner, or unmarked database targets.');
  }
}

function configureLimits(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    SCROLITHA_AI_DAILY_REQUESTS: '100',
    SCROLITHA_AI_MONTHLY_TOKENS: '500000',
    SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '500000',
    SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS: '1000',
    SCROLITHA_AI_MONTHLY_BUDGET_USD: '5',
    SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD: '100',
    SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS: '60000',
    SCROLITHA_AI_CONCURRENCY: '3',
    SCROLITHA_AI_RATE_PER_MINUTE: '20',
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function testUser() {
  return `${USER_PREFIX}${randomUUID()}`;
}

function requestId() {
  return `quota-test-${randomUUID()}`;
}

const anchor = (value: string) => new Date(value);

beforeAll(async () => {
  assertDisposableDatabaseTarget();
  await prisma.$connect();
});

beforeEach(() => configureLimits());

afterEach(async () => {
  await prisma.aIUsageLedger.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: USER_PREFIX } },
        { requestId: { startsWith: 'quota-test-' } }
      ]
    }
  });
});

afterAll(async () => {
  await prisma.aIUsageLedger.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: USER_PREFIX } },
        { requestId: { startsWith: 'quota-test-' } }
      ]
    }
  });
  await prisma.$disconnect();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Scrolitha AI durable quota accounting (disposable PostgreSQL)', () => {
  it('uses UTC calendar day and month boundaries, not a rolling 30-day window', async () => {
    configureLimits({
      SCROLITHA_AI_DAILY_REQUESTS: '1',
      SCROLITHA_AI_MONTHLY_TOKENS: '5'
    });
    const service = createQuotaService(prisma);
    const dayBoundaryUser = testUser();
    const beforeUtcDayReset = await service.checkQuota({
      userId: dayBoundaryUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 5,
      now: anchor('2040-11-01T23:59:59.000Z')
    });
    expect(beforeUtcDayReset.allowed).toBe(true);

    const afterUtcDayReset = await service.checkQuota({
      userId: dayBoundaryUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now: anchor('2040-11-02T00:00:00.000Z')
    });
    expect(afterUtcDayReset).toMatchObject({
      allowed: false,
      reason: 'MONTHLY_TOKEN_CEILING_EXCEEDED'
    });

    const monthBoundaryUser = testUser();
    const lastRequestOfNovember = await service.checkQuota({
      userId: monthBoundaryUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 5,
      now: anchor('2040-11-30T23:59:59.000Z')
    });
    expect(lastRequestOfNovember.allowed).toBe(true);

    const firstRequestOfDecember = await service.checkQuota({
      userId: monthBoundaryUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 5,
      now: anchor('2040-12-01T00:00:00.000Z')
    });
    expect(firstRequestOfDecember.allowed).toBe(true);
  });

  it('enforces one durable global monthly token ceiling across users and anonymous requests', async () => {
    configureLimits({ SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '5', SCROLITHA_AI_MONTHLY_TOKENS: '20' });
    const firstProcess = createQuotaService(prisma);
    const restartedProcess = createQuotaService(prisma);
    const now = anchor('2041-01-31T23:59:59.000Z');

    expect((await firstProcess.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 3, now
    })).allowed).toBe(true);
    const anonymous = await firstProcess.checkQuota({
      userId: null, capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 2, now
    });
    expect(anonymous).toMatchObject({ allowed: true, remaining: { globalMonthlyTokens: 0 } });

    expect(await restartedProcess.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 1,
      now: anchor('2041-01-31T23:59:59.500Z')
    })).toMatchObject({ allowed: false, reason: 'GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED' });

    expect((await restartedProcess.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 5,
      now: anchor('2041-02-01T00:00:00.000Z')
    })).allowed).toBe(true);
  });

  it('enforces a durable global monthly request ceiling across users and anonymous requests', async () => {
    configureLimits({
      SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '100',
      SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS: '2',
      SCROLITHA_AI_MONTHLY_TOKENS: '100'
    });
    const firstProcess = createQuotaService(prisma);
    const restartedProcess = createQuotaService(prisma);
    const now = anchor('2041-01-31T23:59:59.000Z');

    expect((await firstProcess.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 1, now
    })).allowed).toBe(true);
    expect(await firstProcess.checkQuota({
      userId: null, capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 1, now
    })).toMatchObject({ allowed: true, remaining: { globalMonthlyRequests: 0 } });

    expect(await restartedProcess.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 1,
      now: anchor('2041-01-31T23:59:59.500Z')
    })).toMatchObject({ allowed: false, reason: 'GLOBAL_MONTHLY_REQUEST_LIMIT_EXCEEDED' });
    expect((await restartedProcess.checkQuota({
      userId: null, capability: 'TEXT_SUMMARIZATION', requestId: requestId(), estimatedTokens: 1,
      now: anchor('2041-02-01T00:00:00.000Z')
    })).allowed).toBe(true);
  });

  it('serializes authenticated and anonymous reservations against a concurrent monthly request limit', async () => {
    configureLimits({
      SCROLITHA_AI_DAILY_REQUESTS: '100',
      SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '1000',
      SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS: '5',
      SCROLITHA_AI_MONTHLY_TOKENS: '1000',
      SCROLITHA_AI_CONCURRENCY: '20',
      SCROLITHA_AI_RATE_PER_MINUTE: '100'
    });
    const service = createQuotaService(prisma);
    const now = anchor('2041-02-03T04:05:06.000Z');
    const users = Array.from({ length: 12 }, (_, index) => index % 2 ? testUser() : null);
    const results = await Promise.all(users.map((userId) => service.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })));

    const outcomes = results.reduce<Record<string, number>>((counts, result) => {
      const outcome = result.allowed ? 'ALLOWED' : result.reason || 'DENIED_WITHOUT_REASON';
      counts[outcome] = (counts[outcome] || 0) + 1;
      return counts;
    }, {});
    expect(outcomes).toEqual({ ALLOWED: 5, GLOBAL_MONTHLY_REQUEST_LIMIT_EXCEEDED: 7 });
  });

  it('serializes global monthly reservations across authenticated and anonymous concurrency', async () => {
    configureLimits({
      SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '7',
      SCROLITHA_AI_MONTHLY_TOKENS: '100',
      SCROLITHA_AI_CONCURRENCY: '20',
      SCROLITHA_AI_RATE_PER_MINUTE: '100'
    });
    const service = createQuotaService(prisma);
    const now = anchor('2041-02-03T04:05:06.000Z');
    const users = Array.from({ length: 14 }, (_, index) => index % 2 ? testUser() : null);
    const results = await Promise.all(users.map((userId) => service.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })));

    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(results.filter((result) => result.reason === 'GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED')).toHaveLength(7);
  });

  it('serializes concurrent reservations so a per-user request limit cannot be overspent', async () => {
    configureLimits({ SCROLITHA_AI_DAILY_REQUESTS: '1' });
    const service = createQuotaService(prisma);
    const userId = testUser();
    const now = anchor('2041-02-03T04:05:06.000Z');

    const results = await Promise.all(Array.from({ length: 12 }, () => service.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })));

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => result.reason === 'DAILY_REQUEST_QUOTA_EXCEEDED')).toHaveLength(11);
  });

  it('uses only persisted state when a fresh service instance handles the next request', async () => {
    configureLimits({ SCROLITHA_AI_DAILY_REQUESTS: '1' });
    const firstProcess = createQuotaService(prisma);
    const restartedProcess = createQuotaService(prisma);
    const userId = testUser();
    const reserved = await firstProcess.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 20,
      now: anchor('2041-03-04T05:06:07.000Z')
    });
    expect(reserved.allowed).toBe(true);

    const afterRestart = await restartedProcess.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now: anchor('2041-03-04T05:06:08.000Z')
    });
    expect(afterRestart).toMatchObject({
      allowed: false,
      reason: 'DAILY_REQUEST_QUOTA_EXCEEDED'
    });
  });

  it('enforces monthly tokens, per-user spend, global spend, rate, and concurrency limits', async () => {
    const service = createQuotaService(prisma);
    const now = anchor('2041-04-05T06:07:08.000Z');

    configureLimits({ SCROLITHA_AI_MONTHLY_TOKENS: '5' });
    const tokenUser = testUser();
    expect((await service.checkQuota({
      userId: tokenUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 5,
      now
    })).allowed).toBe(true);
    expect(await service.checkQuota({
      userId: tokenUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })).toMatchObject({ allowed: false, reason: 'MONTHLY_TOKEN_CEILING_EXCEEDED' });

    configureLimits({ SCROLITHA_AI_MONTHLY_BUDGET_USD: '0.005' });
    expect(await service.checkQuota({
      userId: testUser(),
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      estimatedCostUsd: 0.006,
      now
    })).toMatchObject({ allowed: false, reason: 'MONTHLY_AI_BUDGET_EXCEEDED' });

    configureLimits({ SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD: '0.005' });
    const firstGlobalUser = testUser();
    expect((await service.checkQuota({
      userId: firstGlobalUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      estimatedCostUsd: 0.004,
      now
    })).allowed).toBe(true);
    expect(await service.checkQuota({
      userId: testUser(),
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      estimatedCostUsd: 0.002,
      now
    })).toMatchObject({ allowed: false, reason: 'GLOBAL_AI_BUDGET_EXCEEDED' });

    configureLimits({ SCROLITHA_AI_RATE_PER_MINUTE: '1' });
    const rateUser = testUser();
    expect((await service.checkQuota({
      userId: rateUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })).allowed).toBe(true);
    expect(await service.checkQuota({
      userId: rateUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })).toMatchObject({ allowed: false, reason: 'RATE_LIMIT_EXCEEDED' });

    configureLimits({ SCROLITHA_AI_CONCURRENCY: '1' });
    const concurrentUser = testUser();
    expect((await service.checkQuota({
      userId: concurrentUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now
    })).allowed).toBe(true);
    expect(await service.checkQuota({
      userId: concurrentUser,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now: new Date(now.getTime() + 1_000)
    })).toMatchObject({ allowed: false, reason: 'CONCURRENCY_LIMIT_EXCEEDED' });
  });

  it('settles by appending one idempotent delta and rejects later usage beyond the monthly ceiling', async () => {
    configureLimits({ SCROLITHA_AI_MONTHLY_TOKENS: '10' });
    const service = createQuotaService(prisma);
    const userId = testUser();
    const id = requestId();
    const now = anchor('2041-05-06T07:08:09.000Z');

    const reservation = await service.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: id,
      estimatedTokens: 5,
      estimatedCostUsd: 0.01,
      now
    });
    expect(reservation.allowed).toBe(true);

    const settlement = await service.recordUsage({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      provider: 'OLLAMA',
      model: 'synthetic-model',
      totalTokens: 7,
      estimatedCostUsd: 0.012,
      requestId: id,
      status: 'COMPLETED'
    });
    expect(settlement.withinLimits).toBe(true);

    const rows = await prisma.aIUsageLedger.findMany({ where: { userId, requestId: id } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status).sort()).toEqual(['RESERVED', 'SETTLEMENT_COMPLETED']);
    expect(rows.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(7);
    expect(rows.reduce((sum, row) => sum + row.estimatedCostUsd, 0)).toBeCloseTo(0.012, 6);

    const duplicate = await service.recordUsage({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      provider: 'OLLAMA',
      model: 'synthetic-model',
      totalTokens: 7,
      estimatedCostUsd: 0.012,
      requestId: id,
      status: 'COMPLETED'
    });
    expect(duplicate).toMatchObject({ withinLimits: true, duplicate: true });
    expect(await prisma.aIUsageLedger.count({ where: { userId, requestId: id } })).toBe(2);

    const overLimitId = requestId();
    expect((await service.checkQuota({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      requestId: overLimitId,
      estimatedTokens: 1,
      now
    })).allowed).toBe(true);
    const overrun = await service.recordUsage({
      userId,
      capability: 'TEXT_SUMMARIZATION',
      provider: 'OLLAMA',
      model: 'synthetic-model',
      totalTokens: 20,
      estimatedCostUsd: 0.02,
      requestId: overLimitId,
      status: 'COMPLETED'
    });
    expect(overrun).toMatchObject({
      withinLimits: false,
      reason: 'MONTHLY_TOKEN_CEILING_EXCEEDED'
    });
  });

  it('blocks output and future reservations when measured settlement exceeds the global monthly cap', async () => {
    configureLimits({ SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '5', SCROLITHA_AI_MONTHLY_TOKENS: '100' });
    const service = createQuotaService(prisma);
    const id = requestId();
    const now = anchor('2041-07-08T09:10:11.000Z');
    expect((await service.checkQuota({
      userId: testUser(), capability: 'TEXT_SUMMARIZATION', requestId: id, estimatedTokens: 1, now
    })).allowed).toBe(true);

    await expect(service.recordUsage({
      capability: 'TEXT_SUMMARIZATION',
      provider: 'OLLAMA',
      model: 'synthetic-model',
      totalTokens: 6,
      estimatedCostUsd: 0.001,
      requestId: id,
      status: 'COMPLETED'
    })).resolves.toMatchObject({
      withinLimits: false,
      reason: 'GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED'
    });

    expect(await service.checkQuota({
      userId: null,
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now: new Date(now.getTime() + 1_000)
    })).toMatchObject({ allowed: false, reason: 'GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED' });
  });

  it('fails closed when reservation or settlement persistence fails', async () => {
    const failingDatabase = {
      $transaction: async () => { throw new Error('synthetic persistence failure'); }
    };
    const service = createQuotaService(failingDatabase);
    const decision = await service.checkQuota({
      userId: testUser(),
      capability: 'TEXT_SUMMARIZATION',
      requestId: requestId(),
      estimatedTokens: 1,
      now: anchor('2041-06-07T08:09:10.000Z')
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'QUOTA_PERSISTENCE_UNAVAILABLE'
    });

    await expect(service.recordUsage({
      userId: testUser(),
      capability: 'TEXT_SUMMARIZATION',
      provider: 'NATIVE',
      model: 'synthetic-model',
      totalTokens: 0,
      estimatedCostUsd: 0,
      requestId: requestId(),
      status: 'COMPLETED'
    })).rejects.toThrow('USAGE_PERSISTENCE_UNAVAILABLE');
  });
});
