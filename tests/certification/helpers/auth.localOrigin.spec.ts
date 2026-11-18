import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from './auth';

describe('certification API login origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not infer an API host when CERT_API_BASE is absent', async () => {
    vi.stubEnv('CERT_API_BASE', '');
    vi.stubEnv('VITE_API_URL', '');
    const post = vi.fn();
    const request = { post } as unknown as APIRequestContext;

    await expect(loginViaApi(request, 'synthetic@example.invalid', 'synthetic-only')).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('uses only the explicitly configured API origin', async () => {
    vi.stubEnv('CERT_API_BASE', 'http://127.0.0.1:5192/api');
    const post = vi.fn().mockResolvedValue({ ok: () => false });
    const request = { post } as unknown as APIRequestContext;

    await expect(loginViaApi(request, 'synthetic@example.invalid', 'synthetic-only')).resolves.toBeNull();
    expect(post).toHaveBeenCalledWith(
      'http://127.0.0.1:5192/api/auth/login',
      expect.objectContaining({ failOnStatusCode: false })
    );
  });
});
