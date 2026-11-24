/**
 * Phase 33.0 — Canonical ScrolithaAI.execute() facade.
 * All AI-powered features must eventually call this entry point.
 *
 * Hard rules: no autonomous actions; provider calls off by default;
 * PROHIBITED never leaves the gateway; graceful degradation always.
 */
import { randomUUID } from 'crypto';
import {
  ALL_AI_CAPABILITIES,
  SAFETY_POLICY_VERSION,
  type AIProviderId,
  type AIRequestLifecycle,
  type ScrolithaAIExecuteInput,
  type ScrolithaAIExecuteResult
} from './types';
import { loadAIFeatureFlags, loadProviderConfig, isNativeExecutionAllowed, isOllamaCallAllowed, isProviderEnabled, isScrolithaLocalOnly, SCROLITHA_LOCAL_MODEL } from './config';
import { assertConsentForRequest } from './consent';
import {
  classifyPrivacy,
  flattenInput,
  minimizeContext,
  redactText,
  externalProviderAllowedForPrivacy
} from './privacy';
import { evaluateSafetyPre, evaluateSafetyPost, wrapUntrustedContent } from './safety';
import AIPromptRegistry from './promptRegistry';
import { routeModel } from './router';
import { getProvider } from './providers';
import {
  canCache,
  buildCacheKey,
  hashInput,
  cacheGet,
  cacheSet
} from './cache';
import {
  checkQuota,
  beginRequest,
  endRequest,
  recordUsage,
  estimateCostUsd,
  getMaxAiRequestRuntimeMs,
  boundProviderTimeoutMs
} from './usage';
import { inc, logAIEvent } from './observability';
import {
  isCircuitOpen,
  recordProviderSuccess,
  recordProviderFailure,
  withTimeout
} from './reliability';
import { writeAIAudit, hashContent, persistRequestRecord } from './audit';
import {
  parseNotificationSummary,
  validateNotificationSummary,
  parseNotificationPriority,
  validateNotificationPriority,
  parseEngagementNotificationCopy,
  validateEngagementNotificationCopy,
  parseGenericExtraction,
  validateGenericExtraction
} from './structured';

function blocked<T = unknown>(
  partial: Partial<ScrolithaAIExecuteResult<T>> & {
    reason: string;
    lifecycle: AIRequestLifecycle;
    correlationId: string;
    latencyMs: number;
  }
): ScrolithaAIExecuteResult<T> {
  return {
    ok: false,
    blocked: true,
    text: undefined,
    ...partial
  };
}

export class ScrolithaAI {
  /**
   * Unified AI execution entry point.
   */
  static async execute<T = unknown>(
    input: ScrolithaAIExecuteInput
  ): Promise<ScrolithaAIExecuteResult<T>> {
    const started = Date.now();
    const correlationId = input.correlationId || randomUUID();
    const requestId = randomUUID();
    let lifecycle: AIRequestLifecycle = 'REQUESTED';
    inc('requests');

    try {
      // --- VALIDATE ---
      lifecycle = 'VALIDATED';
      if (!input.capability || !ALL_AI_CAPABILITIES.includes(input.capability)) {
        inc('blocks');
        return blocked({
          reason: 'UNKNOWN_CAPABILITY',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        });
      }

      const flags = await loadAIFeatureFlags();
      if (flags.killSwitch) {
        inc('blocks');
        return blocked({
          reason: 'AI_KILL_SWITCH',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        });
      }
      if (!flags.masterEnabled) {
        inc('blocks');
        return blocked({
          reason: 'AI_MASTER_DISABLED',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        });
      }
      if (!flags[input.capability]) {
        inc('blocks');
        return blocked({
          reason: `CAPABILITY_FLAG_DISABLED:${input.capability}`,
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        });
      }

      // --- PRIVACY ---
      const privacyLevel = classifyPrivacy(input, input.policy?.privacyLevel);
      if (privacyLevel === 'PROHIBITED') {
        inc('blocks');
        inc('safetyBlocks');
        await writeAIAudit({
          action: 'request.blocked',
          actorUserId: input.userId,
          capability: input.capability,
          privacyLevel,
          lifecycle: 'BLOCKED',
          reason: 'PRIVACY_PROHIBITED',
          correlationId,
          requestId,
          inputHash: hashContent(flattenInput(input.input))
        });
        return blocked({
          reason: 'PRIVACY_PROHIBITED',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          privacyLevel,
          latencyMs: Date.now() - started
        });
      }

      // --- CONSENT ---
      lifecycle = 'CONSENT_CHECKED';
      const consentCheck = await assertConsentForRequest({
        userId: input.userId,
        capability: input.capability,
        privacyLevel
      });
      if (!consentCheck.allowed) {
        inc('consentRejections');
        inc('blocks');
        return blocked({
          reason: 'reason' in consentCheck ? consentCheck.reason : 'CONSENT_REQUIRED',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          privacyLevel,
          latencyMs: Date.now() - started
        });
      }
      const consent = consentCheck.consent;

      // --- REDACT ---
      lifecycle = 'REDACTED';
      const rawText = flattenInput(input.input);
      const prompt = AIPromptRegistry.getPublished(input.capability, input.locale || 'en');
      const maxChars = prompt.maxContextChars || 8000;
      const redacted = redactText(rawText, maxChars);
      const minimizedCtx = minimizeContext(input.context, privacyLevel);
      const safeContent = wrapUntrustedContent(redacted.text);

      // --- SAFETY PRE ---
      const preSafety = evaluateSafetyPre(redacted.text + ' ' + JSON.stringify(minimizedCtx));
      if (!preSafety.allowed || preSafety.action === 'REFUSE') {
        inc('safetyBlocks');
        inc('refusals');
        await writeAIAudit({
          action: 'request.refused',
          actorUserId: input.userId,
          capability: input.capability,
          privacyLevel,
          lifecycle: 'BLOCKED',
          reason: preSafety.reasons.join(',') || 'SAFETY_REFUSE',
          correlationId,
          requestId,
          inputHash: hashContent(rawText)
        });
        return {
          ok: false,
          blocked: true,
          reason: 'SAFETY_REFUSE',
          lifecycle: 'BLOCKED',
          safety: preSafety,
          privacyLevel,
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        };
      }

      const rendered = AIPromptRegistry.render(prompt, {
        content: safeContent,
        locale: input.locale || 'en',
        context: JSON.stringify(minimizedCtx).slice(0, 2000)
      });

      // --- ROUTE ---
      lifecycle = 'ROUTED';
      const providerCfg = await loadProviderConfig();
      const deterministicCapability = new Set([
        'INTENT_DETECTION',
        'TASK_PLANNING',
        'SKILL_INVOCATION',
        'PLATFORM_TOOL_PLAN',
        'TEXT_CLASSIFICATION',
        'SEMANTIC_SEARCH_PREPARATION',
        'SEMANTIC_QUERY_EXPANSION',
        'SEARCH_QUERY_SUGGESTION',
        'FEED_RELEVANCE_SCORING',
        'RECOMMENDATION_REASONING',
        'INTEREST_INFERENCE',
        'NOTIFICATION_PRIORITIZATION'
      ]);
      const deterministicOnly =
        input.policy?.deterministicOnly === true || deterministicCapability.has(input.capability);
      const requireOllama = Boolean(input.policy?.requireOllama) || (isScrolithaLocalOnly() && !deterministicOnly);
      const externalOk =
        consent.externalProviderProcessingAllowed &&
        externalProviderAllowedForPrivacy(privacyLevel, true);

      const route = routeModel({
        capability: input.capability,
        privacyLevel,
        externalConsent: externalOk,
        preferInternal: input.policy?.preferInternalProvider || privacyLevel === 'HIGHLY_SENSITIVE',
        preferNative: true,
        localFirst: true,
        structured: Boolean(input.structured),
        contextChars: redacted.text.length,
        locale: input.locale || 'en',
        maxTokens: input.policy?.maxTokens,
        timeoutMs: input.policy?.timeoutMs ?? getMaxAiRequestRuntimeMs() ?? undefined,
        providerHealth: {
          NATIVE: isProviderEnabled('NATIVE', providerCfg) ? 'operational' : 'disabled',
          OLLAMA: isProviderEnabled('OLLAMA', providerCfg) ? 'operational' : 'disabled',
          GEMINI: isProviderEnabled('GEMINI', providerCfg) && externalOk ? 'operational' : 'disabled',
          OPENAI: isProviderEnabled('OPENAI', providerCfg) && externalOk ? 'operational' : 'disabled',
          MOCK: isScrolithaLocalOnly() || process.env.NODE_ENV === 'production' ? 'disabled' : 'operational',
          DISABLED: 'disabled'
        },
        requireOllama
      });
      const configuredRequestRuntimeMs = getMaxAiRequestRuntimeMs();
      if (configuredRequestRuntimeMs !== null) {
        route.timeoutMs = Math.min(route.timeoutMs, configuredRequestRuntimeMs);
      }

      // --- CACHE ---
      const inputHash = hashInput(
        `${input.capability}|${rendered.system}|${rendered.user}|${prompt.version}`
      );
      const cacheKey = buildCacheKey({
        capability: input.capability,
        promptVersion: String(prompt.version),
        model: route.model,
        inputHash,
        policyVersion: SAFETY_POLICY_VERSION,
        locale: input.locale || 'en'
      });
      const allowCache = canCache({
        capability: input.capability,
        privacyLevel,
        consentAllows: consent.aiFeaturesEnabled && !consent.personalizationAllowed,
        personalized: Boolean(consent.personalizationAllowed),
        allowCache: input.policy?.allowCache
      });
      if (allowCache) {
        const hit = cacheGet(cacheKey);
        if (hit) {
          inc('cacheHits');
          inc('successes');
          return {
            ok: true,
            lifecycle: 'COMPLETED',
            text: hit.text,
            data: hit.data as T,
            disclosure: {
              generatedByAI: true,
              provider: hit.provider,
              model: hit.model,
              promptVersion: hit.promptVersion,
              generatedAt: new Date().toISOString()
            },
            route,
            privacyLevel,
            safety: preSafety,
            latencyMs: Date.now() - started,
            correlationId,
            requestId,
            cacheHit: true
          };
        }
        inc('cacheMisses');
      }

      // --- PROVIDER CALL (NATIVE / local / external / MOCK) ---
      lifecycle = 'PROCESSING';
      // Provider availability remains explicitly gated. NATIVE is network-free,
      // but production execution still requires its opt-in and a deterministic capability.
      const productionProviderGateOpen = process.env.NODE_ENV !== 'production' ||
        (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER === '1' &&
          ['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase()));
      const providerCallsEnabled = flags.enableProviderCalls && productionProviderGateOpen;
      const ollamaEnabled = isOllamaCallAllowed(flags, providerCfg);
      const forceNoAllProviders =
        process.env.SCROLITHA_AI_FORCE_NO_PROVIDER === '1' &&
        !String(process.env.SCROLITHA_AI_ALLOWED_PROVIDERS || '').toUpperCase().split(',').includes('OLLAMA');
      const useNetworkProviders =
        providerCallsEnabled &&
        !input.dryRun &&
        !forceNoAllProviders &&
        !providerCfg.emergencyShutdown;

      let chain: Array<{ provider: AIProviderId; model: string }> = [
        { provider: route.provider, model: route.model },
        ...route.fallbackChain
      ];

      if (!useNetworkProviders) {
        if (requireOllama) {
          chain = ollamaEnabled ? [{ provider: 'OLLAMA', model: SCROLITHA_LOCAL_MODEL }] : [];
        } else if (isScrolithaLocalOnly()) {
          // Deterministic capabilities prefer the gated native provider and may
          // fall back to Ollama. Non-deterministic callers take the strict
          // requireOllama branch above and cannot fall back to NATIVE.
          const native = isProviderEnabled('NATIVE', providerCfg)
            ? [{ provider: 'NATIVE' as const, model: 'scrolitha-native-33.3' }]
            : [];
          const ollama = ollamaEnabled
            ? [{ provider: 'OLLAMA' as const, model: SCROLITHA_LOCAL_MODEL }]
            : [];
          chain = input.policy?.preferNative || deterministicOnly ? [...native, ...ollama] : [...ollama, ...native];
        } else {
          // Deterministic native intelligence remains available without network provider calls.
          chain = chain.filter((c) => c.provider === 'NATIVE' || c.provider === 'MOCK');
        if (!chain.some((c) => c.provider === 'NATIVE') && isProviderEnabled('NATIVE', providerCfg)) {
          chain.unshift({ provider: 'NATIVE', model: 'scrolitha-native-33.3' });
        }
          if (!chain.some((c) => c.provider === 'MOCK')) {
          chain.push({ provider: 'MOCK', model: 'mock-foundation' });
        }
          if (!chain.length) {
          chain.push({ provider: 'NATIVE', model: 'scrolitha-native-33.3' });
          }
        }
      }

      if (requireOllama && !ollamaEnabled) {
        inc('blocks');
        const reason = !flags.enableProviderCalls || !productionProviderGateOpen
          ? 'PROVIDER_CALLS_DISABLED_BY_POLICY'
          : providerCfg.emergencyShutdown
            ? 'PROVIDER_EMERGENCY_SHUTDOWN'
            : 'OLLAMA_PROVIDER_DISABLED_BY_POLICY';
        await writeAIAudit({
          action: 'request.blocked',
          actorUserId: input.userId,
          capability: input.capability,
          provider: 'OLLAMA',
          privacyLevel,
          lifecycle: 'BLOCKED',
          reason,
          correlationId,
          requestId,
          inputHash: hashContent(rawText)
        });
        return blocked({
          reason,
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          privacyLevel,
          latencyMs: Date.now() - started
        });
      }

      // Profile editing must remain usable when the self-hosted model is
      // cold, unavailable, or marked unhealthy. The native provider is
      // deterministic and network-free, so an explicitly native-preferred
      // request must not depend on provider-health configuration to enter
      // the chain. Ollama remains available as a fallback when present.
      if (input.policy?.preferNative && !input.policy?.requireOllama) {
        chain = [
          { provider: 'NATIVE', model: 'scrolitha-native-33.3' },
          ...chain.filter((candidate) => candidate.provider !== 'NATIVE')
        ];
      }

      // Reserve the conservative maximum only after consent, privacy, safety,
      // cache, and provider routing checks have passed. Each eligible provider
      // may be attempted; structured generation can make up to two calls.
      // UTF-8 bytes provide a conservative preflight bound: tokenizers may
      // split non-ASCII text into byte-level tokens, so character/4 can
      // materially under-reserve. Provider telemetry settles the reservation.
      const promptBytes = Buffer.byteLength(`${rendered.system}\n${rendered.user}`, 'utf8');
      const tokensPerProviderAttempt = promptBytes + route.maximumTokens;
      const structuredAttempts = input.structured || Boolean(prompt.outputSchemaName) ? 2 : 1;
      const estimatedTokens = tokensPerProviderAttempt * chain.filter((step) => step.provider !== 'DISABLED').length * structuredAttempts;
      const estimatedCostUsd = chain.reduce(
        (sum, step) => sum + estimateCostUsd(step.provider, tokensPerProviderAttempt * structuredAttempts),
        0
      );
      const quota = await checkQuota({
        userId: input.userId,
        capability: input.capability,
        requestId,
        estimatedTokens,
        estimatedCostUsd
      });
      if (!quota.allowed) {
        inc('quotaRejections');
        inc('blocks');
        return blocked({
          reason: quota.reason || 'QUOTA_EXCEEDED',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          privacyLevel,
          latencyMs: Date.now() - started
        });
      }

      beginRequest(input.userId);
      const providerDeadline = Date.now() + route.timeoutMs;
      let lastError: string | null = null;
      let text = '';
      let data: T | undefined;
      let usedProvider: AIProviderId = 'NATIVE';
      let usedModel = 'scrolitha-native-33.3';
      let usage: ScrolithaAIExecuteResult['usage'];
      let parseAttempts = 0;
      let providerAttempted = false;
      let providerAttemptFailed = false;

      const settleUsage = (status: 'COMPLETED' | 'FAILED' | 'BLOCKED') => recordUsage({
        userId: input.userId,
        capability: input.capability,
        provider: usedProvider,
        model: usedModel,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        estimatedCostUsd: usage?.estimatedCostUsd,
        usageKnown: !providerAttempted || (!providerAttemptFailed &&
          (Boolean(usage && (usage.totalTokens !== undefined ||
            usage.promptTokens !== undefined || usage.completionTokens !== undefined)) ||
            usedProvider === 'NATIVE' || usedProvider === 'MOCK')),
        correlationId,
        requestId,
        status
      });

      try {
        for (let i = 0; i < chain.length; i++) {
          const step = chain[i];
          if (step.provider === 'DISABLED') continue;
          const providerTimeoutMs = boundProviderTimeoutMs(route.timeoutMs, providerDeadline - Date.now());
          if (providerTimeoutMs <= 0) {
            lastError = 'AI_REQUEST_RUNTIME_LIMIT_EXCEEDED';
            providerAttemptFailed = providerAttempted;
            break;
          }
          if (step.provider === 'NATIVE' && !isNativeExecutionAllowed(providerCfg, deterministicOnly)) {
            lastError = 'NATIVE_PROVIDER_DISABLED_BY_POLICY';
            continue;
          }
          if (process.env.NODE_ENV === 'production' && !deterministicOnly && step.provider !== 'OLLAMA') {
            lastError = 'PRODUCTION_PROVIDER_NOT_ALLOWED';
            continue;
          }
          if (
            isCircuitOpen(step.provider) &&
            step.provider !== 'MOCK' &&
            step.provider !== 'NATIVE'
          ) {
            lastError = `circuit_open:${step.provider}`;
            continue;
          }
          // External providers require consent + privacy
          if (
            (step.provider === 'GEMINI' || step.provider === 'OPENAI') &&
            (!externalOk || privacyLevel === 'HIGHLY_SENSITIVE')
          ) {
            continue;
          }
          if (
            !isProviderEnabled(step.provider, providerCfg) &&
            step.provider !== 'MOCK' &&
            step.provider !== 'NATIVE'
          ) {
            continue;
          }

          const provider = getProvider(step.provider);
          if (!provider) continue;

          usedProvider = step.provider;
          usedModel = step.model;
          providerAttempted = true;

          try {
            const messages = [
              { role: 'system' as const, content: rendered.system },
              { role: 'user' as const, content: rendered.user }
            ];

            if (input.structured || prompt.outputSchemaName) {
              const schemaName = prompt.outputSchemaName || 'GenericExtraction';
              const parsers: Record<
                string,
                { parse: (r: string) => any; validate: (v: any) => boolean }
              > = {
                NotificationSummary: {
                  parse: parseNotificationSummary,
                  validate: validateNotificationSummary
                },
                NotificationPrioritySuggestions: {
                  parse: parseNotificationPriority,
                  validate: validateNotificationPriority
                },
                EngagementNotificationCopy: {
                  parse: parseEngagementNotificationCopy,
                  validate: validateEngagementNotificationCopy
                },
                GenericExtraction: {
                  parse: parseGenericExtraction,
                  validate: validateGenericExtraction
                }
              };
              const parser = parsers[schemaName] || parsers.GenericExtraction;
              const structured = await withTimeout(
                provider.generateStructured({
                  messages,
                  maxTokens: route.maximumTokens,
                  timeoutMs: providerTimeoutMs,
                  model: step.model,
                  locale: input.locale || 'en',
                  schemaName,
                  schemaVersion: '33.0',
                  parse: parser.parse,
                  validate: parser.validate
                }),
                providerTimeoutMs,
                'PROVIDER_TIMEOUT'
              );
              text = structured.rawText;
              data = structured.data as T;
              usedProvider = structured.provider;
              usedModel = structured.model;
              parseAttempts = structured.parseAttempts;
              if (structured.parseAttempts > 1) inc('structuredFailures');
              usage = structured.usage
                ? {
                    ...structured.usage,
                    estimatedCostUsd: estimateCostUsd(
                      structured.provider,
                      structured.usage.totalTokens ??
                        (structured.usage.promptTokens || 0) + (structured.usage.completionTokens || 0)
                    )
                  }
                : undefined;
            } else {
              const resp = await withTimeout(
                provider.generateText({
                  messages,
                  maxTokens: route.maximumTokens,
                  timeoutMs: providerTimeoutMs,
                  model: step.model,
                  locale: input.locale || 'en'
                }),
                providerTimeoutMs,
                'PROVIDER_TIMEOUT'
              );
              text = resp.text;
              usedProvider = resp.provider;
              usedModel = resp.model;
              usage = resp.usage
                ? {
                    ...resp.usage,
                    estimatedCostUsd: estimateCostUsd(
                      resp.provider,
                      resp.usage.totalTokens ??
                        (resp.usage.promptTokens || 0) + (resp.usage.completionTokens || 0)
                    )
                  }
                : undefined;
            }

            recordProviderSuccess(step.provider);
            if (i > 0) inc('fallbacks');
            break;
          } catch (err: any) {
            providerAttemptFailed = true;
            lastError = String(err?.message || err);
            recordProviderFailure(step.provider);
            logAIEvent('warn', 'provider_attempt_failed', {
              provider: step.provider,
              correlationId,
              error: lastError
            });
            if (i === chain.length - 1 && step.provider !== 'MOCK' && !input.policy?.requireOllama && !isScrolithaLocalOnly() && process.env.NODE_ENV !== 'production') {
              // final fallback to mock
              try {
                const mock = getProvider('MOCK')!;
                const resp = await mock.generateText({
                  messages: [
                    { role: 'system', content: rendered.system },
                    { role: 'user', content: rendered.user }
                  ],
                  model: 'mock-foundation'
                });
                text = resp.text;
                usedProvider = 'MOCK';
                usedModel = 'mock-foundation';
                usage = { ...resp.usage, estimatedCostUsd: 0 };
                inc('fallbacks');
              } catch {
                /* keep lastError */
              }
            }
          }
        }
      } finally {
        endRequest(input.userId);
      }

      if (!text && lastError) {
        lifecycle = 'FAILED';
        inc('failures');
        await settleUsage('FAILED');
        return {
          ok: false,
          reason: lastError,
          lifecycle: 'FAILED',
          route,
          privacyLevel,
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        };
      }

      if (!text && requireOllama) {
        lifecycle = 'FAILED';
        inc('failures');
        await settleUsage('FAILED');
        return {
          ok: false,
          reason: lastError || 'OLLAMA_UNAVAILABLE',
          lifecycle: 'FAILED',
          route,
          privacyLevel,
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        };
      }

      // --- SAFETY POST ---
      const postSafety = evaluateSafetyPost(text);
      if (!postSafety.allowed || postSafety.action === 'REFUSE') {
        inc('refusals');
        inc('safetyBlocks');
        await settleUsage('BLOCKED');
        return {
          ok: false,
          blocked: true,
          reason: 'SAFETY_OUTPUT_REFUSE',
          lifecycle: 'BLOCKED',
          safety: postSafety,
          route,
          privacyLevel,
          correlationId,
          requestId,
          latencyMs: Date.now() - started
        };
      }
      if (postSafety.action === 'REDACT') {
        text = text.replace(/scrolith knowledge baseline|internal platform context only/gi, '[REDACTED]');
      }

      lifecycle = 'COMPLETED';
      const latencyMs = Date.now() - started;
      const quotaSettlement = await settleUsage('COMPLETED');
      if (!quotaSettlement.withinLimits) {
        inc('quotaRejections');
        inc('blocks');
        return blocked({
          reason: quotaSettlement.reason || 'QUOTA_EXCEEDED',
          lifecycle: 'BLOCKED',
          correlationId,
          requestId,
          privacyLevel,
          latencyMs
        });
      }
      inc('successes');
      inc('totalLatencyMs', latencyMs);
      if (usage?.totalTokens) inc('totalTokens', usage.totalTokens);
      if (usage?.estimatedCostUsd) inc('estimatedCostUsd', usage.estimatedCostUsd);

      const disclosure = {
        generatedByAI: true,
        provider: usedProvider,
        model: usedModel,
        promptVersion: `${prompt.promptKey}@${prompt.version}`,
        generatedAt: new Date().toISOString()
      };

      if (allowCache && text) {
        cacheSet(cacheKey, {
          text,
          data,
          provider: usedProvider,
          model: usedModel,
          promptVersion: disclosure.promptVersion
        });
      }

      // History only when user consented
      if (consent.aiActivityHistoryEnabled) {
        await persistRequestRecord({
          id: requestId,
          userId: input.userId,
          capability: input.capability,
          lifecycle: 'COMPLETED',
          privacyLevel,
          provider: usedProvider,
          model: usedModel,
          inputHash: hashContent(rawText),
          correlationId,
          latencyMs,
          metadata: { promptVersion: disclosure.promptVersion, parseAttempts }
        });
      }

      await writeAIAudit({
        action: 'request.completed',
        actorUserId: input.userId,
        capability: input.capability,
        provider: usedProvider,
        model: usedModel,
        privacyLevel,
        lifecycle: 'COMPLETED',
        correlationId,
        requestId,
        inputHash: hashContent(rawText),
        metadata: { latencyMs, cache: false }
      });

      logAIEvent('info', 'execute.completed', {
        capability: input.capability,
        provider: usedProvider,
        correlationId,
        latencyMs
      });

      return {
        ok: true,
        lifecycle: 'COMPLETED',
        text,
        data,
        disclosure,
        safety: postSafety,
        route: { ...route, provider: usedProvider, model: usedModel },
        privacyLevel,
        usage,
        latencyMs,
        correlationId,
        requestId,
        cacheHit: false
      };
    } catch (err: any) {
      inc('failures');
      logAIEvent('error', 'execute.failed', {
        correlationId,
        error: String(err?.message || err)
      });
      return {
        ok: false,
        reason: String(err?.message || 'INTERNAL_ERROR'),
        lifecycle: 'FAILED',
        correlationId,
        requestId,
        latencyMs: Date.now() - started
      };
    }
  }
}

export default ScrolithaAI;
