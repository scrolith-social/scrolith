import { isProductionRuntime } from '../utils/security/isProductionRuntime';

const truthy = (value: unknown) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

export const runtimePolicy = {
  isTest:
    process.env.NODE_ENV === 'test' ||
    process.env.APP_RUNTIME === 'test' ||
    Boolean(process.env.JEST_WORKER_ID),
  backgroundWorkersEnabled:
    process.env.NODE_ENV !== 'test' &&
    process.env.APP_RUNTIME !== 'test' &&
    !process.env.JEST_WORKER_ID &&
    !truthy(process.env.DISABLE_BACKGROUND_WORKERS)
};

export const assertSafeTestDatabaseUrl = (databaseUrl = process.env.DATABASE_URL) => {
  const value = String(databaseUrl || '');
  if (!runtimePolicy.isTest) {
    throw new Error('Refusing to operate on test database when NODE_ENV/APP_RUNTIME is not test.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Refusing to reset or prepare a non-isolated test database.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const databaseName = parsed.pathname.replace(/^\/+/, '').toLowerCase();
  const expectedPort = Number(process.env.TEST_DB_PORT || 55432);
  const allowedHost = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const disposableName = databaseName.includes('test') || databaseName.includes('e2e');
  if (!allowedHost || Number(parsed.port) !== expectedPort || expectedPort < 1 || expectedPort > 65535 || !disposableName) {
    throw new Error('Refusing to reset or prepare a non-isolated test database.');
  }
  return value;
};

/**
 * The production server entry point normally never binds a port in test mode.
 * Browser integration CI may opt in only with an isolated loopback test DB.
 */
export const shouldListenForTestServer = (): boolean => {
  if (!runtimePolicy.isTest || process.env.SCROLITH_TEST_SERVER_LISTEN !== 'true') return false;
  if (isProductionRuntime()) {
    throw new Error('Refusing to start the test HTTP server in a production or managed runtime.');
  }
  assertSafeTestDatabaseUrl();
  return true;
};
