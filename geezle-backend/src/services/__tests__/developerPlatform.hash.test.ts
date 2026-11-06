import { afterAll, describe, expect, test } from '@jest/globals';
import { hashSensitiveValue } from '../developerPlatform.service';

const originalPepper = process.env.DEV_PLATFORM_HASH_PEPPER;

afterAll(() => {
  if (originalPepper === undefined) delete process.env.DEV_PLATFORM_HASH_PEPPER;
  else process.env.DEV_PLATFORM_HASH_PEPPER = originalPepper;
});

describe('developer-platform token hashing configuration', () => {
  test('fails closed without a configured pepper', () => {
    delete process.env.DEV_PLATFORM_HASH_PEPPER;
    expect(() => hashSensitiveValue('synthetic-token')).toThrow(/not configured/);
  });

  test('uses the configured pepper deterministically', () => {
    process.env.DEV_PLATFORM_HASH_PEPPER = 'synthetic-test-pepper-with-32-bytes';
    const first = hashSensitiveValue('synthetic-token');
    expect(hashSensitiveValue('synthetic-token')).toBe(first);

    process.env.DEV_PLATFORM_HASH_PEPPER = 'different-synthetic-test-pepper-32';
    expect(hashSensitiveValue('synthetic-token')).not.toBe(first);
  });
});
