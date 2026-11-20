import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCanonicalApiUploadUrl, resolveAssetUrl, resolveResponsiveAssetUrl } from '../assetUrl';

describe('asset URL environment isolation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SCROLITH_ENV', 'ci');
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_BACKEND_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resolves stored IDs relative to the current application instead of production', () => {
    expect(resolveAssetUrl('file_123456789012')).toBe('/api/files/content/file_123456789012');
    expect(resolveAssetUrl('https://api.scrolith.com/api/files/content/asset-123'))
      .toBe('/api/files/content/asset-123');
    expect(resolveAssetUrl('https://scrolith.com/uploads/public.png'))
      .toBe('/uploads/public.png');
  });

  it('does not rewrite unrelated or signed external storage URLs', () => {
    const signed = 'https://storage.example.test/file.png?X-Amz-Signature=synthetic';
    expect(resolveAssetUrl(signed)).toBe(signed);
    expect(resolveAssetUrl('https://cdn.example.test/image.png')).toBe('https://cdn.example.test/image.png');
  });

  it('keeps server-rendered relative media URLs relative without a loopback origin', () => {
    vi.stubGlobal('window', undefined);
    const contentPath = '/api/files/content/file_123456789012';

    expect(resolveResponsiveAssetUrl(contentPath, { width: 64 }))
      .toBe(contentPath);
  });

  it('recognizes canonical API uploads without hardcoding an endpoint URL in callers', () => {
    expect(isCanonicalApiUploadUrl('/uploads/public.png')).toBe(true);
    expect(isCanonicalApiUploadUrl('uploads/public.png')).toBe(true);
    expect(isCanonicalApiUploadUrl('https://api.scrolith.com/uploads/public.png')).toBe(true);
    expect(isCanonicalApiUploadUrl('https://api.scrolith.com/api/files/content/file-1')).toBe(false);
    expect(isCanonicalApiUploadUrl('https://storage.example.test/uploads/public.png')).toBe(false);
  });
});
