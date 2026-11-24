const mockPersistAdminProviderConfig = jest.fn();
const mockPersistAdminAIFeatureFlags = jest.fn();
const mockIsLocalOnly = jest.fn();

jest.mock('../../services/scrolithaAi', () => ({
  loadAIFeatureFlags: jest.fn(),
  persistAdminAIFeatureFlags: (...args: any[]) => mockPersistAdminAIFeatureFlags(...args),
  loadProviderConfig: jest.fn(),
  persistAdminProviderConfig: (...args: any[]) => mockPersistAdminProviderConfig(...args),
  healthAllProviders: jest.fn().mockResolvedValue([]),
  getAIMetricsSnapshot: jest.fn(),
  getCircuitSnapshot: jest.fn(),
  AIPromptRegistry: { list: jest.fn(), upsertMemory: jest.fn() },
  FOUNDATION_CAPABILITIES: []
}));

jest.mock('../../services/scrolithaAi/config', () => ({
  isScrolithaLocalOnly: (...args: any[]) => mockIsLocalOnly(...args),
  SCROLITHA_LOCAL_MODEL: 'qwen3:8b'
}));

jest.mock('../../services/scrolithaAi/audit', () => ({
  listAIAudit: jest.fn().mockResolvedValue([]),
  writeAIAudit: jest.fn()
}));

jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: { aIModelConfiguration: { findMany: jest.fn(), upsert: jest.fn() } }
}));

import { adminAIFeatureFlags, adminAIPutProvider } from '../scrolithaAi.admin.controller';

const response = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Scrolitha AI activation admin routes', () => {
  const env = {
    nodeEnv: process.env.NODE_ENV,
    allowProduction: process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLocalOnly.mockReturnValue(true);
    mockPersistAdminProviderConfig.mockResolvedValue({ NATIVE: { enabled: true } });
    mockPersistAdminAIFeatureFlags.mockResolvedValue({ masterEnabled: true, enableProviderCalls: true });
  });

  afterAll(() => {
    if (env.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env.nodeEnv;
    if (env.allowProduction === undefined) delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
    else process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = env.allowProduction;
  });

  test('allows NATIVE to be enabled through the local-only admin provider route', async () => {
    const req: any = { params: { provider: 'NATIVE' }, body: { enabled: true }, user: { id: 'admin-7' } };
    const res = response();

    await adminAIPutProvider(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { NATIVE: { enabled: true } } });
    expect(mockPersistAdminProviderConfig).toHaveBeenCalledWith(
      { NATIVE: { enabled: true } }, 'admin-7', 'NATIVE', { enabled: true, emergencyShutdown: undefined }
    );
  });

  test('rejects string booleans instead of treating non-empty strings as enabled', async () => {
    const req: any = { params: { provider: 'NATIVE' }, body: { enabled: 'false' }, user: { id: 'admin-7' } };
    const res = response();

    await adminAIPutProvider(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPersistAdminProviderConfig).not.toHaveBeenCalled();
  });

  test('requires explicit risk confirmation before enabling provider calls', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    const req: any = { method: 'PUT', body: { enableProviderCalls: true }, headers: {}, user: { id: 'admin-7' }, params: {} };
    const res = response();

    await adminAIFeatureFlags(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPersistAdminAIFeatureFlags).not.toHaveBeenCalled();
  });

  test('uses the durable admin mutation only after risk confirmation', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    const req: any = {
      method: 'PUT',
      body: { masterEnabled: true, assistantEnabled: true, ASSISTANT_CHAT: true, enableProviderCalls: true },
      headers: { 'x-confirm-ai-risk': 'CONFIRM' },
      user: { id: 'admin-7' },
      params: {}
    };
    const res = response();

    await adminAIFeatureFlags(req, res);

    expect(mockPersistAdminAIFeatureFlags).toHaveBeenCalledWith(
      { masterEnabled: true, assistantEnabled: true, ASSISTANT_CHAT: true, enableProviderCalls: true },
      'admin-7',
      { keys: ['masterEnabled', 'assistantEnabled', 'ASSISTANT_CHAT', 'enableProviderCalls'] }
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { masterEnabled: true, enableProviderCalls: true } });
  });
});
