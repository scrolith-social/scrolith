import { randomUUID } from 'crypto';
import { assertSafeTestDatabaseUrl } from '../../config/runtimePolicy';
import { withDistributedJobLock } from '../distributedJobLock.service';

describe('PostgreSQL distributed scheduled-job lock', () => {
  const jobName = `integration:${randomUUID()}`;

  beforeAll(() => {
    assertSafeTestDatabaseUrl();
  });

  test('only one concurrent process runs the same job, and the next tick can acquire it', async () => {
    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let callbacks = 0;

    const first = withDistributedJobLock(jobName, async () => {
      callbacks += 1;
      signalStarted();
      await firstMayFinish;
      return 'first';
    });

    await started;
    const overlapping = await withDistributedJobLock(jobName, async () => {
      callbacks += 1;
      return 'overlap';
    });
    expect(overlapping).toEqual({ acquired: false });
    expect(callbacks).toBe(1);

    releaseFirst();
    await expect(first).resolves.toEqual({ acquired: true, value: 'first' });

    const retry = await withDistributedJobLock(jobName, async () => {
      callbacks += 1;
      return 'retry';
    });
    expect(retry).toEqual({ acquired: true, value: 'retry' });
    expect(callbacks).toBe(2);
  }, 30000);

  test('releases the database lock when a job callback fails', async () => {
    await expect(
      withDistributedJobLock(jobName, async () => { throw new Error('synthetic job failure'); })
    ).rejects.toThrow('synthetic job failure');

    await expect(
      withDistributedJobLock(jobName, async () => 'recovered')
    ).resolves.toEqual({ acquired: true, value: 'recovered' });
  }, 30000);
});
