const mockQueue={sendMessage:jest.fn(),receiveMessages:jest.fn(),updateMessage:jest.fn(),deleteMessage:jest.fn()};
const mockPoison={sendMessage:jest.fn()};
jest.mock('@azure/identity',()=>({ManagedIdentityCredential:jest.fn()}));
jest.mock('@azure/storage-queue',()=>({QueueClient:jest.fn((url:string)=>url.endsWith('/media-review')?mockPoison:mockQueue)}));
import {createAzureMediaQueue} from '../azureMediaQueue';
import {ManagedIdentityCredential} from '@azure/identity';
describe('Azure queue identity and opaque transport',()=>{
  const original={...process.env};
  beforeEach(()=>{jest.clearAllMocks();process.env.AZURE_MEDIA_QUEUE_ACCOUNT_URL='https://syntheticmedia.queue.core.windows.net';process.env.AZURE_MEDIA_QUEUE_NAME='media-processing';process.env.AZURE_MEDIA_POISON_QUEUE_NAME='media-review';process.env.AZURE_MEDIA_IDENTITY_CLIENT_ID='00000000-0000-4000-8000-000000000001';});
  afterEach(()=>{process.env={...original};});
  it('uses managed identity, opaque job identifiers and infinite durable TTL',async()=>{
    const q=createAzureMediaQueue();await q.send('00000000-0000-4000-8000-000000000002');
    expect(ManagedIdentityCredential).toHaveBeenCalledWith(process.env.AZURE_MEDIA_IDENTITY_CLIENT_ID);
    expect(mockQueue.sendMessage).toHaveBeenCalledWith(JSON.stringify({id:'00000000-0000-4000-8000-000000000002'}),{messageTimeToLive:-1});
  });
  it('renews the pop receipt and acknowledges the updated delivery only',async()=>{
    mockQueue.receiveMessages.mockResolvedValue({receivedMessageItems:[{messageId:'message',popReceipt:'old',messageText:'{}'}]});
    mockQueue.updateMessage.mockResolvedValue({popReceipt:'new'});
    const q=createAzureMediaQueue(),delivery=await q.receive();expect(delivery).toBeDefined();
    await q.renew(delivery!);await q.acknowledge(delivery!);
    expect(mockQueue.deleteMessage).toHaveBeenCalledWith('message','new');
  });
  it.each(['http://syntheticmedia.queue.core.windows.net','https://unapproved.invalid','https://syntheticmedia.queue.core.windows.net?token=synthetic'])('rejects unsafe account endpoint %s',account=>{
    process.env.AZURE_MEDIA_QUEUE_ACCOUNT_URL=account;expect(()=>createAzureMediaQueue()).toThrow('CONFIGURATION_INVALID');
  });
  it('rejects shared processing/review queues',()=>{process.env.AZURE_MEDIA_POISON_QUEUE_NAME='media-processing';expect(()=>createAzureMediaQueue()).toThrow('CONFIGURATION_INVALID');});
  it('poison metadata never includes the message body or original receipt',async()=>{
    await createAzureMediaQueue().poison({id:'message',receipt:'synthetic-receipt',body:'private synthetic payload'},'INVALID_MESSAGE');
    expect(mockPoison.sendMessage).toHaveBeenCalledWith(JSON.stringify({messageId:'message',reason:'INVALID_MESSAGE'}),{messageTimeToLive:-1});
  });
});
