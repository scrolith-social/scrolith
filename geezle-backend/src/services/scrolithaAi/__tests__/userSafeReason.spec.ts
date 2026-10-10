import { toUserSafeAIReason, toUserSafeAIResult } from '../userSafeReason';

describe('Scrolitha user-safe error reasons', () => {
  test('hides provider and circuit details', () => {
    expect(toUserSafeAIReason('PROVIDER_TIMEOUT')).toBe('SCROLITHA_UNAVAILABLE');
    expect(toUserSafeAIReason('circuit_open:OLLAMA')).toBe('SCROLITHA_UNAVAILABLE');
    expect(toUserSafeAIReason('Scrolitha AI timeout of 20000ms exceeded')).toBe('SCROLITHA_UNAVAILABLE');
  });

  test('preserves stable product policy codes', () => {
    expect(toUserSafeAIReason('EMPTY_MESSAGE')).toBe('EMPTY_MESSAGE');
    expect(toUserSafeAIReason('QUOTA_EXCEEDED')).toBe('QUOTA_EXCEEDED');
  });

  test('does not return arbitrary provider text', () => {
    expect(toUserSafeAIReason('request failed at https://ollama.internal/api/chat')).toBe('SCROLITHA_UNAVAILABLE');
  });

  test('sanitizes the reason inside a returned result as well as the top-level error', () => {
    expect(toUserSafeAIResult({ ok: false, reason: 'circuit_open:OLLAMA' })).toMatchObject({
      ok: false,
      reason: 'SCROLITHA_UNAVAILABLE'
    });
  });
});
