const mockSettings = {
  id: 'settings-1',
  paymentTestMode: false,
  walletFundingProviders: {} as Record<string, any>
};

const mockPrisma = {
  settings: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
};
const mockAuthMiddleware = jest.fn((req: any, _res: any, next: any) => {
  req.user = { id: 'synthetic-admin', role: 'ADMIN' };
  next();
});
const mockAdminMiddleware = jest.fn((_req: any, _res: any, next: any) => next());
const originalEncryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
const originalAntomEnvironment = process.env.ANTOM_ENV;

jest.mock('../../utils/prismaClient', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => mockAuthMiddleware(req, res, next)
}));
jest.mock('../../middleware/admin.middleware', () => ({
  adminMiddleware: (req: any, res: any, next: any) => mockAdminMiddleware(req, res, next)
}));
jest.mock('../../services/stripeConfig.service', () => ({
  getStripeClient: jest.fn(),
  getStripeGatewayConfig: jest.fn(),
  invalidateStripeConfigCache: jest.fn()
}));

import {
  listFundingGatewaysAdmin,
  saveFundingGatewaysAdmin,
  setFundingGatewayActivationAdmin
} from '../walletFunding.controller';
import express from 'express';
import httpRequest from 'supertest';
import walletRoutes from '../../routes/wallet.routes';

const app = express();
app.use(express.json());
app.use('/api/wallet', walletRoutes);

const providerSecrets: Record<string, Record<string, string>> = {
  stripe: { secretKey: 'synthetic-stripe-secret', webhookSecret: 'synthetic-stripe-webhook' },
  paypal: { clientSecret: 'synthetic-paypal-secret' },
  paystack: { secretKey: 'synthetic-paystack-secret' },
  flutterwave: { secretKey: 'synthetic-flutterwave-secret' },
  paymongo: { secretKey: 'synthetic-paymongo-secret' },
  xendit: { secretKey: 'synthetic-xendit-secret', callbackToken: 'synthetic-xendit-callback' },
  monnify: { apiKey: 'synthetic-monnify-key', secretKey: 'synthetic-monnify-secret', contractCode: 'synthetic-monnify-contract' },
  opay: { merchantId: 'synthetic-opay-merchant', secretKey: 'synthetic-opay-secret' },
  dragonpay: { merchantId: 'synthetic-dragonpay-merchant', secretKey: 'synthetic-dragonpay-secret' },
  payoneer: { clientSecret: 'synthetic-payoneer-secret', authToken: 'synthetic-payoneer-token', notificationSecret: 'synthetic-payoneer-notify' },
  antom: { merchantPrivateKey: 'synthetic-antom-private-key', antomPublicKey: 'synthetic-antom-public-key' }
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const createRequest = (body: unknown = {}) => ({ body, requestId: 'test-request-gateway-save' }) as any;

const createResponse = () => {
  const res: any = { body: undefined, statusCode: 200 };
  res.status = jest.fn((status: number) => {
    res.statusCode = status;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
};

describe('payment gateway admin save/read flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SETTINGS_ENCRYPTION_KEY = 'synthetic-payment-gateway-test-encryption-key';
    delete process.env.ANTOM_ENV;
    mockSettings.paymentTestMode = false;
    mockSettings.walletFundingProviders = {};
    mockPrisma.settings.findFirst.mockImplementation(async () => clone(mockSettings));
    mockPrisma.settings.create.mockImplementation(async ({ data }: any) => Object.assign(mockSettings, data, { id: 'settings-1' }));
    mockPrisma.settings.update.mockImplementation(async ({ data }: any) => {
      Object.assign(mockSettings, data);
      return clone(mockSettings);
    });
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalEncryptionKey;
    if (originalAntomEnvironment === undefined) delete process.env.ANTOM_ENV;
    else process.env.ANTOM_ENV = originalAntomEnvironment;
  });

  test('persists sandbox credentials for every provider, redacts every read, and preserves blank secret fields', async () => {
    const config = Object.entries(providerSecrets).map(([id, secrets]) => ({
      id,
      isEnabled: false,
      config: {
        ...secrets,
        ...(id === 'stripe' || id === 'paypal' || id === 'opay' || id === 'antom' ? { environment: 'sandbox' } : {})
      }
    }));

    const saveResponse = createResponse();
    await saveFundingGatewaysAdmin(createRequest({ gateways: config }), saveResponse);

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.body.success).toBe(true);
    expect(mockPrisma.settings.update).toHaveBeenCalledTimes(1);
    const savedResponseText = JSON.stringify(saveResponse.body);
    for (const secrets of Object.values(providerSecrets)) {
      for (const value of Object.values(secrets)) expect(savedResponseText).not.toContain(value);
    }

    const persisted = clone(mockSettings.walletFundingProviders);
    for (const [providerId, secrets] of Object.entries(providerSecrets)) {
      expect(persisted[providerId].enabled).toBe(false);
      for (const [field, value] of Object.entries(secrets)) {
        expect(persisted[providerId][field]).toMatch(/^enc::/);
        expect(persisted[providerId][field]).not.toBe(value);
      }
    }

    const blankSecretRetry = Object.entries(providerSecrets).map(([id, secrets]) => ({
      id,
      isEnabled: false,
      config: Object.fromEntries(Object.keys(secrets).map((field) => [field, '']))
    }));
    const retryResponse = createResponse();
    await saveFundingGatewaysAdmin(createRequest({ gateways: blankSecretRetry }), retryResponse);
    expect(retryResponse.statusCode).toBe(200);
    expect(mockSettings.walletFundingProviders).toEqual(persisted);

    const getResponse = createResponse();
    await listFundingGatewaysAdmin(createRequest(), getResponse);
    expect(getResponse.statusCode).toBe(200);
    const gateways = getResponse.body.data as any[];
    expect(gateways).toHaveLength(Object.keys(providerSecrets).length);

    for (const gateway of gateways) {
      expect(gateway.isEnabled).toBe(false);
      const secrets = providerSecrets[gateway.id];
      for (const field of Object.keys(secrets)) {
        expect(gateway.config[field]).toBe('');
        expect(gateway.config[`has_${field}`]).toBe(true);
        expect(gateway.config[`has${field[0].toUpperCase()}${field.slice(1)}`]).toBe(true);
      }
    }

    const responseText = JSON.stringify(getResponse.body);
    for (const secrets of Object.values(providerSecrets)) {
      for (const value of Object.values(secrets)) expect(responseText).not.toContain(value);
    }
  });

  test('configuration save refuses an activation change and leaves provider state untouched', async () => {
    const res = createResponse();
    await saveFundingGatewaysAdmin(createRequest({
      id: 'stripe',
      isEnabled: true,
      config: { secretKey: 'synthetic-stripe-secret', environment: 'sandbox' }
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ERR_GATEWAY_ACTIVATION_SEPARATE');
    expect(mockPrisma.settings.update).not.toHaveBeenCalled();
    expect(mockSettings.walletFundingProviders).toEqual({});
  });

  test('database save failures return a safe error and log no database message', async () => {
    const privateErrorMarker = 'synthetic-db-connection-detail-do-not-log';
    mockPrisma.settings.update.mockRejectedValue(Object.assign(new Error(privateErrorMarker), { code: 'P1000' }));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = createResponse();

    try {
      await saveFundingGatewaysAdmin(createRequest({
        id: 'stripe',
        isEnabled: false,
        config: { secretKey: 'synthetic-stripe-secret' }
      }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(privateErrorMarker);
      expect(log).toHaveBeenCalledWith('Payment gateway settings save failed', {
        requestId: 'test-request-gateway-save',
        errorCode: 'P1000'
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateErrorMarker);
    } finally {
      log.mockRestore();
    }
  });

  test('provider environment defaults to sandbox rather than the platform-wide live mode', async () => {
    mockSettings.paymentTestMode = false;
    const res = createResponse();
    await listFundingGatewaysAdmin(createRequest(), res);

    const gateways = res.body.data as any[];
    expect(gateways.find((gateway) => gateway.id === 'stripe').config.environment).toBe('sandbox');
    expect(gateways.find((gateway) => gateway.id === 'stripe').config.environmentConfigured).toBe(false);
    expect(gateways.find((gateway) => gateway.id === 'antom').config.environment).toBe('sandbox');
    expect(gateways.find((gateway) => gateway.id === 'antom').config.environmentConfigured).toBe(false);
  });

  test('saving credentials without an explicit provider environment preserves the platform default', async () => {
    const res = createResponse();
    await saveFundingGatewaysAdmin(createRequest({
      id: 'stripe',
      isEnabled: false,
      config: { secretKey: 'synthetic-stripe-secret' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(mockSettings.walletFundingProviders.stripe.environment).toBeUndefined();
    expect(mockSettings.walletFundingProviders.stripe.enabled).toBe(false);
    const stripe = res.body.data.find((gateway: any) => gateway.id === 'stripe');
    expect(stripe.mode).toBe('live');
    expect(stripe.config.environment).toBe('sandbox');
    expect(stripe.config.environmentConfigured).toBe(false);
  });

  test('dedicated activation action enables only after credentials are present', async () => {
    mockSettings.walletFundingProviders = {
      stripe: { secretKey: 'enc::synthetic-ciphertext', environment: 'sandbox', enabled: false }
    };
    const res = createResponse();
    await setFundingGatewayActivationAdmin(createRequest({ id: 'stripe', isEnabled: true }), res);

    expect(res.statusCode).toBe(200);
    expect(mockSettings.walletFundingProviders.stripe.enabled).toBe(true);
    expect(mockSettings.walletFundingProviders.stripe.environment).toBe('sandbox');
    expect(res.body.data.find((gateway: any) => gateway.id === 'stripe').isEnabled).toBe(true);
  });

  test('mounted admin GET, save, reload, and activation routes apply authentication and admin middleware', async () => {
    const initial = await httpRequest(app).get('/api/wallet/admin/gateways').expect(200);
    expect(initial.body.success).toBe(true);

    const gatewayBatch = Object.entries(providerSecrets).map(([id, secrets]) => ({
      id,
      isEnabled: false,
      config: { ...secrets, ...(id === 'stripe' ? { environment: 'sandbox' } : {}) }
    }));
    await httpRequest(app)
      .post('/api/wallet/admin/gateways')
      .send({ gateways: gatewayBatch })
      .expect(200);

    const reloaded = await httpRequest(app).get('/api/wallet/admin/gateways').expect(200);
    const stripe = reloaded.body.data.find((gateway: any) => gateway.id === 'stripe');
    expect(stripe.isEnabled).toBe(false);
    expect(stripe.config.secretKey).toBe('');
    expect(stripe.config.hasSecretKey).toBe(true);
    for (const [providerId, secrets] of Object.entries(providerSecrets)) {
      const gateway = reloaded.body.data.find((item: any) => item.id === providerId);
      expect(gateway.isEnabled).toBe(false);
      for (const field of Object.keys(secrets)) {
        expect(gateway.config[field]).toBe('');
        expect(gateway.config[`has${field[0].toUpperCase()}${field.slice(1)}`]).toBe(true);
      }
    }

    await httpRequest(app)
      .post('/api/wallet/admin/gateways/activation')
      .send({ id: 'stripe', isEnabled: true })
      .expect(200);
    expect(mockAuthMiddleware).toHaveBeenCalledTimes(4);
    expect(mockAdminMiddleware).toHaveBeenCalledTimes(4);
  });
});
