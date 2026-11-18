import { describe, expect, it } from 'vitest';
import { resolveApiBaseForEnvironment, resolveNativeApiBase } from '../apiBasePolicy';

describe('API environment boundary policy', () => {
  it('keeps web development on the local proxy or an explicitly configured local API', () => {
    expect(resolveApiBaseForEnvironment(undefined, 'development')).toBe('/api');
    expect(resolveApiBaseForEnvironment('/api', 'development')).toBe('/api');
    expect(resolveApiBaseForEnvironment('http://127.0.0.1:5000', 'development'))
      .toBe('http://127.0.0.1:5000/api');
    expect(resolveApiBaseForEnvironment('http://10.0.2.2:5000/api', 'development', true))
      .toBe('http://10.0.2.2:5000/api');
    expect(resolveApiBaseForEnvironment('http://192.168.1.20:5000', 'development'))
      .toBe('http://192.168.1.20:5000/api');
  });

  it('prevents development from silently targeting production or remote plaintext HTTP', () => {
    expect(resolveApiBaseForEnvironment('https://api.scrolith.com/api', 'development')).toBeNull();
    expect(resolveApiBaseForEnvironment('http://api.dev.example/api', 'development')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://user:secret@api.dev.example/api', 'development')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.dev.example/api?redirect=x', 'development')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.dev.example/v1', 'development')).toBeNull();
  });

  it('requires the revision-specific HTTPS Azure Container Apps target in staging', () => {
    const approved = 'https://ca-scrolith-staging-api---g1-candidate.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io';
    expect(resolveApiBaseForEnvironment(approved, 'staging')).toBe(`${approved}/api`);
    expect(resolveApiBaseForEnvironment('https://api.scrolith.com/api', 'staging')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.staging.scrolith.com/api', 'staging')).toBeNull();
    expect(resolveApiBaseForEnvironment('http://ca-scrolith-staging-api---g1-candidate.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io', 'staging')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://other-api---g1-candidate.yellowmushroom-b8714740.southeastasia.azurecontainerapps.io', 'staging')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://ca-scrolith-staging-api---g1-candidate.otherenv.southeastasia.azurecontainerapps.io', 'staging')).toBeNull();
    expect(resolveApiBaseForEnvironment(undefined, 'staging')).toBeNull();
  });

  it('requires the exact HTTPS production API origin', () => {
    expect(resolveApiBaseForEnvironment('https://api.scrolith.com', 'production'))
      .toBe('https://api.scrolith.com/api');
    expect(resolveApiBaseForEnvironment('http://localhost:5000', 'production')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.staging.scrolith.com', 'production')).toBeNull();
    expect(resolveApiBaseForEnvironment(undefined, 'production')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.scrolith.com:444/api', 'production')).toBeNull();
  });

  it('restricts CI builds to inert .invalid targets or loopback test servers', () => {
    expect(resolveApiBaseForEnvironment('https://backend.invalid', 'ci')).toBe('https://backend.invalid/api');
    expect(resolveApiBaseForEnvironment('http://127.0.0.1:5000/api', 'ci')).toBe('http://127.0.0.1:5000/api');
    expect(resolveApiBaseForEnvironment('https://api.scrolith.com/api', 'ci')).toBeNull();
    expect(resolveApiBaseForEnvironment('https://api.example.com/api', 'ci')).toBeNull();
  });

  it('does not provide a production fallback for native verification requests', () => {
    expect(resolveNativeApiBase('', 'production')).toBeNull();
    expect(resolveNativeApiBase('https://api.scrolith.com/api', 'production'))
      .toBe('https://api.scrolith.com/api');
    expect(resolveNativeApiBase('/api', 'development')).toBeNull();
    expect(resolveNativeApiBase('http://localhost:5000/api', 'development'))
      .toBe('http://localhost:5000/api');
  });
});
