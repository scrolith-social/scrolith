jest.mock('../../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    aIFeatureFlag: { findUnique: jest.fn() },
    aIProviderConfiguration: { findUnique: jest.fn() }
  }
}));

import prisma from '../../../utils/prismaClient';
import { loadAIFeatureFlags, loadProviderConfig, persistAdminAIFeatureFlags, persistAdminProviderConfig } from '../config';
import { DEFAULT_AI_FEATURE_FLAGS } from '../types';

const mockPrisma = prisma as unknown as any;
let storedFlags: any = null;
let storedProvider: any = null;
let storedAudits: any[] = [];
let failAuditWrite = false;
let previousLocalOnly: string | undefined;
let previousNativeEnabled: string | undefined;

const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));

describe('Scrolitha admin setting persistence', () => {
  beforeAll(() => {
    previousLocalOnly = process.env.SCROLITHA_AI_LOCAL_ONLY;
    previousNativeEnabled = process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED;
    process.env.SCROLITHA_AI_LOCAL_ONLY = 'true';
    process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousLocalOnly === undefined) delete process.env.SCROLITHA_AI_LOCAL_ONLY;
    else process.env.SCROLITHA_AI_LOCAL_ONLY = previousLocalOnly;
    if (previousNativeEnabled === undefined) delete process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED;
    else process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED = previousNativeEnabled;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    storedFlags = { key: 'scrolitha_ai_feature_flags', value: { ...DEFAULT_AI_FEATURE_FLAGS }, version: 1 };
    storedProvider = null;
    storedAudits = [];
    failAuditWrite = false;
    mockPrisma.aIFeatureFlag.findUnique.mockImplementation(async () => clone(storedFlags));
    mockPrisma.aIProviderConfiguration.findUnique.mockImplementation(async () => clone(storedProvider));
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>, options: any) => {
      const draft = {
        flags: clone(storedFlags),
        provider: clone(storedProvider),
        audits: clone(storedAudits)
      };
      const tx = {
        aIFeatureFlag: {
          findUnique: async () => clone(draft.flags),
          upsert: async ({ create, update }: any) => {
            draft.flags = draft.flags
              ? { ...draft.flags, ...update, value: clone(update.value), version: (draft.flags.version || 1) + 1 }
              : clone(create);
            return clone(draft.flags);
          }
        },
        aIProviderConfiguration: {
          findUnique: async () => clone(draft.provider),
          upsert: async ({ create, update }: any) => {
            draft.provider = draft.provider
              ? { ...draft.provider, ...update, config: clone(update.config) }
              : clone(create);
            return clone(draft.provider);
          }
        },
        aIAuditLog: {
          create: async ({ data }: any) => {
            if (failAuditWrite) throw new Error('synthetic audit failure');
            const row = { id: `audit-${draft.audits.length + 1}`, ...clone(data), createdAt: new Date() };
            draft.audits.push(row);
            return row;
          }
        }
      };
      const result = await callback(tx);
      storedFlags = draft.flags;
      storedProvider = draft.provider;
      storedAudits = draft.audits;
      return result;
    });
  });

  test('commits provider-call flag and durable audit in one serializable transaction', async () => {
    process.env.NODE_ENV = 'test';
    const flags = await persistAdminAIFeatureFlags(
      { masterEnabled: true, assistantEnabled: true, ASSISTANT_CHAT: true, enableProviderCalls: true },
      'admin-1',
      { keys: ['masterEnabled', 'assistantEnabled', 'ASSISTANT_CHAT', 'enableProviderCalls'] }
    );

    expect(flags).toMatchObject({ masterEnabled: true, assistantEnabled: true, ASSISTANT_CHAT: true, enableProviderCalls: true });
    expect(storedFlags.value).toMatchObject({ masterEnabled: true, enableProviderCalls: true, betaAllowlistOnly: true });
    expect(storedAudits).toHaveLength(1);
    expect(storedAudits[0]).toMatchObject({ action: 'admin.feature_flags.updated', actorUserId: 'admin-1' });
    expect(mockPrisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });

  test('rolls back the feature change when its audit write fails and keeps the cache unchanged', async () => {
    failAuditWrite = true;
    await expect(persistAdminAIFeatureFlags({ masterEnabled: true }, 'admin-1', { keys: ['masterEnabled'] }))
      .rejects.toThrow('synthetic audit failure');

    expect(storedFlags.value.masterEnabled).toBe(false);
    expect(storedAudits).toHaveLength(0);
    expect((await loadAIFeatureFlags(true)).masterEnabled).toBe(false);
  });

  test('applies the production kill switch immediately even while feature flags are cached', async () => {
    const keys = ['NODE_ENV', 'SCROLITHA_AI_ALLOW_PROD_PROVIDER', 'SCROLITHA_AI_ENABLE_PROVIDER_CALLS', 'SCROLITHA_AI_KILL_SWITCH'];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.NODE_ENV = 'production';
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
      process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
      delete process.env.SCROLITHA_AI_KILL_SWITCH;
      storedFlags.value = { ...DEFAULT_AI_FEATURE_FLAGS, masterEnabled: true, enableProviderCalls: true };
      expect((await loadAIFeatureFlags(true)).killSwitch).toBe(false);

      process.env.SCROLITHA_AI_KILL_SWITCH = '1';
      const cached = await loadAIFeatureFlags();
      expect(cached.killSwitch).toBe(true);
      expect(cached.enableProviderCalls).toBe(true);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('does not let local-only normalization override a persisted OLLAMA disable', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      localOnly: process.env.SCROLITHA_AI_LOCAL_ONLY,
      allowProduction: process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER,
      providerCalls: process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS,
      ollamaEnabled: process.env.SCROLITHA_AI_OLLAMA_ENABLED
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.SCROLITHA_AI_LOCAL_ONLY = 'true';
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
      process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
      process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
      storedProvider = {
        provider: 'GLOBAL',
        config: { NATIVE: { enabled: false }, OLLAMA: { enabled: false }, emergencyShutdown: false }
      };

      const config = await loadProviderConfig(true);
      expect(config.OLLAMA.enabled).toBe(false);
      expect(config.NATIVE.enabled).toBe(false);
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.localOnly === undefined) delete process.env.SCROLITHA_AI_LOCAL_ONLY;
      else process.env.SCROLITHA_AI_LOCAL_ONLY = previous.localOnly;
      if (previous.allowProduction === undefined) delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
      else process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = previous.allowProduction;
      if (previous.providerCalls === undefined) delete process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS;
      else process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = previous.providerCalls;
      if (previous.ollamaEnabled === undefined) delete process.env.SCROLITHA_AI_OLLAMA_ENABLED;
      else process.env.SCROLITHA_AI_OLLAMA_ENABLED = previous.ollamaEnabled;
    }
  });

  test('persists NATIVE and OLLAMA while forcing external and mock providers off', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    const config = await persistAdminProviderConfig({
      NATIVE: { enabled: true, model: 'scrolitha-native-33.3' },
      OLLAMA: { enabled: true, model: 'qwen3:8b', timeoutMs: 120_000 },
      GEMINI: { enabled: true },
      OPENAI: { enabled: true },
      MOCK: { enabled: true }
    }, 'admin-1', 'NATIVE', { enabled: true });

    expect(config.NATIVE.enabled).toBe(true);
    expect(config.OLLAMA).toMatchObject({ enabled: true, model: 'qwen3:8b' });
    expect(config.GEMINI.enabled).toBe(false);
    expect(config.OPENAI.enabled).toBe(false);
    expect(config.MOCK.enabled).toBe(false);
    expect(storedAudits).toHaveLength(1);
    expect(storedAudits[0]).toMatchObject({ action: 'admin.provider.updated', actorUserId: 'admin-1', provider: 'NATIVE' });
  });

  test('rolls back a provider change when its audit write fails', async () => {
    process.env.NODE_ENV = 'test';
    failAuditWrite = true;
    await expect(persistAdminProviderConfig({ emergencyShutdown: true }, 'admin-1', 'GLOBAL', { emergencyShutdown: true }))
      .rejects.toThrow('synthetic audit failure');

    expect(storedProvider).toBeNull();
    expect(storedAudits).toHaveLength(0);
    expect((await loadProviderConfig(true)).emergencyShutdown).toBe(false);
  });
});
