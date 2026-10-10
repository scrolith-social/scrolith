import Redis from 'ioredis';
import { connectWithManagedIdentity } from '../services/redis/entraRedis';

// Test-mode override: set GCOIN_TEST_WINDOWS=1 to shorten windows for fast CI/local tests
const TEST_MODE = (process.env.GCOIN_TEST_WINDOWS || '') === '1';
const MINUTES = TEST_MODE ? 5 * 1000 : 60 * 1000;
const HOURS = TEST_MODE ? 30 * 1000 : 60 * MINUTES;

export const TRANSFER_LIMIT_PER_MIN = 3;
export const TRANSFER_LIMIT_PER_HOUR = 10;
export const CONVERSION_LIMIT_PER_DAY = 3;

const isTestRuntime = String(process.env.NODE_ENV || '').toLowerCase() === 'test';
const redisUrl = isTestRuntime
  ? String(process.env.REDIS_URL || '').trim()
  : process.env.REDIS_URL || process.env.REDIS || '';
const protectedRuntime = ['production', 'staging'].includes(String(process.env.NODE_ENV || '').toLowerCase());
let redis: Redis | null = null;
let redisInit: Promise<Redis | null> | null = null;
let redisStop: (() => void) | null = null;

function getRedisUrlForRuntime() {
  if (!isTestRuntime) return redisUrl;

  if (!redisUrl) {
    throw new Error(
      'Gcoin tests require REDIS_URL pointing to local test Redis at 127.0.0.1; in-memory fallback is disabled.'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    throw new Error(
      'Gcoin tests require REDIS_URL pointing to local test Redis at 127.0.0.1; in-memory fallback is disabled.'
    );
  }

  if (parsedUrl.protocol !== 'redis:' || parsedUrl.hostname !== '127.0.0.1') {
    throw new Error(
      'Gcoin tests require REDIS_URL pointing to local test Redis at 127.0.0.1; refusing non-local Redis.'
    );
  }

  if (String(process.env.REDIS_ENTRA_CLIENT_ID || '').trim()) {
    throw new Error('Gcoin tests must use local Redis without managed identity.');
  }

  return redisUrl;
}

async function getRedis() {
  const activeRedisUrl = getRedisUrlForRuntime();
  if (redis) return redis;
  if (redisInit) return redisInit;
  if (!activeRedisUrl) return null;

  redisInit = (async () => {
    try {
      if (isTestRuntime) {
        redis = new Redis(activeRedisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null
        });
        await redis.connect();
        await redis.ping();
        return redis;
      }

      const entraClientId = String(process.env.REDIS_ENTRA_CLIENT_ID || '').trim();
      const entraUsername = String(process.env.REDIS_ENTRA_OBJECT_ID || '').trim() || undefined;
      if (entraClientId) {
        redis = new Redis(activeRedisUrl, { lazyConnect: true });
        redisStop = await connectWithManagedIdentity(redis, { clientId: entraClientId, username: entraUsername });
      } else {
        redis = new Redis(activeRedisUrl);
      }
      return redis;
    } catch (e) {
      if (isTestRuntime) {
        const failedClient = redis;
        redis = null;
        redisInit = null;
        try {
          redisStop?.();
        } catch {
          // Preserve the explicit test Redis initialization failure below.
        }
        redisStop = null;
        try {
          failedClient?.disconnect();
        } catch {
          // Client shutdown is best-effort after connection failure.
        }
        throw new Error(
          'Could not connect to required local test Redis at 127.0.0.1; Gcoin Redis coverage cannot be skipped.'
        );
      }

      console.warn('Failed to init Redis for gcoin limits; protected operations will deny safely');
      redis = null;
      return null;
    }
  })();

  return redisInit;
}

// In-memory fallback for environments without Redis (dev/tests)
const transferWindows = new Map<string, number[]>();
const conversionWindows = new Map<string, number[]>();

function prune(arr: number[], spanMs: number) {
  const cutoff = Date.now() - spanMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

const TRANSFER_LUA = `
-- ARGV: now, minWindow, hourWindow, limitMin, limitHour, ttlSeconds
local key = KEYS[1]
local now = tonumber(ARGV[1])
local minWindow = tonumber(ARGV[2])
local hourWindow = tonumber(ARGV[3])
local limitMin = tonumber(ARGV[4])
local limitHour = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', key, 0, hourWindow)
local countHour = redis.call('ZCOUNT', key, '-inf', '+inf')
if tonumber(countHour) >= limitHour then
  return 0
end
local countMin = redis.call('ZCOUNT', key, minWindow, '+inf')
if tonumber(countMin) >= limitMin then
  return 0
end
local member = ARGV[1] .. ':' .. tostring(math.random(100000,999999))
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return 1
`;

export async function tryRecordTransfer(userId: string) {
  const client = await getRedis();
  if (!client) {
    if (protectedRuntime) return false;
    const arr = transferWindows.get(userId) || [];
    prune(arr, HOURS);
    const arrMin = arr.filter((t) => t > Date.now() - MINUTES);
    if (arr.length >= TRANSFER_LIMIT_PER_HOUR) return false;
    if (arrMin.length >= TRANSFER_LIMIT_PER_MIN) return false;
    arr.push(Date.now());
    transferWindows.set(userId, arr);
    return true;
  }
  const key = `gcoin:transfers:${userId}`;
  const now = Date.now();
  const minWindow = now - MINUTES;
  const hourWindow = now - HOURS;
  const ttl = Math.ceil((HOURS * 2) / 1000);
  try {
    const res = await client.eval(TRANSFER_LUA, 1, key, now.toString(), minWindow.toString(), hourWindow.toString(), TRANSFER_LIMIT_PER_MIN.toString(), TRANSFER_LIMIT_PER_HOUR.toString(), ttl.toString());
    return Number(res) === 1;
  } catch (e) {
    if (isTestRuntime) {
      throw new Error('Gcoin test Redis transfer-limit command failed; Redis coverage cannot be skipped.');
    }
    console.warn('Redis tryRecordTransfer error; denying safely', String((e as any)?.message || e).slice(0, 160));
    return false;
  }
}

const CONVERSION_LUA = `
-- ARGV: now, dayWindow, limitDay, ttlSeconds
local key = KEYS[1]
local now = tonumber(ARGV[1])
local dayWindow = tonumber(ARGV[2])
local limitDay = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, 0, dayWindow)
local cnt = redis.call('ZCOUNT', key, '-inf', '+inf')
if tonumber(cnt) >= limitDay then
  return 0
end
local member = ARGV[1] .. ':' .. tostring(math.random(100000,999999))
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return 1
`;

export async function tryRecordConversion(userId: string) {
  const client = await getRedis();
  if (!client) {
    if (protectedRuntime) return false;
    const arr = conversionWindows.get(userId) || [];
    prune(arr, 24 * HOURS);
    if (arr.length >= CONVERSION_LIMIT_PER_DAY) return false;
    arr.push(Date.now());
    conversionWindows.set(userId, arr);
    return true;
  }
  const key = `gcoin:conversions:${userId}`;
  const now = Date.now();
  const dayWindow = now - 24 * HOURS;
  const ttl = Math.ceil((24 * HOURS) / 1000 + 60);
  try {
    const res = await client.eval(CONVERSION_LUA, 1, key, now.toString(), dayWindow.toString(), CONVERSION_LIMIT_PER_DAY.toString(), ttl.toString());
    return Number(res) === 1;
  } catch (e) {
    if (isTestRuntime) {
      throw new Error('Gcoin test Redis conversion-limit command failed; Redis coverage cannot be skipped.');
    }
    console.warn('Redis tryRecordConversion error; denying safely', String((e as any)?.message || e).slice(0, 160));
    return false;
  }
}

export function resetAll() {
  transferWindows.clear();
  conversionWindows.clear();
}

export async function closeGcoinLimitStore() {
  const client = redis;
  redis = null;
  redisInit = null;
  redisStop?.();
  redisStop = null;
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export async function clearUserLimitState(userId: string) {
  const client = await getRedis();
  if (client) {
    await client.del(`gcoin:transfers:${userId}`, `gcoin:conversions:${userId}`);
  }
  transferWindows.delete(userId);
  conversionWindows.delete(userId);
}

export default {};
