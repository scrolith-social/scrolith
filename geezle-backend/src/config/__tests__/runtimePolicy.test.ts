import { shouldListenForTestServer } from '../runtimePolicy';

const scopedEnvironmentKeys = [
  'NODE_ENV',
  'APP_RUNTIME',
  'SCROLITH_TEST_SERVER_LISTEN',
  'DATABASE_URL',
  'TEST_DB_PORT',
  'K_SERVICE',
  'CONTAINER_APP_NAME',
  'CONTAINER_APP_REVISION',
  'WEBSITE_SITE_NAME',
  'WEBSITE_INSTANCE_ID',
  'AZURE_CONTAINER_APPS_ENVIRONMENT_ID'
] as const;

describe('test HTTP server listen guard', () => {
  const originalValues = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of scopedEnvironmentKeys) {
      originalValues.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NODE_ENV = 'test';
    process.env.APP_RUNTIME = 'test';
    process.env.TEST_DB_PORT = '55432';
    process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:55432/scrolith_test';
  });

  afterEach(() => {
    for (const key of scopedEnvironmentKeys) {
      const original = originalValues.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    originalValues.clear();
  });

  test('keeps test server auto-listening disabled by default', () => {
    expect(shouldListenForTestServer()).toBe(false);
  });

  test('allows explicit listening only for a local disposable test database', () => {
    process.env.SCROLITH_TEST_SERVER_LISTEN = 'true';

    expect(shouldListenForTestServer()).toBe(true);
  });

  test('rejects remote or non-disposable database targets before listening', () => {
    process.env.SCROLITH_TEST_SERVER_LISTEN = 'true';
    process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@db.example.invalid:55432/scrolith';

    expect(() => shouldListenForTestServer()).toThrow('Refusing to reset or prepare a non-isolated test database.');
  });

  test('rejects managed or production runtime markers even with the test opt-in', () => {
    process.env.SCROLITH_TEST_SERVER_LISTEN = 'true';
    process.env.CONTAINER_APP_NAME = 'managed-runtime';

    expect(() => shouldListenForTestServer()).toThrow(
      'Refusing to start the test HTTP server in a production or managed runtime.'
    );
  });
});
