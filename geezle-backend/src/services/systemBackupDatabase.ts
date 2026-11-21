import { readFileSync } from 'node:fs';
import { Client, type ClientConfig } from 'pg';

const BACKUP_ROLE = 'scrolith_backup';
const PRODUCTION_DATABASE = 'scrolith';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const configurationError = () => new Error('System backup database configuration is invalid or unavailable.');

const parseDatabaseUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw configurationError();
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw configurationError();
  return parsed;
};

export const buildSystemBackupDatabaseClientConfig = (
  env: NodeJS.ProcessEnv = process.env,
  readCa: (path: string) => Buffer = (path) => readFileSync(path)
): ClientConfig => {
  const production = env.NODE_ENV === 'production';
  const configuredUrl = env.SCROLITH_SYSTEM_BACKUP_DATABASE_URL?.trim();
  const rawUrl = production ? configuredUrl : configuredUrl || env.DATABASE_URL?.trim();
  if (!rawUrl) throw configurationError();

  const parsed = parseDatabaseUrl(rawUrl);
  const host = (parsed.hostname || parsed.searchParams.get('host') || '').toLowerCase();
  const username = decodeURIComponent(parsed.username || '');
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const port = Number(parsed.port || 5432);

  if (!host || !database || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw configurationError();
  }

  let ssl: ClientConfig['ssl'] = false;
  if (production) {
    const caPath = env.SCROLITH_SYSTEM_BACKUP_CA_FILE?.trim();
    if (
      username !== BACKUP_ROLE ||
      database !== PRODUCTION_DATABASE ||
      port !== 5432 ||
      !host.endsWith('.postgres.database.azure.com') ||
      parsed.searchParams.get('sslmode') !== 'verify-full' ||
      !caPath
    ) {
      throw configurationError();
    }
    let ca: Buffer;
    try {
      ca = readCa(caPath);
    } catch {
      throw configurationError();
    }
    if (!ca.length) throw configurationError();
    ssl = { rejectUnauthorized: true, ca };
  } else {
    if (!LOOPBACK_HOSTS.has(host)) throw configurationError();
    if (parsed.searchParams.has('sslmode') && parsed.searchParams.get('sslmode') !== 'disable') {
      throw configurationError();
    }
  }

  return {
    host,
    port,
    user: username,
    password: decodeURIComponent(parsed.password || ''),
    database,
    ssl,
    connectionTimeoutMillis: 10_000,
    application_name: 'scrolith-system-backup'
  };
};

export const createSystemBackupDatabaseClient = (env: NodeJS.ProcessEnv = process.env) =>
  new Client(buildSystemBackupDatabaseClientConfig(env));

export const connectSystemBackupDatabase = async (env: NodeJS.ProcessEnv = process.env) => {
  const client = createSystemBackupDatabaseClient(env);
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    throw new Error('System backup database connection failed.');
  }
};
