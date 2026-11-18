import { ManagedIdentityCredential } from '@azure/identity';
import { QueueClient } from '@azure/storage-queue';

export type Delivery = { id: string; receipt: string; body: string };
export interface MediaQueue {
  send(id: string): Promise<void>;
  receive(): Promise<Delivery | undefined>;
  renew(delivery: Delivery): Promise<void>;
  acknowledge(delivery: Delivery): Promise<void>;
  poison(delivery: Delivery, reason: string): Promise<void>;
}

export function createAzureMediaQueue(): MediaQueue {
  const account = process.env.AZURE_MEDIA_QUEUE_ACCOUNT_URL || '';
  const name = process.env.AZURE_MEDIA_QUEUE_NAME || '';
  const poisonName = process.env.AZURE_MEDIA_POISON_QUEUE_NAME || '';
  const clientId = process.env.AZURE_MEDIA_IDENTITY_CLIENT_ID || '';
  if (!/^https:\/\/[a-z0-9]{3,24}\.queue\.core\.windows\.net$/.test(account) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(poisonName) || name === poisonName ||
      !/^[a-f0-9-]{36}$/i.test(clientId)) throw new Error('AZURE_MEDIA_QUEUE_CONFIGURATION_INVALID');
  const credential = new ManagedIdentityCredential(clientId);
  const options = { retryOptions: { maxTries: 2 }, keepAliveOptions: { enable: true } };
  const queue = new QueueClient(account+'/'+name, credential, options);
  const poison = new QueueClient(account+'/'+poisonName, credential, options);
  return {
    async send(id) { await queue.sendMessage(JSON.stringify({ id }), { messageTimeToLive: -1 }); },
    async receive() {
      const r = await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout: 180 });
      const m = r.receivedMessageItems[0];
      return m ? { id: m.messageId, receipt: m.popReceipt, body: m.messageText } : undefined;
    },
    async renew(m) {
      const r = await queue.updateMessage(m.id, m.receipt, undefined, 180);
      m.receipt = r.popReceipt;
    },
    async acknowledge(m) { await queue.deleteMessage(m.id, m.receipt); },
    async poison(m, reason) {
      // No original content, SAS, tokens or arbitrary exception strings.
      await poison.sendMessage(JSON.stringify({ messageId: m.id, reason }), { messageTimeToLive: -1 });
    }
  };
}
