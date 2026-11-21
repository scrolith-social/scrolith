import { buildSystemBackupDatabaseClientConfig } from '../systemBackupDatabase';

describe('system backup database connection policy', () => {
  const productionEnv = {
    NODE_ENV: 'production',
    SCROLITH_SYSTEM_BACKUP_DATABASE_URL:
      'postgresql://scrolith_backup@role-test.postgres.database.azure.com/scrolith?sslmode=verify-full',
    SCROLITH_SYSTEM_BACKUP_CA_FILE: 'synthetic-root-ca.pem'
  } as NodeJS.ProcessEnv;

  it('uses the dedicated production backup role and hostname-verified TLS', () => {
    const config = buildSystemBackupDatabaseClientConfig(productionEnv, () => Buffer.from('synthetic CA'));
    expect(config.user).toBe('scrolith_backup');
    expect(config.database).toBe('scrolith');
    expect(config.host).toBe('role-test.postgres.database.azure.com');
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: Buffer.from('synthetic CA') });
  });

  it('never falls back to the runtime DATABASE_URL in production', () => {
    expect(() => buildSystemBackupDatabaseClientConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app_role@db.example.invalid:5432/scrolith_test'
    } as NodeJS.ProcessEnv)).toThrow('System backup database configuration is invalid or unavailable.');
  });

  it('rejects a production URL that uses the runtime role', () => {
    const env = {
      ...productionEnv,
      SCROLITH_SYSTEM_BACKUP_DATABASE_URL:
        'postgresql://scrolith_runtime@role-test.postgres.database.azure.com/scrolith?sslmode=verify-full',
    } as NodeJS.ProcessEnv;
    expect(() => buildSystemBackupDatabaseClientConfig(env, () => Buffer.from('synthetic CA')))
      .toThrow('System backup database configuration is invalid or unavailable.');
  });

  it.each(['require', 'prefer', 'disable', undefined])('rejects production TLS mode %s', (sslmode) => {
    const url = new URL(String(productionEnv.SCROLITH_SYSTEM_BACKUP_DATABASE_URL));
    if (sslmode === undefined) url.searchParams.delete('sslmode');
    else url.searchParams.set('sslmode', sslmode);
    const env = { ...productionEnv, SCROLITH_SYSTEM_BACKUP_DATABASE_URL: url.toString() } as NodeJS.ProcessEnv;
    expect(() => buildSystemBackupDatabaseClientConfig(env, () => Buffer.from('synthetic CA')))
      .toThrow('System backup database configuration is invalid or unavailable.');
  });

  it('rejects an unreadable or empty production CA without revealing its path', () => {
    expect(() => buildSystemBackupDatabaseClientConfig(productionEnv, () => {
      throw new Error('synthetic path failure');
    })).toThrow('System backup database configuration is invalid or unavailable.');
    expect(() => buildSystemBackupDatabaseClientConfig(productionEnv, () => Buffer.alloc(0)))
      .toThrow('System backup database configuration is invalid or unavailable.');
  });

  it('allows only loopback database URLs for local backup development', () => {
    const config = buildSystemBackupDatabaseClientConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://local_test@127.0.0.1:5432/scrolith_test'
    } as NodeJS.ProcessEnv);
    expect(config.host).toBe('127.0.0.1');
    expect(config.ssl).toBe(false);
    expect(() => buildSystemBackupDatabaseClientConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://remote_test@remote.example.invalid:5432/scrolith_test'
    } as NodeJS.ProcessEnv)).toThrow('System backup database configuration is invalid or unavailable.');
  });
});
