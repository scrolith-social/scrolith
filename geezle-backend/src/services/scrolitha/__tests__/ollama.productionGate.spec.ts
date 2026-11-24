jest.mock('../../../utils/prismaClient', () => ({ __esModule: true, default: {} }));
jest.mock('../../scrolithaAi/config', () => ({
  isOllamaCallAllowed: jest.fn((flags: any, config: any) =>
    Boolean(flags?.enableProviderCalls && config?.OLLAMA?.enabled && !config?.emergencyShutdown)
  ),
  loadAIFeatureFlags: jest.fn(),
  loadProviderConfig: jest.fn()
}));
jest.mock('../../scrolithaAi/usage', () => ({
  checkQuota: jest.fn(),
  estimateCostUsd: jest.fn(),
  getMaxAiRequestRuntimeMs: jest.fn(),
  recordUsage: jest.fn()
}));

import {
  isOllamaCallAllowed,
  loadAIFeatureFlags,
  loadProviderConfig
} from '../../scrolithaAi/config';
import { checkQuota } from '../../scrolithaAi/usage';
import { isProductionOllamaCallAllowed, ollamaChat } from '../scrolitha.ollama';

const mockIsOllamaCallAllowed = isOllamaCallAllowed as jest.Mock;
const mockLoadFlags = loadAIFeatureFlags as jest.Mock;
const mockLoadProvider = loadProviderConfig as jest.Mock;
const mockCheckQuota = checkQuota as jest.Mock;

describe('production Scrolitha Core provider gate', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowProduction = process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
  const previousProviderCalls = process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS;
  const previousOllamaEnabled = process.env.SCROLITHA_AI_OLLAMA_ENABLED;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
    process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
    mockLoadFlags.mockResolvedValue({
      killSwitch: false,
      masterEnabled: true,
      assistantEnabled: true,
      ASSISTANT_CHAT: true,
      enableProviderCalls: true
    });
    mockLoadProvider.mockResolvedValue({ OLLAMA: { enabled: true }, emergencyShutdown: false });
    mockCheckQuota.mockResolvedValue({ allowed: true });
    jest.clearAllMocks();
    mockIsOllamaCallAllowed.mockImplementation((flags: any, config: any) =>
      Boolean(flags?.enableProviderCalls && config?.OLLAMA?.enabled && !config?.emergencyShutdown)
    );
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowProduction === undefined) delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
    else process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = previousAllowProduction;
    if (previousProviderCalls === undefined) delete process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS;
    else process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = previousProviderCalls;
    if (previousOllamaEnabled === undefined) delete process.env.SCROLITHA_AI_OLLAMA_ENABLED;
    else process.env.SCROLITHA_AI_OLLAMA_ENABLED = previousOllamaEnabled;
  });

  test.each([
    ['master feature gate', { killSwitch: false, masterEnabled: false, enableProviderCalls: true }],
    ['assistant feature gate', { killSwitch: false, masterEnabled: true, assistantEnabled: false, ASSISTANT_CHAT: true, enableProviderCalls: true }],
    ['assistant chat capability gate', { killSwitch: false, masterEnabled: true, assistantEnabled: true, ASSISTANT_CHAT: false, enableProviderCalls: true }],
    ['provider-call gate', { killSwitch: false, masterEnabled: true, enableProviderCalls: false }],
    ['kill switch', { killSwitch: true, masterEnabled: true, enableProviderCalls: true }]
  ])('blocks direct Core work when the persisted %s is closed before quota reservation', async (_label, flags) => {
    mockLoadFlags.mockResolvedValue(flags);

    await expect(ollamaChat({
      host: 'http://127.0.0.1:1',
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'synthetic request' }],
      userId: 'synthetic-user'
    })).rejects.toThrow('SCROLITHA_PROVIDER_DISABLED_BY_POLICY');

    expect(mockCheckQuota).not.toHaveBeenCalled();
  });

  test('blocks direct Core work when the persisted OLLAMA provider gate is closed', async () => {
    mockIsOllamaCallAllowed.mockReturnValue(false);

    await expect(ollamaChat({
      host: 'http://127.0.0.1:1',
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'synthetic request' }],
      userId: 'synthetic-user'
    })).rejects.toThrow('SCROLITHA_PROVIDER_DISABLED_BY_POLICY');

    expect(mockCheckQuota).not.toHaveBeenCalled();
  });

  test('blocks production Core work when the deployment hard gate is absent', async () => {
    delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;

    await expect(isProductionOllamaCallAllowed()).resolves.toBe(false);
    await expect(ollamaChat({
      host: 'http://127.0.0.1:1',
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'synthetic request' }],
      userId: 'synthetic-user'
    })).rejects.toThrow('SCROLITHA_PROVIDER_DISABLED_BY_POLICY');
    expect(mockCheckQuota).not.toHaveBeenCalled();
  });

  test('blocks production Core work during provider emergency shutdown', async () => {
    mockLoadProvider.mockResolvedValue({ OLLAMA: { enabled: true }, emergencyShutdown: true });

    await expect(isProductionOllamaCallAllowed()).resolves.toBe(false);
    await expect(ollamaChat({
      host: 'http://127.0.0.1:1',
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'synthetic request' }],
      userId: 'synthetic-user'
    })).rejects.toThrow('SCROLITHA_PROVIDER_DISABLED_BY_POLICY');
    expect(mockCheckQuota).not.toHaveBeenCalled();
  });

  test('allows Core only when feature, provider-call, and provider gates are all open', async () => {
    await expect(isProductionOllamaCallAllowed()).resolves.toBe(true);
  });
});
