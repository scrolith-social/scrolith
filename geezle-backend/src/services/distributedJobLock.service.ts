import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { databasePool } from '../utils/prismaClient';

export type DistributedJobResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; value?: never };

const advisoryKeys = (jobName: string): [number, number] => {
  const digest = createHash('sha256').update(`scrolith:scheduled-job:${jobName}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
};

const releaseClient = async (client: PoolClient, keys: [number, number], locked: boolean) => {
  let destroyReason: Error | undefined;
  if (locked) {
    try {
      const result = await client.query<{ unlocked: boolean }>(
        'SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked',
        keys
      );
      if (result.rows[0]?.unlocked !== true) {
        destroyReason = new Error('Scheduled-job advisory lock was not held at release.');
      }
    } catch (error) {
      destroyReason = error instanceof Error ? error : new Error('Scheduled-job lock release failed.');
    }
  }
  client.release(destroyReason);
  if (destroyReason) {
    throw new Error('Unable to safely release scheduled-job lock; database session was discarded.');
  }
};

/**
 * Serializes one named periodic job across API processes sharing the same
 * direct PostgreSQL session endpoint. The callback is never run if lock
 * acquisition cannot be confirmed. This is an overlap guard, not a durable
 * queue or exactly-once guarantee; callers must retain their own idempotency.
 */
export const withDistributedJobLock = async <T>(
  jobName: string,
  callback: () => Promise<T>
): Promise<DistributedJobResult<T>> => {
  const normalizedName = String(jobName || '').trim();
  if (!/^[a-z0-9][a-z0-9:._-]{0,119}$/i.test(normalizedName)) {
    throw new Error('Invalid scheduled-job lock name.');
  }
  if (!databasePool) {
    throw new Error('Scheduled-job coordination requires the configured PostgreSQL pool.');
  }

  const client = await databasePool.connect();
  const keys = advisoryKeys(normalizedName);
  let locked = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
      keys
    );
    locked = result.rows[0]?.acquired === true;
    if (!locked) return { acquired: false };

    const value = await callback();
    return { acquired: true, value };
  } finally {
    await releaseClient(client, keys, locked);
  }
};
