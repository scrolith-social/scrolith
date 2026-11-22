import Redis from 'ioredis';
import { ManagedIdentityCredential } from '@azure/identity';
import { connectWithManagedIdentity } from '../entraRedis';

jest.mock('@azure/identity', () => ({
  ManagedIdentityCredential: jest.fn()
}));

describe('Entra Redis token refresh contract', () => {
  afterEach(() => jest.useRealTimers());

  test('refreshes before expiry with jitter and reauthenticates without replacing the client', async () => {
    jest.useFakeTimers();
    const getToken = jest.fn()
      .mockResolvedValueOnce({ token: 'token-one', expiresOnTimestamp: Date.now() + 31_000 })
      .mockResolvedValueOnce({ token: 'token-two', expiresOnTimestamp: Date.now() + 300_000 });
    (ManagedIdentityCredential as unknown as jest.Mock).mockImplementation(() => ({ getToken }));
    const redis = {
      options: { tls: {} } as Record<string, unknown>,
      connect: jest.fn().mockResolvedValue(undefined),
      auth: jest.fn().mockResolvedValue('OK')
    } as unknown as Redis;

    const stop = await connectWithManagedIdentity(redis, {
      clientId: 'user-assigned-client-id',
      username: 'user-assigned-object-id'
    });
    expect(ManagedIdentityCredential).toHaveBeenCalledWith('user-assigned-client-id');
    expect(redis.options.username).toBe('user-assigned-object-id');
    expect(redis.options.password).toBe('token-one');
    expect(redis.connect).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(redis.auth).toHaveBeenCalledWith('user-assigned-object-id', 'token-two');
    expect(redis.options.password).toBe('token-two');
    expect(redis.connect).toHaveBeenCalledTimes(1);
    stop();
  });

  test('fails closed without TLS before requesting a token or connecting', async () => {
    const getToken = jest.fn();
    (ManagedIdentityCredential as unknown as jest.Mock).mockImplementation(() => ({ getToken }));
    const redis = {
      options: {},
      connect: jest.fn().mockResolvedValue(undefined),
      auth: jest.fn().mockResolvedValue('OK')
    } as unknown as Redis;

    await expect(connectWithManagedIdentity(redis, {
      clientId: 'user-assigned-client-id',
      username: 'user-assigned-object-id'
    })).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    expect(getToken).not.toHaveBeenCalled();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  test('requires the managed identity object ID as the Redis username', async () => {
    const getToken = jest.fn();
    (ManagedIdentityCredential as unknown as jest.Mock).mockImplementation(() => ({ getToken }));
    const redis = {
      options: { tls: {} },
      connect: jest.fn().mockResolvedValue(undefined),
      auth: jest.fn().mockResolvedValue('OK')
    } as unknown as Redis;

    await expect(connectWithManagedIdentity(redis, {
      clientId: 'user-assigned-client-id',
      username: ''
    })).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    expect(getToken).not.toHaveBeenCalled();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  test('does not write token material to logs', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getToken = jest.fn().mockResolvedValue({ token: 'secret-token', expiresOnTimestamp: Date.now() + 300_000 });
    (ManagedIdentityCredential as unknown as jest.Mock).mockImplementation(() => ({ getToken }));
    const redis = { options: { tls: {} }, connect: jest.fn().mockResolvedValue(undefined) } as unknown as Redis;
    const stop = await connectWithManagedIdentity(redis, { clientId: 'user-assigned-client-id', username: 'user-assigned-object-id' });
    expect(`${log.mock.calls}\n${warn.mock.calls}`).not.toContain('secret-token');
    stop();
    log.mockRestore();
    warn.mockRestore();
  });
});
