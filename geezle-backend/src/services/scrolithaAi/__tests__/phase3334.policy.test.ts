jest.mock('../../../utils/prismaClient', () => ({ __esModule: true, default: {} }));

import { routeModel } from '../router';
import { isNativeExecutionAllowed, isOllamaCallAllowed, isProviderEnabled } from '../config';
import { boundProviderTimeoutMs, getMaxAiRequestRuntimeMs } from '../usage';

describe('Phase 33.4 production provider policy', () => {
  it('uses a finite request-runtime cap and clamps provider attempts to the remaining deadline', () => {
    const keys = [
      'SCROLITHA_AI_DAILY_REQUESTS',
      'SCROLITHA_AI_MONTHLY_TOKENS',
      'SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS',
      'SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS',
      'SCROLITHA_AI_MONTHLY_BUDGET_USD',
      'SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD',
      'SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS',
      'SCROLITHA_AI_CONCURRENCY',
      'SCROLITHA_AI_RATE_PER_MINUTE'
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      expect(getMaxAiRequestRuntimeMs()).toBe(60_000);
      expect(boundProviderTimeoutMs(120_000, 18_500)).toBe(18_500);
      expect(boundProviderTimeoutMs(240_000, 300_000)).toBe(180_000);
      process.env.SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS = '180000';
      expect(getMaxAiRequestRuntimeMs()).toBe(180_000);
      process.env.SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS = 'not-an-integer';
      expect(getMaxAiRequestRuntimeMs()).toBeNull();
      process.env.SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS = '1000';
      process.env.SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS = '180001';
      expect(getMaxAiRequestRuntimeMs()).toBeNull();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('routes user-facing generation to Ollama with no fallback chain', () => {
    const route = routeModel({
      capability: 'COPILOT_CONTEXT',
      privacyLevel: 'PERSONAL',
      externalConsent: true,
      requireOllama: true
    });

    expect(route.provider).toBe('OLLAMA');
    expect(route.model).toBe('qwen3:8b');
    expect(route.fallbackChain).toEqual([]);
  });

  it('keeps the production route deadline bounded at the configured 180-second cold-Core limit', () => {
    const route = routeModel({
      capability: 'TEXT_REWRITING',
      privacyLevel: 'PERSONAL',
      externalConsent: false,
      requireOllama: true,
      timeoutMs: 180_000,
      providerHealth: { NATIVE: 'operational', OLLAMA: 'operational', GEMINI: 'disabled', OPENAI: 'disabled', MOCK: 'disabled' }
    });

    expect(route).toMatchObject({ provider: 'OLLAMA', timeoutMs: 180_000, fallbackChain: [] });
  });

  it('rejects native, external, and mock providers in production', () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      allowProduction: process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER,
      providerCalls: process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS,
      ollamaEnabled: process.env.SCROLITHA_AI_OLLAMA_ENABLED
    };
    process.env.NODE_ENV = 'production';
    process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
    process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
    process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
    const config = {
      NATIVE: { enabled: true },
      OLLAMA: { enabled: true },
      GEMINI: { enabled: true },
      OPENAI: { enabled: true },
      MOCK: { enabled: true },
      emergencyShutdown: false
    } as any;

    expect(isProviderEnabled('OLLAMA', config)).toBe(true);
    expect(isProviderEnabled('NATIVE', config)).toBe(false);
    expect(isProviderEnabled('GEMINI', config)).toBe(false);
    expect(isProviderEnabled('OPENAI', config)).toBe(false);
    expect(isProviderEnabled('MOCK', config)).toBe(false);

    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.allowProduction === undefined) delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
    else process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = previous.allowProduction;
    if (previous.providerCalls === undefined) delete process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS;
    else process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = previous.providerCalls;
    if (previous.ollamaEnabled === undefined) delete process.env.SCROLITHA_AI_OLLAMA_ENABLED;
    else process.env.SCROLITHA_AI_OLLAMA_ENABLED = previous.ollamaEnabled;
  });

  it('enforces the local Scrolitha runtime policy without mock fallback', () => {
    const previous = process.env.SCROLITHA_AI_LOCAL_ONLY;
    process.env.SCROLITHA_AI_LOCAL_ONLY = 'true';
    const config = {
      NATIVE: { enabled: true },
      OLLAMA: { enabled: true },
      GEMINI: { enabled: true },
      OPENAI: { enabled: true },
      MOCK: { enabled: true },
      emergencyShutdown: false
    } as any;

    expect(isProviderEnabled('OLLAMA', config)).toBe(true);
    expect(isProviderEnabled('NATIVE', config)).toBe(false);
    expect(isProviderEnabled('GEMINI', config)).toBe(false);
    expect(isProviderEnabled('OPENAI', config)).toBe(false);
    expect(isProviderEnabled('MOCK', config)).toBe(false);
    expect(routeModel({
      capability: 'TEXT_REWRITING',
      privacyLevel: 'PERSONAL',
      externalConsent: true,
      requireOllama: true
    })).toMatchObject({ provider: 'OLLAMA', model: 'qwen3:8b', fallbackChain: [] });

    if (previous === undefined) delete process.env.SCROLITHA_AI_LOCAL_ONLY;
    else process.env.SCROLITHA_AI_LOCAL_ONLY = previous;
  });

  it('requires provider-call and production environment gates for local Ollama', () => {
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
      const flags = { enableProviderCalls: true } as any;
      const provider = { OLLAMA: { enabled: true }, emergencyShutdown: false } as any;
      expect(isOllamaCallAllowed(flags, provider)).toBe(true);

      process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'false';
      expect(isOllamaCallAllowed(flags, provider)).toBe(false);
      process.env.SCROLITHA_AI_ENABLE_ALL_CAPABILITIES = 'true';
      expect(isOllamaCallAllowed({ enableProviderCalls: false } as any, provider)).toBe(false);
      process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
      delete process.env.SCROLITHA_AI_ENABLE_ALL_CAPABILITIES;
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '0';
      expect(isOllamaCallAllowed(flags, provider)).toBe(false);
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
      expect(isOllamaCallAllowed({ enableProviderCalls: false } as any, provider)).toBe(false);
      expect(isOllamaCallAllowed(flags, { ...provider, emergencyShutdown: true })).toBe(false);
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

  it('uses NATIVE only for explicitly enabled deterministic production work', () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      localOnly: process.env.SCROLITHA_AI_LOCAL_ONLY,
      nativeEnabled: process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED,
      allowProduction: process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER,
      providerCalls: process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS,
      ollamaEnabled: process.env.SCROLITHA_AI_OLLAMA_ENABLED
    };

    try {
      process.env.NODE_ENV = 'production';
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
      process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
      process.env.SCROLITHA_AI_LOCAL_ONLY = 'true';
      process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED = 'true';
      process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = '1';
      process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = 'true';
      process.env.SCROLITHA_AI_OLLAMA_ENABLED = 'true';
      const config = {
        NATIVE: { enabled: true },
        OLLAMA: { enabled: true },
        GEMINI: { enabled: true },
        OPENAI: { enabled: true },
        MOCK: { enabled: true },
        emergencyShutdown: false
      } as any;

      expect(isNativeExecutionAllowed(config, true)).toBe(true);
      expect(isNativeExecutionAllowed(config, false)).toBe(false);
      expect(routeModel({
        capability: 'INTENT_DETECTION',
        privacyLevel: 'PERSONAL',
        externalConsent: true,
        preferNative: true,
        localFirst: true,
        providerHealth: { NATIVE: 'operational', OLLAMA: 'operational', GEMINI: 'disabled', OPENAI: 'disabled', MOCK: 'disabled' }
      })).toMatchObject({ provider: 'NATIVE', fallbackChain: [{ provider: 'OLLAMA', model: 'qwen3:8b' }] });

      process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED = 'false';
      expect(isNativeExecutionAllowed(config, true)).toBe(false);
      expect(routeModel({
        capability: 'INTENT_DETECTION',
        privacyLevel: 'PERSONAL',
        externalConsent: true,
        preferNative: true,
        localFirst: true,
        providerHealth: { NATIVE: 'disabled', OLLAMA: 'operational', GEMINI: 'disabled', OPENAI: 'disabled', MOCK: 'disabled' }
      })).toMatchObject({ provider: 'OLLAMA', fallbackChain: [] });

      expect(routeModel({
        capability: 'TEXT_REWRITING',
        privacyLevel: 'PERSONAL',
        externalConsent: true,
        requireOllama: true,
        providerHealth: { NATIVE: 'operational', OLLAMA: 'operational', GEMINI: 'operational', OPENAI: 'operational', MOCK: 'operational' }
      })).toMatchObject({ provider: 'OLLAMA', fallbackChain: [] });
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.localOnly === undefined) delete process.env.SCROLITHA_AI_LOCAL_ONLY;
      else process.env.SCROLITHA_AI_LOCAL_ONLY = previous.localOnly;
      if (previous.nativeEnabled === undefined) delete process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED;
      else process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED = previous.nativeEnabled;
      if (previous.allowProduction === undefined) delete process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER;
      else process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER = previous.allowProduction;
      if (previous.providerCalls === undefined) delete process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS;
      else process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS = previous.providerCalls;
      if (previous.ollamaEnabled === undefined) delete process.env.SCROLITHA_AI_OLLAMA_ENABLED;
      else process.env.SCROLITHA_AI_OLLAMA_ENABLED = previous.ollamaEnabled;
    }
  });
});
