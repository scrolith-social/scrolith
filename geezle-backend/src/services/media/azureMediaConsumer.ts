import { AzureMediaOutbox, type VariantRow } from './azureMediaOutbox';
import type { MediaQueue } from './azureMediaQueue';
import { MediaScanRejected, type MediaProcessor } from './azureMediaProcessor';

export async function consumeAzureMedia(
  store: AzureMediaOutbox, queue: MediaQueue, processor: MediaProcessor, signal?: AbortSignal
): Promise<string> {
  const delivery = await queue.receive();
  if (!delivery) return 'empty';
  let id: string;
  try {
    const data: unknown = JSON.parse(delivery.body);
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).join() !== 'id' || !/^[a-f0-9-]{36}$/i.test((data as { id?: string }).id || '')) {
      throw new Error('INVALID_MESSAGE');
    }
    id = (data as { id: string }).id;
  } catch {
    await queue.poison(delivery, 'INVALID_MESSAGE');
    await queue.acknowledge(delivery);
    return 'invalid';
  }
  const claim = await store.claim(id);
  if (claim === 'terminal' || claim === 'unknown') {
    if (claim === 'unknown') await queue.poison(delivery, 'UNKNOWN_JOB');
    await queue.acknowledge(delivery);
    return claim;
  }
  if (claim === 'busy') return 'busy';

  const keys: string[] = [];
  let lost = false;
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      if (!await store.renew(claim.job)) throw new Error('LEASE_LOST');
      await queue.renew(delivery);
    }).catch(() => { lost = true; });
  }, 30_000);
  let durable = false;
  try {
    if (signal?.aborted) throw new Error('INTERRUPTED');
    const result = await processor.generate(claim);
    const rows: VariantRow[] = [];
    for (const [i, variant] of result.variants.entries()) {
      if (lost || signal?.aborted) throw new Error('INTERRUPTED');
      const key = 'media/'+claim.file.id+'/azure/'+claim.job.id+'/'+claim.job.fence+'/'+i+'-'+variant.checksum+'.'+variant.format;
      // Track before upload so a storage error after remote commit is still eligible for cleanup.
      keys.push(key);
      await processor.upload(key, variant);
      rows.push({
        kind: variant.kind, label: variant.label, width: variant.width, height: variant.height,
        format: variant.format, mimeType: variant.mimeType, storageKey: key,
        size: variant.buffer.length, checksum: variant.checksum
      });
    }
    clearInterval(timer);
    await heartbeat;
    if (lost || signal?.aborted) throw new Error('INTERRUPTED');
    durable = await store.complete(claim, rows, result.digest, result);
  } catch (error) {
    clearInterval(timer);
    await heartbeat;
    const code = error instanceof MediaScanRejected ? 'SCAN_REJECTED'
      : signal?.aborted ? 'SHUTDOWN' : 'PROCESSING_RETRY';
    if (!lost) await store.fail(claim.job, code);
    console.warn('[azure-media] attempt deferred', { jobId: id, fence: claim.job.fence, reason: code });
  } finally {
    clearInterval(timer);
    // A connection loss during COMMIT has an ambiguous outcome. Read durable state
    // before deleting candidate objects; retaining unreferenced blobs is safer.
    const confirmed = await store.pool.query<{ status: string }>(
      'SELECT status FROM azure_media_jobs WHERE id=$1 AND fence=$2', [id, claim.job.fence]
    ).catch(() => null);
    if (confirmed?.rows[0]?.status !== 'DONE' && confirmed !== null) {
      for (const key of keys) await processor.remove(key).catch(() => undefined);
    }
  }
  if (durable) {
    // Separate from processing catch: an ack failure must never undo committed derivatives.
    await queue.acknowledge(delivery);
    console.info('[azure-media] completed', { jobId: id, fence: claim.job.fence, attempts: claim.job.attempts });
    return 'done';
  }
  // Failure/rejection is durable but the next delivery reads it before acknowledging.
  return 'deferred';
}
