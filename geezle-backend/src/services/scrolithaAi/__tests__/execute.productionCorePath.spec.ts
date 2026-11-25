jest.mock('../config', () => ({
  loadAIFeatureFlags: jest.fn(),
  loadProviderConfig: jest.fn(),
  isNativeExecutionAllowed: jest.fn(() => false),
  isOllamaCallAllowed: jest.fn((flags: any, config: any) =>
    Boolean(
      flags?.enableProviderCalls &&
      config?.OLLAMA?.enabled &&
      !config?.emergencyShutdown &&
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER === '1' &&
      ['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase()) &&
      ['1', 'true'].includes(String(process.env.SCROLITHA_AI_OLLAMA_ENABLED || '').toLowerCase())
    )
  ),
  isProviderEnabled: jest.fn((provider: string, config: any) => Boolean(config?.[provider]?.enabled)),
  isScrolithaLocalOnly: jest.fn(() => process.env.SCROLITHA_AI_LOCAL_ONLY === 'true'),
  SCROLITHA_LOCAL_MODEL: 'qwen3:8b'
}));
jest.mock('../consent', () => ({
  assertConsentForRequest: jest.fn()
}));
jest.mock('../privacy', () => ({
  classifyPrivacy: jest.fn(() => 'PERSONAL'),
  flattenInput: jest.fn((input: unknown) => String(input || '')),
  minimizeContext: jest.fn(() => ({})),
  redactText: jest.fn((input: string) => ({ text: input, redactions: [] })),
  externalProviderAllowedForPrivacy: jest.fn(() => false)
}));
jest.mock('../safety', () => ({
  evaluateSafetyPre: jest.fn(() => ({ allowed: true, action: 'ALLOW', reasons: [], policyVersion: 'test' })),
  evaluateSafetyPost: jest.fn(() => ({ allowed: true, action: 'ALLOW', reasons: [], policyVersion: 'test' })),
  wrapUntrustedContent: jest.fn((input: string) => input)
}));
jest.mock('../promptRegistry', () => ({
  __esModule: true,
  default: {
    getPublished: jest.fn(() => ({
      promptKey: 'test.rewrite', version: 1, maxContextChars: 1000,
      systemInstructions: 'Use the supplied text only.', inputTemplate: '{{content}}'
    })),
    render: jest.fn(() => ({ system: 'safe system prompt', user: 'safe user prompt' }))
  }
}));
jest.mock('../providers', () => ({
  getProvider: jest.fn()
}));
jest.mock('../cache', () => ({
  canCache: jest.fn(() => false),
  buildCacheKey: jest.fn(() => 'synthetic-cache-key'),
  hashInput: jest.fn(() => 'synthetic-input-hash'),
  cacheGet: jest.fn(() => undefined),
  cacheSet: jest.fn()
}));
jest.mock('../usage', () => ({
  checkQuota: jest.fn(),
  beginRequest: jest.fn(),
  endRequest: jest.fn(),
  recordUsage: jest.fn(),
  estimateCostUsd: jest.fn(() => 0),
  getMaxAiRequestRuntimeMs: jest.fn(() => 180_000),
  boundProviderTimeoutMs: jest.fn((_configured: number, remaining: number) => remaining)
}));
jest.mock('../observability', () => ({ inc: jest.fn(), logAIEvent: jest.fn() }));
jest.mock('../reliability', () => ({
  isCircuitOpen: jest.fn(() => false),
  recordProviderSuccess: jest.fn(),
  recordProviderFailure: jest.fn(),
  withTimeout: jest.fn((promise: Promise<unknown>) => promise)
}));
jest.mock('../audit', () => ({
  writeAIAudit: jest.fn(),
  hashContent: jest.fn(() => 'synthetic-content-hash'),
  persistRequestRecord: jest.fn()
}));

import { ScrolithaAI } from '../execute';
import { loadAIFeatureFlags, loadProviderConfig } from '../config';
import { assertConsentForRequest } from '../consent';
import { getProvider } from '../providers';
import { checkQuota, recordUsage } from '../usage';
import { writeAIAudit } from '../audit';

describe('canonical Scrolitha AI production Core request path', () => {
  const envKeys = [
    'NODE_ENV',
    'SCROLITHA_AI_LOCAL_ONLY',
    'SCROLITHA_AI_FORCE_NO_EXTERNAL_PROVIDER',
    'SCROLITHA_AI_ALLOW_PROD_PROVIDER',
    'SCROLITHA_AI_ENABLE_PROVIDER_CALLS',
    'SCROLITHA_AI_OLLAMA_ENABLED'
  ];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const mockLoadFlags = loadAIFeatureFlags as jest.Mock;
  const mockLoadProvider = loadProviderConfig as jest.Mock;
  const mockConsent = assertConsentForRequest as jest.Mock;
  const mockGetProvider = getProvider as jest.Mock;
  const mockCheckQuota = checkQuota as jest.Mock;
  const mockRecordUsage = recordUsage as jest.Mock;
  const mockAudit = writeAIAudit as jest.Mock;
  const generateText = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_LOCAL_ONLY = 'true';
    process.env.SCROLITHA_AI_FORCE_NO_EXTERNAL_PROVIDER = '0';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
    process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
    mockLoadFlags.mockResolvedValue({
      killSwitch: false, masterEnabled: true, assistantEnabled: true,
      ASSISTANT_CHAT: true, TEXT_REWRITING: true, enableProviderCalls: true
    });
    mockLoadProvider.mockResolvedValue({
      OLLAMA: { enabled: true, model: 'qwen3:8b' },
      NATIVE: { enabled: false }, GEMINI: { enabled: false },
      OPENAI: { enabled: false }, MOCK: { enabled: false }, emergencyShutdown: false
    });
    mockConsent.mockResolvedValue({
      allowed: true,
      consent: {
        aiFeaturesEnabled: true, privateMessageAnalysisAllowed: false,
        personalizationAllowed: false, externalProviderProcessingAllowed: false,
        aiSuggestionsAllowed: true, aiActivityHistoryEnabled: false,
        productImprovementDataAllowed: false, consentVersion: 'test'
      }
    });
    mockCheckQuota.mockResolvedValue({ allowed: true, requestId: 'synthetic-request' });
    mockRecordUsage.mockResolvedValue({ withinLimits: true });
    generateText.mockResolvedValue({
      text: 'A short synthetic answer.', provider: 'OLLAMA', model: 'qwen3:8b',
      usage: { promptTokens: 18, completionTokens: 6, totalTokens: 24 }, latencyMs: 400
    });
    mockGetProvider.mockImplementation((provider: string) =>
      provider === 'OLLAMA' ? { id: 'OLLAMA', generateText } : undefined
    );
  });

  afterAll(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const request = () => ScrolithaAI.execute({
    capability: 'TEXT_REWRITING',
    userId: 'synthetic-pilot-user',
    input: 'Rewrite this synthetic sentence.',
    policy: { requireOllama: true, timeoutMs: 180_000, maxTokens: 64 }
  });

  test('with production gates off, audits a block before quota or provider execution and never falls back', async () => {
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '0';
    process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'false';
    process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'false';

    const result = await request();

    expect(result).toMatchObject({ ok: false, blocked: true, reason: 'PROVIDER_CALLS_DISABLED_BY_POLICY' });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'request.blocked', provider: 'OLLAMA', lifecycle: 'BLOCKED',
      reason: 'PROVIDER_CALLS_DISABLED_BY_POLICY'
    }));
    expect(mockCheckQuota).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  test('when authorized, reserves quota, calls only Ollama, settles measured usage, and audits completion', async () => {
    const result = await request();

    expect(result).toMatchObject({
      ok: true,
      route: { provider: 'OLLAMA', model: 'qwen3:8b', fallbackChain: [] },
      usage: { promptTokens: 18, completionTokens: 6, totalTokens: 24 }
    });
    expect(mockCheckQuota).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(mockGetProvider).toHaveBeenCalledTimes(1);
    expect(mockGetProvider).toHaveBeenCalledWith('OLLAMA');
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'OLLAMA', model: 'qwen3:8b', promptTokens: 18,
      completionTokens: 6, totalTokens: 24, status: 'COMPLETED'
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'request.completed', provider: 'OLLAMA', model: 'qwen3:8b', lifecycle: 'COMPLETED'
    }));
  });

  test('Core failure settles failed usage and never invokes NATIVE, external, or mock fallback', async () => {
    generateText.mockRejectedValueOnce(new Error('synthetic Core unavailable'));

    const result = await request();

    expect(result).toMatchObject({ ok: false, lifecycle: 'FAILED' });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(mockGetProvider).toHaveBeenCalledTimes(1);
    expect(mockGetProvider).toHaveBeenCalledWith('OLLAMA');
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'OLLAMA', status: 'FAILED'
    }));
  });

  test('force-no-external keeps a user-preferred NATIVE fallback out of nondeterministic generation', async () => {
    process.env.SCROLITHA_AI_LOCAL_ONLY = 'false';
    process.env.SCROLITHA_AI_FORCE_NO_EXTERNAL_PROVIDER = '1';
    mockLoadProvider.mockResolvedValueOnce({
      OLLAMA: { enabled: true, model: 'qwen3:8b' },
      NATIVE: { enabled: true }, GEMINI: { enabled: true },
      OPENAI: { enabled: true }, MOCK: { enabled: true }, emergencyShutdown: false
    });
    generateText.mockRejectedValueOnce(new Error('synthetic Core unavailable'));

    const result = await ScrolithaAI.execute({
      capability: 'TEXT_REWRITING',
      userId: 'synthetic-pilot-user',
      input: 'Rewrite this synthetic sentence.',
      policy: { preferNative: true, timeoutMs: 180_000, maxTokens: 64 }
    });

    expect(result).toMatchObject({ ok: false, lifecycle: 'FAILED' });
    expect(mockGetProvider.mock.calls.map(([provider]) => provider)).toEqual(['OLLAMA']);
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'OLLAMA', status: 'FAILED'
    }));
  });
});
