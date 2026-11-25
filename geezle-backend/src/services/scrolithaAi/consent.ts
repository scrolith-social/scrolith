/**
 * Phase 33.0 — Versioned, revocable AI consent (privacy-preserving defaults).
 */
import prisma from '../../utils/prismaClient';
import {
  CONSENT_VERSION,
  DEFAULT_AI_CONSENT,
  type AICapabilityId,
  type AIConsentState,
  type PrivacyLevel
} from './types';

const isMissing = (err: any) =>
  err?.code === 'P2021' || err instanceof TypeError || /does not exist/i.test(String(err?.message || ''));

const memory = new Map<string, AIConsentState>();

function normalize(raw: unknown): AIConsentState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    aiFeaturesEnabled: Boolean(src.aiFeaturesEnabled),
    privateMessageAnalysisAllowed: Boolean(src.privateMessageAnalysisAllowed),
    personalizationAllowed: Boolean(src.personalizationAllowed),
    externalProviderProcessingAllowed: Boolean(src.externalProviderProcessingAllowed),
    aiSuggestionsAllowed: Boolean(src.aiSuggestionsAllowed),
    aiActivityHistoryEnabled: Boolean(src.aiActivityHistoryEnabled),
    productImprovementDataAllowed: Boolean(src.productImprovementDataAllowed),
    consentVersion: String(src.consentVersion || CONSENT_VERSION),
    updatedAt: src.updatedAt ? String(src.updatedAt) : null
  };
}

export async function getAIConsent(userId?: string | null): Promise<AIConsentState> {
  if (!userId) return { ...DEFAULT_AI_CONSENT };
  // Production consent is revocable and can be changed by another replica or
  // an administrative workflow. Never authorize from a process-local cache.
  if (process.env.NODE_ENV === 'test' && memory.has(userId)) {
    return { ...memory.get(userId)! };
  }
  try {
    const row = await (prisma as any).aIConsent?.findUnique?.({ where: { userId } });
    if (row) {
      const state = normalize({
        aiFeaturesEnabled: row.aiFeaturesEnabled,
        privateMessageAnalysisAllowed: row.privateMessageAnalysisAllowed,
        personalizationAllowed: row.personalizationAllowed,
        externalProviderProcessingAllowed: row.externalProviderProcessingAllowed,
        aiSuggestionsAllowed: row.aiSuggestionsAllowed,
        aiActivityHistoryEnabled: row.aiActivityHistoryEnabled,
        productImprovementDataAllowed: row.productImprovementDataAllowed,
        consentVersion: row.consentVersion,
        updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt
      });
      if (process.env.NODE_ENV === 'test') memory.set(userId, state);
      return state;
    }
  } catch (err) {
    // A missing table/client is supported only by isolated unit fixtures.
    // Runtime database errors must never fall back to a previously cached grant.
    if (process.env.NODE_ENV === 'test' && isMissing(err) && memory.has(userId)) {
      return { ...memory.get(userId)! };
    }
  }
  memory.delete(userId);
  return { ...DEFAULT_AI_CONSENT };
}

export async function updateAIConsent(
  userId: string,
  partial: Partial<AIConsentState>
): Promise<AIConsentState> {
  try {
    const persisted = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.aIConsent.findUnique({ where: { userId } });
      const current = existing ? normalize(existing) : { ...DEFAULT_AI_CONSENT };
      const next: AIConsentState = {
        ...current,
        ...partial,
        consentVersion: CONSENT_VERSION,
        updatedAt: new Date().toISOString()
      };

      // Explicit booleans only; read/merge/write is inside a serializable
      // transaction so concurrent preference changes cannot silently overwrite.
      next.aiFeaturesEnabled = Boolean(next.aiFeaturesEnabled);
      next.privateMessageAnalysisAllowed = Boolean(next.privateMessageAnalysisAllowed);
      next.personalizationAllowed = Boolean(next.personalizationAllowed);
      next.externalProviderProcessingAllowed = Boolean(next.externalProviderProcessingAllowed);
      next.aiSuggestionsAllowed = Boolean(next.aiSuggestionsAllowed);
      next.aiActivityHistoryEnabled = Boolean(next.aiActivityHistoryEnabled);
      next.productImprovementDataAllowed = Boolean(next.productImprovementDataAllowed);

      const data = {
        aiFeaturesEnabled: next.aiFeaturesEnabled,
        privateMessageAnalysisAllowed: next.privateMessageAnalysisAllowed,
        personalizationAllowed: next.personalizationAllowed,
        externalProviderProcessingAllowed: next.externalProviderProcessingAllowed,
        aiSuggestionsAllowed: next.aiSuggestionsAllowed,
        aiActivityHistoryEnabled: next.aiActivityHistoryEnabled,
        productImprovementDataAllowed: next.productImprovementDataAllowed,
        consentVersion: next.consentVersion
      };
      const row = await tx.aIConsent.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data
      });
      const saved = normalize({
        ...row,
        updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt
      });

      // The audit record and consent update commit or roll back together.
      await tx.aIAuditLog.create({
        data: {
          action: 'consent.updated',
          actorUserId: userId,
          targetUserId: userId,
          metadata: { consentVersion: saved.consentVersion, flags: saved },
          correlationId: null
        }
      });

      return saved;
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });

    // Publish the cache only after the database transaction commits.
    memory.set(userId, persisted);
    return { ...persisted };
  } catch (err) {
    // The in-memory behavior is limited to unit tests that intentionally run
    // without a database. Runtime environments never report unsaved consent as
    // successful and never authorize from a process-local write.
    if (process.env.NODE_ENV === 'test' && isMissing(err)) {
      const current = await getAIConsent(userId);
      const next = normalize({ ...current, ...partial, consentVersion: CONSENT_VERSION, updatedAt: new Date().toISOString() });
      memory.set(userId, next);
      return { ...next };
    }
    throw new Error('AI consent could not be saved; please retry.');
  }
}

export async function resetAIConsent(userId: string): Promise<AIConsentState> {
  return updateAIConsent(userId, { ...DEFAULT_AI_CONSENT });
}

export type ConsentCheckResult =
  | { allowed: true; consent: AIConsentState }
  | { allowed: false; reason: string; consent: AIConsentState };

/**
 * Server-side consent enforcement for a capability + privacy level.
 */
export async function assertConsentForRequest(input: {
  userId?: string | null;
  capability: AICapabilityId;
  privacyLevel: PrivacyLevel;
  requiresExternal?: boolean;
}): Promise<ConsentCheckResult> {
  const consent = await getAIConsent(input.userId);
  // Engagement copy is generated from non-user-specific event metadata. It is
  // a platform operation controlled by the durable admin rule, not a user's
  // private AI surface, so it may run without per-user AI consent.
  if (input.capability === 'ENGAGEMENT_NOTIFICATION_COPY' && !input.userId) {
    return {
      allowed: true,
      consent: {
        ...DEFAULT_AI_CONSENT,
        aiFeaturesEnabled: true,
        aiSuggestionsAllowed: true,
        consentVersion: CONSENT_VERSION
      }
    };
  }
  if (!consent.aiFeaturesEnabled) {
    return { allowed: false, reason: 'CONSENT_AI_FEATURES_DISABLED', consent };
  }
  const suggestionCaps = new Set([
    'NOTIFICATION_SUMMARIZATION',
    'NOTIFICATION_PRIORITIZATION',
    'ASSISTANT_CHAT',
    'DRAFT_COMPOSITION',
    'COMPOSER_ASSIST',
    'SEARCH_QUERY_SUGGESTION',
    'TEXT_TRANSLATION',
    'TEXT_REWRITING',
    'TEXT_SUMMARIZATION'
  ]);
  if (suggestionCaps.has(input.capability) && !consent.aiSuggestionsAllowed) {
    return { allowed: false, reason: 'CONSENT_SUGGESTIONS_DISABLED', consent };
  }
  if (
    (input.privacyLevel === 'SENSITIVE' || input.privacyLevel === 'HIGHLY_SENSITIVE') &&
    !consent.privateMessageAnalysisAllowed
  ) {
    // Private/sensitive analysis requires explicit private-content consent
    if (input.capability === 'ASSISTANT_CHAT' || input.capability === 'COMPOSER_ASSIST') {
      return { allowed: false, reason: 'CONSENT_PRIVATE_CONTENT_DENIED', consent };
    }
  }
  if (input.requiresExternal && !consent.externalProviderProcessingAllowed) {
    return { allowed: false, reason: 'CONSENT_EXTERNAL_PROVIDER_DENIED', consent };
  }
  return { allowed: true, consent };
}

export default {
  getAIConsent,
  updateAIConsent,
  resetAIConsent,
  assertConsentForRequest
};
