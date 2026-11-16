import { describe, expect, it } from 'vitest';
import { resolveOAuthApiBase, resolveOAuthNavigationUrl } from '../oauthApiUrl';

describe('OAuth API target resolution', () => {
  it('permits explicitly configured development origins and the same-origin dev proxy', () => {
    expect(resolveOAuthApiBase('http://127.0.0.1:5000', {
      isNative: false, isDevelopment: true, environment: 'development'
    })).toBe('http://127.0.0.1:5000/api');
    expect(resolveOAuthApiBase('https://api.dev.scrolith.test/api', {
      isNative: false, isDevelopment: true, environment: 'development'
    })).toBe('https://api.dev.scrolith.test/api');
    expect(resolveOAuthApiBase('/api', {
      isNative: false, isDevelopment: true, environment: 'development'
    })).toBe('/api');
  });

  it('rejects production, remote HTTP, malformed, credentialed, and absent native development targets', () => {
    const dev = { isNative: false, isDevelopment: true, environment: 'development' as const };
    expect(resolveOAuthApiBase('https://api.scrolith.com/api', dev)).toBeNull();
    expect(resolveOAuthApiBase('http://api.dev.scrolith.test', dev)).toBeNull();
    expect(resolveOAuthApiBase('https://user:pass@api.dev.test', dev)).toBeNull();
    expect(resolveOAuthApiBase('https://api.dev.test/path?next=x', dev)).toBeNull();
    expect(resolveOAuthApiBase('not a url', dev)).toBeNull();
    expect(resolveOAuthApiBase(undefined, {
      isNative: true, isDevelopment: true, environment: 'development'
    })).toBeNull();
    expect(resolveOAuthApiBase('http://localhost:5000/api', {
      isNative: true, isDevelopment: true, environment: 'development'
    })).toBe('http://localhost:5000/api');
  });

  it('requires the validated revision-specific HTTPS Container Apps host in staging', () => {
    const staging = { isNative: false, isDevelopment: false, environment: 'staging' as const };
    const approved = 'https://ca-scrolith-staging-api---g1-candidate.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io/api';
    expect(resolveOAuthApiBase(approved, staging)).toBe(approved);
    expect(resolveOAuthApiBase('https://api.scrolith.com/api', staging)).toBeNull();
    expect(resolveOAuthApiBase('https://api.staging.scrolith.com/api', staging)).toBeNull();
    expect(resolveOAuthApiBase('https://other-api---rev123.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io/api', staging)).toBeNull();
    expect(resolveOAuthApiBase('http://ca-scrolith-staging-api---g1-candidate.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io', staging)).toBeNull();
    expect(resolveOAuthApiBase(undefined, staging)).toBeNull();
  });

  it('accepts only the explicit production API origin in production', () => {
    const production = { isNative: false, isDevelopment: false, environment: 'production' as const };
    expect(resolveOAuthApiBase('https://api.scrolith.com', production)).toBe('https://api.scrolith.com/api');
    expect(resolveOAuthApiBase('http://localhost:5000', production)).toBeNull();
    expect(resolveOAuthApiBase('https://api.staging.scrolith.com', production)).toBeNull();
    expect(resolveOAuthApiBase(undefined, production)).toBeNull();
    expect(resolveOAuthApiBase('https://attacker.test', production)).toBeNull();
  });

  it('allows inert CI targets but never a production destination', () => {
    const ci = { isNative: false, isDevelopment: false, environment: 'ci' as const };
    expect(resolveOAuthApiBase('https://backend.invalid/api', ci)).toBe('https://backend.invalid/api');
    expect(resolveOAuthApiBase('https://api.scrolith.com/api', ci)).toBeNull();
    expect(resolveOAuthApiBase('https://api.example.com/api', ci)).toBeNull();
  });
});

describe('OAuth navigation validation', () => {
  const local = {
    isNative: false,
    isDevelopment: true,
    environment: 'development' as const,
    currentOrigin: 'http://127.0.0.1:5173',
    apiBase: 'http://127.0.0.1:5000/api'
  };

  it('allows only the configured API OAuth route', () => {
    expect(resolveOAuthNavigationUrl('http://127.0.0.1:5000/api/auth/oauth/google', local))
      .toBe('http://127.0.0.1:5000/api/auth/oauth/google');
    expect(resolveOAuthNavigationUrl('/api/auth/oauth/google', {
      ...local,
      apiBase: '/api'
    })).toBe('http://127.0.0.1:5173/api/auth/oauth/google');
  });

  it('rejects external redirects, unrelated API routes, and wrong-environment HTTP', () => {
    expect(resolveOAuthNavigationUrl('https://attacker.test/api/auth/oauth/google', local)).toBeNull();
    expect(resolveOAuthNavigationUrl('http://127.0.0.1:5000/api/redirect?to=https://attacker.test', local)).toBeNull();
    expect(resolveOAuthNavigationUrl('http://api.scrolith.com/api/auth/oauth/google', local)).toBeNull();
    expect(resolveOAuthNavigationUrl('//attacker.test/api/auth/oauth/google', local)).toBeNull();
  });
});
