import { shutdown as shutdownGcoinLimits } from '../middleware/gcoinLimits';

/** Close the Gcoin Redis client created inside this Jest worker. */
export async function cleanupGcoinRedisClient(): Promise<void> {
  await shutdownGcoinLimits();
}
