import assert from 'node:assert/strict';
import test from 'node:test';
import api from '../../src/services/api';
import { PaymentService } from '../../src/services/payment';

const providerIds = [
  'stripe', 'paypal', 'paystack', 'flutterwave', 'paymongo', 'xendit',
  'monnify', 'opay', 'dragonpay', 'payoneer', 'antom'
];

test('payment gateway service uses shared save/read endpoints and rejects unsuccessful response envelopes', async () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const calls: Array<{ method: string; url: string; payload?: any }> = [];
  const serverGateways = providerIds.map((id) => ({ id, isEnabled: false, config: { environment: 'sandbox' } }));

  try {
    api.get = (async (url: string) => {
      calls.push({ method: 'GET', url });
      return { data: { success: true, data: serverGateways } } as any;
    }) as typeof api.get;
    api.post = (async (url: string, payload: any) => {
      calls.push({ method: 'POST', url, payload });
      return { data: { success: true, data: serverGateways } } as any;
    }) as typeof api.post;

    for (const id of providerIds) {
      const gateways = await PaymentService.updateGateway({
        id,
        is_enabled: false,
        mode: 'test',
        logo: '',
        supported_currencies: [],
        config: { clientId: `synthetic-${id}-id`, clientSecret: '', environment: 'sandbox' }
      } as any);
      assert.equal(gateways.length, providerIds.length);
    }

    const loaded = await PaymentService.getGateways();
    assert.equal(loaded.length, providerIds.length);
    for (let index = 0; index < providerIds.length; index += 1) {
      const call = calls[index];
      assert.equal(call.method, 'POST');
      assert.equal(call.url, '/wallet/admin/gateways');
      assert.deepEqual(Object.keys(call.payload).sort(), ['config', 'id', 'isEnabled']);
      assert.equal(call.payload.id, providerIds[index]);
      assert.equal(call.payload.isEnabled, false);
    }
    assert.deepEqual(calls.at(-1), { method: 'GET', url: '/wallet/admin/gateways' });

    api.post = (async () => ({
      data: { success: false, error: 'Gateway activation is managed separately.', code: 'ERR_GATEWAY_ACTIVATION_SEPARATE' },
      headers: { 'x-request-id': 'synthetic-request-123' }
    }) as any) as typeof api.post;
    await assert.rejects(
      PaymentService.updateGateway({ id: 'stripe', is_enabled: false, mode: 'test', logo: '', supported_currencies: [] } as any),
      /Gateway activation is managed separately.*synthetic-request-123/
    );
  } finally {
    api.get = originalGet;
    api.post = originalPost;
  }
});

test('payment gateway activation uses its dedicated endpoint', async () => {
  const originalPost = api.post;
  let request: any;
  try {
    api.post = (async (url: string, payload: any) => {
      request = { url, payload };
      return { data: { success: true, data: [{ id: payload.id, isEnabled: payload.isEnabled }] } } as any;
    }) as typeof api.post;
    const result = await PaymentService.setGatewayEnabled('stripe', true);
    assert.deepEqual(request, {
      url: '/wallet/admin/gateways/activation',
      payload: { id: 'stripe', isEnabled: true }
    });
    assert.equal(result[0].isEnabled, true);
  } finally {
    api.post = originalPost;
  }
});
