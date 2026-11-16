import { DistributedRateLimitStore } from '../distributedRateLimitStore';
import { connectRedisClient, createRedisClient } from '../../services/redis/entraRedis';
import { EventEmitter } from 'events';

jest.mock('../../services/redis/entraRedis', () => ({
  connectRedisClient: jest.fn(),
  createRedisClient: jest.fn(() => ({
    eval: jest.fn().mockResolvedValue([1, 60_000]),
    decr: jest.fn().mockResolvedValue(0),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    pttl: jest.fn().mockResolvedValue(60_000),
    quit: jest.fn().mockResolvedValue('OK'),
  })),
}));

const connectMock = connectRedisClient as jest.MockedFunction<typeof connectRedisClient>;
const createMock = createRedisClient as jest.MockedFunction<typeof createRedisClient>;

describe('DistributedRateLimitStore startup containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('does not connect during route setup, leaving HTTP startup independent of Redis', async () => {
    const store = new DistributedRateLimitStore('rediss://synthetic.invalid:10000', 'test:', {
      failClosed: true,
      entraClientId: 'synthetic-client',
    });

    expect(() => store.init({ windowMs: 60_000 } as any)).not.toThrow();
    expect(connectMock).not.toHaveBeenCalled();
    expect(store.getRedisState()).toBe('idle');
    await store.shutdown();
  });

  test('contains DNS/refusal failures and fails protected requests closed without an unhandled rejection', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    connectMock.mockRejectedValueOnce(Object.assign(new Error('synthetic DNS failure'), { code: 'ENOTFOUND' }));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const store = new DistributedRateLimitStore('rediss://synthetic.invalid:10000', 'test:', {
      failClosed: true,
      entraClientId: 'synthetic-client',
    });
    store.init({ windowMs: 60_000 } as any);

    const result = await store.increment('synthetic-key');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.totalHits).toBe(Number.MAX_SAFE_INTEGER);
    expect(store.getRedisState()).toBe('unavailable');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('[rate-limit] Redis unavailable; protected requests denied', { reason: 'dns_unavailable' });
    expect(unhandled).toHaveLength(0);

    process.off('unhandledRejection', onUnhandled);
    await store.shutdown();
  });

  test('recovers after the bounded retry cooldown without creating duplicate connection attempts', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    connectMock.mockRejectedValueOnce(Object.assign(new Error('synthetic refusal'), { code: 'ECONNREFUSED' }));
    const store = new DistributedRateLimitStore('rediss://synthetic.invalid:10000', 'test:', {
      failClosed: true,
      entraClientId: 'synthetic-client',
    });
    store.init({ windowMs: 60_000 } as any);

    const denied = await store.increment('synthetic-key');
    expect(denied.totalHits).toBe(Number.MAX_SAFE_INTEGER);
    expect(connectMock).toHaveBeenCalledTimes(1);

    const stillDenied = await store.increment('synthetic-key');
    expect(stillDenied.totalHits).toBe(Number.MAX_SAFE_INTEGER);
    expect(connectMock).toHaveBeenCalledTimes(1);

    connectMock.mockResolvedValueOnce(jest.fn());
    jest.spyOn(Date, 'now').mockReturnValue(now + 1_001);
    const recovered = await store.increment('synthetic-key');

    expect(recovered.totalHits).toBe(1);
    expect(store.getRedisState()).toBe('ready');
    expect(connectMock).toHaveBeenCalledTimes(2);
    await store.shutdown();
  });

  test('readiness probes during cooldown do not postpone Redis recovery', async () => {
    const client: any = new EventEmitter();
    client.status = 'end';
    client.eval = jest.fn().mockResolvedValue([1, 60_000]);
    client.decr = jest.fn().mockResolvedValue(0);
    client.del = jest.fn().mockResolvedValue(1);
    client.get = jest.fn().mockResolvedValue(null);
    client.pttl = jest.fn().mockResolvedValue(60_000);
    client.ping = jest.fn().mockResolvedValue('PONG');
    client.quit = jest.fn().mockResolvedValue('OK');
    createMock.mockReturnValueOnce(client);

    const baseTime = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(baseTime);
    const oldCooldown = process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS;
    process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS = '500';
    connectMock.mockRejectedValueOnce(Object.assign(new Error('synthetic refusal'), { code: 'ECONNREFUSED' }));
    connectMock.mockImplementationOnce(async () => {
      client.status = 'ready';
      client.emit('ready');
      return jest.fn();
    });

    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new DistributedRateLimitStore('redis://127.0.0.1:6379', 'test:cooldown:', { failClosed: true });
    store.init({ windowMs: 60_000 } as any);
    try {
      await expect(store.checkHealth()).resolves.toBe(false);
      expect(store.getRedisState()).toBe('unavailable');
      expect(connectMock).toHaveBeenCalledTimes(1);

      // An ioredis reconnecting event must not reset the bounded cooldown on
      // every automatic retry while the service is still unavailable.
      client.status = 'reconnecting';
      client.emit('reconnecting');
      expect(store.getRedisState()).toBe('unavailable');
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 100);
      await expect(store.checkHealth()).resolves.toBe(false);
      client.emit('reconnecting');
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 400);
      await expect(store.checkHealth()).resolves.toBe(false);
      client.emit('reconnecting');
      expect(connectMock).toHaveBeenCalledTimes(1);

      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 501);
      await expect(store.checkHealth()).resolves.toBe(true);
      expect(store.getRedisState()).toBe('ready');
      expect(connectMock).toHaveBeenCalledTimes(2);
    } finally {
      if (oldCooldown === undefined) delete process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS;
      else process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS = oldCooldown;
      warning.mockRestore();
      await store.shutdown();
    }
  });

  test('invalidates stale ready state on disconnect and recovers repeatedly without process restart', async () => {
    const client: any = new EventEmitter();
    client.status = 'end';
    client.eval = jest.fn().mockResolvedValue([1, 60_000]);
    client.decr = jest.fn().mockResolvedValue(0);
    client.del = jest.fn().mockResolvedValue(1);
    client.get = jest.fn().mockResolvedValue(null);
    client.pttl = jest.fn().mockResolvedValue(60_000);
    client.ping = jest.fn().mockResolvedValue('PONG');
    client.quit = jest.fn().mockResolvedValue('OK');
    createMock.mockReturnValueOnce(client);

    const baseTime = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(baseTime);
    const oldCooldown = process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS;
    process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS = '250';
    connectMock.mockImplementation(async () => {
      client.status = 'ready';
      client.emit('ready');
      return jest.fn();
    });

    const store = new DistributedRateLimitStore('redis://127.0.0.1:6379', 'test:recover:', { failClosed: true });
    store.init({ windowMs: 60_000 } as any);
    try {
      await expect(store.increment('key')).resolves.toMatchObject({ totalHits: 1 });
      expect(store.getRedisState()).toBe('ready');

      for (const [index, event] of ['close', 'end', 'reconnecting', 'close'].entries()) {
        client.status = event === 'reconnecting' ? 'reconnecting' : 'end';
        client.emit(event);
        expect(store.getRedisState()).toBe('unavailable');
        jest.spyOn(Date, 'now').mockReturnValue(baseTime + (index + 1) * 300);
        await expect(store.checkHealth()).resolves.toBe(true);
        expect(store.getRedisState()).toBe('ready');
      }

      expect(connectMock).toHaveBeenCalledTimes(5);
    } finally {
      if (oldCooldown === undefined) delete process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS;
      else process.env.REDIS_RATE_LIMIT_RETRY_COOLDOWN_MS = oldCooldown;
      await store.shutdown();
    }
  });

  test('does not throw when a protected limiter is initialized without a managed-identity client ID', () => {
    const store = new DistributedRateLimitStore('rediss://synthetic.invalid:10000', 'test:', { failClosed: true });
    expect(() => store.init({ windowMs: 60_000 } as any)).not.toThrow();
  });
});
