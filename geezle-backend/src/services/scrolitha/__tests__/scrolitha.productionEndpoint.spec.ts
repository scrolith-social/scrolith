jest.mock('../scrolitha.policy', () => ({
  ensureScrolithaConfig: jest.fn()
}));

jest.mock('../../../utils/prismaClient', () => ({
  __esModule: true,
  default: { appSetting: { findUnique: jest.fn() } }
}));

import { ensureScrolithaConfig } from '../scrolitha.policy';
import { resolveScrolithaLlmRuntime } from '../scrolitha.ollama';

describe('Scrolitha production Core endpoint precedence', () => {
  const previousEnv = new Map<string, string | undefined>();
  const setEnv = (key: string, value: string) => {
    if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  };

  afterEach(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
    jest.clearAllMocks();
  });

  test('a remote ACA Core endpoint overrides stale persisted localhost and sidecar settings', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SCROLITHA_AI_LOCAL_ONLY', 'true');
    setEnv('SCROLITHA_CORE_ENDPOINT', 'https://scrolitha-core.internal.env123.southeastasia.azurecontainerapps.io');
    setEnv('SCROLITHA_CORE_MODEL', 'qwen3:8b');
    setEnv('SCROLITHA_CORE_SIDECAR_MODE', 'false');
    (ensureScrolithaConfig as jest.Mock).mockResolvedValue({
      metadata: {
        llm: {
          enabled: true,
          provider: 'core',
          host: 'http://127.0.0.1:11434',
          coreEndpoint: 'http://127.0.0.1:11434',
          model: 'qwen3:14b',
          sidecarMode: true
        }
      }
    });

    const runtime = await resolveScrolithaLlmRuntime('user');

    expect(runtime.host).toBe('https://scrolitha-core.internal.env123.southeastasia.azurecontainerapps.io');
    expect(runtime.model).toBe('qwen3:8b');
    expect(runtime.sidecarMode).toBe(false);
    expect(runtime.runtimeConfigured).toBe(true);
    expect(runtime.status).toBe('operational');
  });

  test('production local-Core deadline cannot be reduced by stale persisted admin settings', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('SCROLITHA_AI_LOCAL_ONLY', 'true');
    setEnv('SCROLITHA_CORE_ENDPOINT', 'https://scrolitha-core.internal.env123.southeastasia.azurecontainerapps.io');
    setEnv('SCROLITHA_CORE_MODEL', 'qwen3:8b');
    setEnv('SCROLITHA_CORE_SIDECAR_MODE', 'false');
    setEnv('SCROLITHA_TIMEOUT_MS', '180000');
    (ensureScrolithaConfig as jest.Mock).mockResolvedValue({
      metadata: {
        llm: {
          enabled: true,
          provider: 'core',
          host: 'https://scrolitha-core.internal',
          model: 'qwen3:8b',
          sidecarMode: false,
          timeoutMs: 45_000
        }
      }
    });

    const runtime = await resolveScrolithaLlmRuntime('user');

    expect(runtime.timeoutMs).toBe(180_000);
  });
});
