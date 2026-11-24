import http from 'node:http';
import type { AddressInfo } from 'node:net';
import prisma from '../../../utils/prismaClient';
import { ollamaChat } from '../scrolitha.ollama';

const USER_PREFIX = 'scrolitha-ai-ollama-ledger-test-';
const ENV_DEFAULTS: Record<string, string> = {
  SCROLITHA_AI_DAILY_REQUESTS: '100',
  SCROLITHA_AI_MONTHLY_TOKENS: '500000',
  SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS: '500000',
  SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS: '1000',
  SCROLITHA_AI_MONTHLY_BUDGET_USD: '5',
  SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD: '100',
  SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS: '60000',
  SCROLITHA_AI_CONCURRENCY: '3',
  SCROLITHA_AI_RATE_PER_MINUTE: '20'
};
const originalEnv = new Map(Object.keys(ENV_DEFAULTS).map((key) => [key, process.env[key]]));

function assertDisposableDatabaseTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Ollama ledger tests require an explicit disposable DATABASE_URL.');
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('Ollama ledger tests require a parseable disposable DATABASE_URL.');
  }
  const databaseName = target.pathname.replace(/^\//, '');
  const port = target.port || '5432';
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()) ||
      !/(?:test|e2e)/i.test(databaseName) || port === '5432' ||
      process.env.TEST_DB_NAME !== databaseName || process.env.TEST_DB_PORT !== port ||
      process.env.TEST_DB_KIND !== 'local-postgres' ||
      process.env.TEST_DB_PROJECT !== 'local-only' ||
      process.env.TEST_DB_INSTANCE !== 'local-postgres-test') {
    throw new Error('Ollama ledger tests refuse non-loopback, owner, or unmarked database targets.');
  }
}

beforeAll(async () => {
  assertDisposableDatabaseTarget();
  Object.assign(process.env, ENV_DEFAULTS);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.aIUsageLedger.deleteMany({ where: { userId: { startsWith: USER_PREFIX } } });
  await prisma.$disconnect();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('direct Ollama quota persistence (disposable PostgreSQL)', () => {
  it('reserves before the local call and settles measured Ollama token counts before returning text', async () => {
    const userId = `${USER_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const server = http.createServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        message: { content: 'READY' },
        prompt_eval_count: 7,
        eval_count: 3
      }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      await expect(ollamaChat({
        host: `http://127.0.0.1:${address.port}`,
        model: 'qwen3:synthetic-test',
        messages: [{ role: 'user', content: 'hello' }],
        userId,
        capability: 'TEXT_REWRITING',
        maxTokens: 32,
        timeoutMs: 5_000,
        autoPullModel: false,
        allowNodeFallback: false
      })).resolves.toMatchObject({ text: 'READY' });

      const rows = await prisma.aIUsageLedger.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.status).sort()).toEqual(['RESERVED', 'SETTLEMENT_COMPLETED']);
      expect(rows.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(10);
      expect(rows.find((row) => row.status === 'SETTLEMENT_COMPLETED')).toMatchObject({
        provider: 'OLLAMA',
        model: 'qwen3:synthetic-test',
        promptTokens: 0,
        completionTokens: 0
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
