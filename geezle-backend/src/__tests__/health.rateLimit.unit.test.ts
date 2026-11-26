import { handleBasicHealth, isBasicHealthPath, isReadinessPath } from '../middleware/basicHealth';
import { DistributedRateLimitStore } from '../middleware/distributedRateLimitStore';
import { assertSafeTestDatabaseUrl } from '../config/runtimePolicy';

const createResponse = () => {
  const res: any = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};

describe('basic health and Redis-backed limiter degradation', () => {
  test('basic health remains available and minimal while Redis limiter is unavailable', () => {
    const res = createResponse();
    handleBasicHealth({ method: 'GET' } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'OK' });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('database');
  });

  test('only the exact basic health endpoint is exempted from the global limiter', () => {
    expect(isBasicHealthPath({ method: 'GET', originalUrl: '/api/health' })).toBe(true);
    expect(isBasicHealthPath({ method: 'HEAD', originalUrl: '/api/health?probe=1' })).toBe(true);
    expect(isBasicHealthPath({ method: 'GET', originalUrl: '/api/health/clamav' })).toBe(true);
    expect(isBasicHealthPath({ method: 'GET', originalUrl: '/api/health/clamav/details' })).toBe(false);
    expect(isBasicHealthPath({ method: 'GET', originalUrl: '/api/health/details' })).toBe(false);
    expect(isBasicHealthPath({ method: 'GET', originalUrl: '/api/auth/health' })).toBe(false);
  });

  test('only exact GET/HEAD readiness probes bypass the global limiter', () => {
    expect(isReadinessPath({ method: 'GET', originalUrl: '/api/readyz' })).toBe(true);
    expect(isReadinessPath({ method: 'HEAD', originalUrl: '/api/health/ready?probe=1' })).toBe(true);
    expect(isReadinessPath({ method: 'POST', originalUrl: '/api/readyz' })).toBe(false);
    expect(isReadinessPath({ method: 'GET', originalUrl: '/api/readyz/details' })).toBe(false);
    expect(isReadinessPath({ method: 'GET', originalUrl: '/api/health/ready-extra' })).toBe(false);
  });

  test('a normal protected limiter remains fail-closed while Redis is unavailable', async () => {
    const store = new DistributedRateLimitStore('redis://127.0.0.1:6399', 'test:protected:', { failClosed: true });
    store.init({ windowMs: 60_000 } as any);
    const response = await store.increment('synthetic-key');

    expect(response.totalHits).toBe(Number.MAX_SAFE_INTEGER);
    await store.shutdown?.();
  });

  test('runtime test database guard accepts configured loopback test port and rejects Marketplace port', () => {
    const originalPort = process.env.TEST_DB_PORT;
    process.env.TEST_DB_PORT = '55432';
    try {
      expect(assertSafeTestDatabaseUrl('postgresql://synthetic:synthetic@127.0.0.1:55432/scrolith_test'))
        .toContain('127.0.0.1:55432/scrolith_test');
      expect(() => assertSafeTestDatabaseUrl('postgresql://synthetic:synthetic@127.0.0.1:5432/scrolith_test'))
        .toThrow('Refusing to reset or prepare a non-isolated test database.');
      expect(() => assertSafeTestDatabaseUrl('postgresql://synthetic:synthetic@db.example.invalid:55432/scrolith_test'))
        .toThrow('Refusing to reset or prepare a non-isolated test database.');
    } finally {
      if (originalPort === undefined) delete process.env.TEST_DB_PORT;
      else process.env.TEST_DB_PORT = originalPort;
    }
  });
});
