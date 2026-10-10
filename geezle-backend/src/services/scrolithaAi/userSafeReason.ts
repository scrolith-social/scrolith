/** Convert internal provider failures into stable, user-facing AI responses. */
export const toUserSafeAIReason = (reason: unknown): string => {
  const value = String(reason || '').trim();
  if (!value) return 'SCROLITHA_UNAVAILABLE';

  if (/^(?:PROVIDER_|OLLAMA|OPENAI|GEMINI|circuit_open:|PRODUCTION_PROVIDER_NOT_ALLOWED|Scrolitha AI timeout|Scrolitha Core)/i.test(value)) {
    return 'SCROLITHA_UNAVAILABLE';
  }

  if (/^(?:EMPTY_MESSAGE|AI_MASTER_DISABLED|AI_KILL_SWITCH|CAPABILITY_FLAG_DISABLED|PRIVACY_PROHIBITED|CONSENT_REQUIRED|QUOTA_EXCEEDED|SAFETY_REFUSE|SAFETY_OUTPUT_REFUSE)$/i.test(value)) {
    return value;
  }

  return value.length <= 80 && /^[A-Z0-9_:-]+$/i.test(value) ? value : 'SCROLITHA_UNAVAILABLE';
};

export const toUserSafeAIResult = <T extends { reason?: unknown }>(result: T): T =>
  result.reason ? { ...result, reason: toUserSafeAIReason(result.reason) } : result;

export default toUserSafeAIReason;
