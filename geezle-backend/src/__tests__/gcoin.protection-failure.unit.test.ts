describe('Gcoin protection-store failure safety', () => {
  const original = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...original };
    jest.dontMock('ioredis');
  });

  test('transfer and conversion deny when Redis initialization fails', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.REDIS_URL = 'rediss://unavailable.invalid:10000';
    process.env.REDIS_ENTRA_CLIENT_ID = 'staging-client-id';
    process.env.REDIS_ENTRA_OBJECT_ID = 'staging-object-id';
    jest.doMock('ioredis', () => jest.fn().mockImplementation(() => { throw new Error('controlled unavailable dependency'); }));

    let tryRecordTransfer!: (userId: string) => Promise<boolean>;
    let tryRecordConversion!: (userId: string) => Promise<boolean>;
    jest.isolateModules(() => {
      ({ tryRecordTransfer, tryRecordConversion } = require('../middleware/gcoinLimits'));
    });

    await expect(tryRecordTransfer('synthetic-user')).resolves.toBe(false);
    await expect(tryRecordConversion('synthetic-user')).resolves.toBe(false);
  });

  test('test runtime rejects remote Redis before creating a client', async () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = 'redis://redis.example.invalid:6379';
    delete process.env.REDIS;

    const redisConstructor = jest.fn();
    jest.doMock('ioredis', () => redisConstructor);

    let tryRecordTransfer!: (userId: string) => Promise<boolean>;
    jest.isolateModules(() => {
      ({ tryRecordTransfer } = require('../middleware/gcoinLimits'));
    });

    await expect(tryRecordTransfer('synthetic-user')).rejects.toThrow(
      'Gcoin tests require REDIS_URL pointing to local test Redis at 127.0.0.1'
    );
    expect(redisConstructor).not.toHaveBeenCalled();
  });
});
