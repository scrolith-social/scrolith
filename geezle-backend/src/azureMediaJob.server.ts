import 'dotenv/config';
import { databasePool, disconnectPrisma } from './utils/prismaClient';
import { AzureMediaOutbox, azureMediaEnabled } from './services/media/azureMediaOutbox';
import { createAzureMediaQueue } from './services/media/azureMediaQueue';
import { azureMediaProcessor } from './services/media/azureMediaProcessor';
import { consumeAzureMedia } from './services/media/azureMediaConsumer';

const abort = new AbortController();
const shutdown = () => {
  abort.abort();
  // Never acknowledge unfinished work; the persisted lease and queue visibility expire.
  const deadline = setTimeout(() => process.exit(1), 25_000);
  deadline.unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

async function main() {
  if (!azureMediaEnabled() || !databasePool || process.env.MEDIA_WORKER_SERVICE !== 'true') {
    throw new Error('AZURE_MEDIA_JOB_DISABLED');
  }
  const store = new AzureMediaOutbox(databasePool);
  const queue = createAzureMediaQueue();
  const mode = process.argv[2];
  if (mode === 'dispatch') {
    console.info('[azure-media] outbox dispatched', { count: await store.dispatch(id => queue.send(id)) });
  } else if (mode === 'consume') {
    const outcome = await consumeAzureMedia(store, queue, azureMediaProcessor, abort.signal);
    console.info('[azure-media] delivery outcome', { outcome });
    if (outcome === 'deferred') process.exitCode = 1;
  } else throw new Error('AZURE_MEDIA_JOB_COMMAND_INVALID');
}

void main().catch(() => {
  console.error('[azure-media] job failed; durable work remains eligible for retry');
  process.exitCode = 1;
}).finally(() => disconnectPrisma());
