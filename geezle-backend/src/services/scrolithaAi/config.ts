/**
 * Phase 33.0 — Feature flags, kill switch, provider allowlist (privacy-first defaults).
 */
import prisma from '../../utils/prismaClient';
import {
  createAIAuditRecordInTransaction,
  rememberCommittedAIAuditRecord,
  type AIAuditInput
} from './audit';
import {
  DEFAULT_AI_FEATURE_FLAGS,
  type AIFeatureFlags,
  type AIProviderId
} from './types';

const FLAG_KEY = 'scrolitha_ai_feature_flags';
const PROVIDER_KEY = 'scrolitha_ai_provider_config';
// qwen3:8b is the largest model selected for the current 8 GiB Core
// container budget. It provides materially better reasoning while leaving
// headroom for Ollama and the HTTP runtime.
export const SCROLITHA_LOCAL_MODEL = 'qwen3:8b';

let flagsCache: AIFeatureFlags = { ...DEFAULT_AI_FEATURE_FLAGS };
let flagsLoadedAt = 0;
const FLAGS_TTL_MS = 15_000;

const isMissing = (err: any) =>
  err?.code === 'P2021' || err instanceof TypeError || /does not exist/i.test(String(err?.message || ''));

export type ProviderConfigState = {
  NATIVE: { enabled: boolean; model?: string };
  OLLAMA: { enabled: boolean; model?: string; timeoutMs?: number };
  GEMINI: { enabled: boolean; model?: string; timeoutMs?: number };
  OPENAI: { enabled: boolean; model?: string; timeoutMs?: number };
  MOCK: { enabled: boolean };
  allowedProviders?: AIProviderId[];
  /** Emergency: no real provider calls */
  emergencyShutdown: boolean;
};

const DEFAULT_PROVIDER_CONFIG: ProviderConfigState = {
  // Production activation requires an audited persisted provider change as
  // well as the deployment's explicit environment gate. Development retains
  // the existing local defaults.
  NATIVE: { enabled: process.env.NODE_ENV !== 'production', model: 'scrolitha-native-33.3' },
  OLLAMA: {
    enabled: process.env.NODE_ENV !== 'production',
    model: process.env.SCROLITHA_OLLAMA_MODEL || SCROLITHA_LOCAL_MODEL,
    timeoutMs: 30_000
  },
  GEMINI: { enabled: false, model: process.env.SCROLITHA_GEMINI_MODEL || 'gemini-pro', timeoutMs: 30_000 },
  OPENAI: { enabled: false, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', timeoutMs: 30_000 },
  MOCK: { enabled: false },
  allowedProviders: ['OLLAMA'],
  emergencyShutdown: false
};

let providerCache: ProviderConfigState = { ...DEFAULT_PROVIDER_CONFIG };
let providerLoadedAt = 0;

function mergeFlags(raw: unknown): AIFeatureFlags {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    ...DEFAULT_AI_FEATURE_FLAGS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_AI_FEATURE_FLAGS).map((k) => [
        k,
        src[k] !== undefined ? Boolean(src[k]) : (DEFAULT_AI_FEATURE_FLAGS as any)[k]
      ])
    )
  } as AIFeatureFlags;
}

/** Apply environment safety gates on every read, including cache hits. */
function applyFeatureFlagEnvironmentOverrides(flags: AIFeatureFlags): AIFeatureFlags {
  const effective = { ...flags };
  const envFlag = (name: string) =>
    ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
  const envFlagSet = (name: string) => process.env[name] !== undefined;

  if (envFlag('SCROLITHA_AI_KILL_SWITCH')) effective.killSwitch = true;
  if (process.env.SCROLITHA_AI_FORCE_NO_PROVIDER === '1' ||
      (process.env.NODE_ENV === 'production' &&
        (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER !== '1' ||
          !envFlag('SCROLITHA_AI_ENABLE_PROVIDER_CALLS')))) {
    effective.enableProviderCalls = false;
  }
  if (envFlagSet('SCROLITHA_AI_ENABLED')) effective.masterEnabled = envFlag('SCROLITHA_AI_ENABLED');
  if (envFlagSet('SCROLITHA_AI_ENGAGEMENT_NOTIFICATION_COPY_ENABLED')) {
    effective.ENGAGEMENT_NOTIFICATION_COPY = envFlag('SCROLITHA_AI_ENGAGEMENT_NOTIFICATION_COPY_ENABLED');
  }
  if (envFlagSet('SCROLITHA_AI_PLATFORM_COPILOT_ENABLED')) {
    effective.platformCopilotEnabled = envFlag('SCROLITHA_AI_PLATFORM_COPILOT_ENABLED');
  }
  if (envFlagSet('SCROLITHA_AI_NATIVE_INTELLIGENCE_ENABLED')) {
    effective.nativeIntelligenceEnabled = envFlag('SCROLITHA_AI_NATIVE_INTELLIGENCE_ENABLED');
  }
  if (envFlagSet('SCROLITHA_AI_SKILLS_ENABLED')) {
    effective.skillsFrameworkEnabled = envFlag('SCROLITHA_AI_SKILLS_ENABLED');
  }
  if (envFlagSet('SCROLITHA_AI_TOOL_ORCHESTRATION_ENABLED')) {
    effective.toolOrchestrationEnabled = envFlag('SCROLITHA_AI_TOOL_ORCHESTRATION_ENABLED');
  }
  if (envFlagSet('SCROLITHA_AI_BETA_ALLOWLIST_ONLY')) {
    effective.betaAllowlistOnly = envFlag('SCROLITHA_AI_BETA_ALLOWLIST_ONLY');
  }
  if (envFlag('SCROLITHA_AI_ENABLE_ALL_CAPABILITIES')) {
    for (const key of Object.keys(DEFAULT_AI_FEATURE_FLAGS) as Array<keyof AIFeatureFlags>) {
      if (key !== 'killSwitch' && key !== 'betaAllowlistOnly') effective[key] = true;
    }
  }
  if (effective.platformCopilotEnabled) effective.COPILOT_CONTEXT = true;
  if (effective.nativeIntelligenceEnabled) {
    effective.INTENT_DETECTION = true;
    effective.TASK_PLANNING = true;
    effective.SKILL_INVOCATION = true;
  }
  // Reapply hard safety gates last so convenience environment overrides such
  // as ENABLE_ALL_CAPABILITIES cannot reopen provider calls.
  if (envFlag('SCROLITHA_AI_KILL_SWITCH')) effective.killSwitch = true;
  if (process.env.SCROLITHA_AI_FORCE_NO_PROVIDER === '1' ||
      (process.env.NODE_ENV === 'production' &&
        (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER !== '1' ||
          !envFlag('SCROLITHA_AI_ENABLE_PROVIDER_CALLS')))) {
    effective.enableProviderCalls = false;
  }
  return effective;
}

export async function loadAIFeatureFlags(force = false): Promise<AIFeatureFlags> {
  if (!force && Date.now() - flagsLoadedAt < FLAGS_TTL_MS) {
    return applyFeatureFlagEnvironmentOverrides(flagsCache);
  }
  try {
    const row = await (prisma as any).aIFeatureFlag?.findUnique?.({ where: { key: FLAG_KEY } });
    if (row?.value) {
      flagsCache = mergeFlags(row.value);
    } else {
      flagsCache = { ...DEFAULT_AI_FEATURE_FLAGS };
    }
  } catch (err) {
    if (!isMissing(err)) {
      /* keep defaults */
    }
    flagsCache = { ...DEFAULT_AI_FEATURE_FLAGS };
  }
  flagsLoadedAt = Date.now();
  return applyFeatureFlagEnvironmentOverrides(flagsCache);
}

export function getAIFeatureFlagsSync(): AIFeatureFlags {
  return applyFeatureFlagEnvironmentOverrides(flagsCache);
}

export async function setAIFeatureFlags(
  partial: Partial<AIFeatureFlags>,
  updatedBy?: string
): Promise<AIFeatureFlags> {
  const current = await loadAIFeatureFlags(true);
  const next = { ...current, ...partial };
  // Never allow enableProviderCalls true in production via admin without env
  if (process.env.NODE_ENV === 'production' &&
      (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER !== '1' ||
        !['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase()))) {
    next.enableProviderCalls = false;
  }
  flagsCache = next;
  flagsLoadedAt = Date.now();
  try {
    await (prisma as any).aIFeatureFlag?.upsert?.({
      where: { key: FLAG_KEY },
      create: { key: FLAG_KEY, value: next, updatedBy: updatedBy || null },
      update: { value: next, version: { increment: 1 }, updatedBy: updatedBy || null }
    });
  } catch (err) {
    if (!isMissing(err)) {
      /* memory only */
    }
  }
  return next;
}

/**
 * Admin-only durable mutation. The feature row and its audit event commit
 * together; process caches are changed only after the transaction succeeds.
 */
export async function persistAdminAIFeatureFlags(
  partial: Partial<AIFeatureFlags>,
  updatedBy: string,
  auditMetadata: Record<string, unknown>
): Promise<AIFeatureFlags> {
  const result = await (prisma as any).$transaction(async (tx: any) => {
    const delegate = tx?.aIFeatureFlag;
    if (typeof delegate?.findUnique !== 'function' || typeof delegate?.upsert !== 'function') {
      throw new Error('AI feature-flag persistence is unavailable.');
    }
    const row = await delegate.findUnique({ where: { key: FLAG_KEY } });
    let next = { ...mergeFlags(row?.value), ...partial } as AIFeatureFlags;
    if (process.env.NODE_ENV === 'production' &&
        (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER !== '1' ||
          !['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase()))) {
      next.enableProviderCalls = false;
    }
    const saved = await delegate.upsert({
      where: { key: FLAG_KEY },
      create: { key: FLAG_KEY, value: next, updatedBy: updatedBy || null },
      update: { value: next, version: { increment: 1 }, updatedBy: updatedBy || null }
    });
    const audit = await createAIAuditRecordInTransaction(tx, {
      action: 'admin.feature_flags.updated',
      actorUserId: updatedBy,
      metadata: auditMetadata
    });
    return { flags: mergeFlags(saved?.value ?? next), audit };
  }, { isolationLevel: 'Serializable' });

  flagsCache = result.flags;
  flagsLoadedAt = Date.now();
  rememberCommittedAIAuditRecord(result.audit);
  return flagsCache;
}

export async function loadProviderConfig(force = false): Promise<ProviderConfigState> {
  if (!force && Date.now() - providerLoadedAt < FLAGS_TTL_MS) return providerCache;
  try {
    const row = await (prisma as any).aIProviderConfiguration?.findUnique?.({
      where: { provider: 'GLOBAL' }
    });
    if (row?.config) {
      providerCache = normalizeProviderConfig({ ...DEFAULT_PROVIDER_CONFIG, ...(row.config as object) } as ProviderConfigState);
    } else {
      providerCache = normalizeProviderConfig({ ...DEFAULT_PROVIDER_CONFIG });
    }
  } catch {
    providerCache = normalizeProviderConfig({ ...DEFAULT_PROVIDER_CONFIG });
  }
  providerLoadedAt = Date.now();
  return providerCache;
}

export async function setProviderConfig(
  partial: Partial<ProviderConfigState>,
  updatedBy?: string
): Promise<ProviderConfigState> {
  const current = await loadProviderConfig(true);
  const next = normalizeProviderConfig({ ...current, ...partial });
  providerCache = next;
  providerLoadedAt = Date.now();
  try {
    await (prisma as any).aIProviderConfiguration?.upsert?.({
      where: { provider: 'GLOBAL' },
      create: {
        provider: 'GLOBAL',
        enabled: !next.emergencyShutdown,
        config: next,
        updatedBy: updatedBy || null
      },
      update: {
        enabled: !next.emergencyShutdown,
        config: next,
        updatedBy: updatedBy || null
      }
    });
  } catch {
    /* memory */
  }
  return next;
}

/** Persist a provider change and its audit record atomically for admin routes. */
export async function persistAdminProviderConfig(
  partial: Partial<ProviderConfigState>,
  updatedBy: string,
  provider: string,
  auditMetadata: Record<string, unknown>
): Promise<ProviderConfigState> {
  const result = await (prisma as any).$transaction(async (tx: any) => {
    const delegate = tx?.aIProviderConfiguration;
    if (typeof delegate?.findUnique !== 'function' || typeof delegate?.upsert !== 'function') {
      throw new Error('AI provider configuration persistence is unavailable.');
    }
    const row = await delegate.findUnique({ where: { provider: 'GLOBAL' } });
    const current = normalizeProviderConfig({
      ...DEFAULT_PROVIDER_CONFIG,
      ...((row?.config && typeof row.config === 'object') ? row.config : {})
    } as ProviderConfigState);
    const merged: ProviderConfigState = { ...current, ...partial } as ProviderConfigState;
    for (const providerId of ['NATIVE', 'OLLAMA', 'GEMINI', 'OPENAI', 'MOCK'] as const) {
      const providerPatch = partial[providerId];
      if (providerPatch && typeof providerPatch === 'object') {
        (merged as any)[providerId] = { ...current[providerId], ...providerPatch };
      }
    }
    const next = normalizeProviderConfig(merged);
    const saved = await delegate.upsert({
      where: { provider: 'GLOBAL' },
      create: {
        provider: 'GLOBAL',
        enabled: !next.emergencyShutdown,
        config: next,
        updatedBy: updatedBy || null
      },
      update: {
        enabled: !next.emergencyShutdown,
        config: next,
        updatedBy: updatedBy || null
      }
    });
    const audit = await createAIAuditRecordInTransaction(tx, {
      action: 'admin.provider.updated',
      actorUserId: updatedBy,
      provider,
      metadata: auditMetadata
    });
    const persisted = saved?.config && typeof saved.config === 'object'
      ? normalizeProviderConfig({ ...DEFAULT_PROVIDER_CONFIG, ...saved.config } as ProviderConfigState)
      : next;
    return { config: persisted, audit };
  }, { isolationLevel: 'Serializable' });

  providerCache = result.config;
  providerLoadedAt = Date.now();
  rememberCommittedAIAuditRecord(result.audit);
  return providerCache;
}

export function isProviderEnabled(id: AIProviderId, cfg: ProviderConfigState): boolean {
  if (id === 'DISABLED') return false;
  if (cfg.emergencyShutdown && id !== 'MOCK' && id !== 'NATIVE') return false;
  if (id === 'OLLAMA') {
    if (process.env.NODE_ENV === 'production') {
      if (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER !== '1') return false;
      if (!['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase())) return false;
      if (!['1', 'true', 'yes', 'on'].includes(
        String(process.env.SCROLITHA_AI_OLLAMA_ENABLED || '').trim().toLowerCase()
      )) return false;
    } else if (String(process.env.SCROLITHA_AI_OLLAMA_ENABLED || '').trim().toLowerCase() === 'false') {
      return false;
    }
  }
  if (isScrolithaLocalOnly()) {
    // NATIVE is a deterministic, network-free safety provider. Keep it
    // available only when explicitly enabled so local-only production still
    // cannot accidentally broaden the provider surface.
    if (id === 'NATIVE') {
      return isExplicitNativeProviderEnabled() && cfg.NATIVE?.enabled !== false;
    }
    if (id !== 'OLLAMA') return false;
    return cfg.OLLAMA?.enabled !== false;
  }
  if (process.env.NODE_ENV === 'production') {
    const allowed = String(process.env.SCROLITHA_AI_ALLOWED_PROVIDERS || 'OLLAMA')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (id === 'NATIVE') {
      return isExplicitNativeProviderEnabled() && cfg.NATIVE?.enabled !== false;
    }
    if (id !== 'OLLAMA') return false;
    if (!allowed.includes('OLLAMA')) return false;
    return cfg.OLLAMA?.enabled !== false;
  }
  if (id === 'NATIVE') return cfg.NATIVE?.enabled !== false;
  if (id === 'MOCK') return cfg.MOCK?.enabled !== false;
  if (id === 'OLLAMA') return cfg.OLLAMA?.enabled !== false;
  if (id === 'GEMINI') return Boolean(cfg.GEMINI?.enabled);
  if (id === 'OPENAI') return Boolean(cfg.OPENAI?.enabled);
  return false;
}

/** Shared hard gate for every Ollama call path, including local-only production. */
export function isOllamaCallAllowed(flags: Pick<AIFeatureFlags, 'enableProviderCalls'>, cfg: ProviderConfigState): boolean {
  const productionGateOpen = process.env.NODE_ENV !== 'production' ||
    (process.env.SCROLITHA_AI_ALLOW_PROD_PROVIDER === '1' &&
      ['1', 'true'].includes(String(process.env.SCROLITHA_AI_ENABLE_PROVIDER_CALLS || '').toLowerCase()));
  return flags.enableProviderCalls && productionGateOpen && isProviderEnabled('OLLAMA', cfg);
}

/**
 * Native execution is deterministic and network-free, but production still
 * requires both the explicit environment opt-in and persisted provider enable.
 * In production it is limited to deterministic capabilities; generated
 * user-facing responses remain on the explicitly required Ollama path.
 */
export function isNativeExecutionAllowed(cfg: ProviderConfigState, deterministicOnly: boolean): boolean {
  return isProviderEnabled('NATIVE', cfg) && (process.env.NODE_ENV !== 'production' || deterministicOnly);
}

export function isScrolithaLocalOnly(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SCROLITHA_AI_LOCAL_ONLY || '').trim().toLowerCase()
  );
}

/**
 * Explicit opt-in for the deterministic native provider. This provider does
 * not make network calls, but it is still kept behind a production flag so
 * administrators can disable it independently of the Ollama runtime.
 */
export function isExplicitNativeProviderEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SCROLITHA_AI_NATIVE_PROVIDER_ENABLED || '').trim().toLowerCase()
  );
}

function normalizeProviderConfig(config: ProviderConfigState): ProviderConfigState {
  if (!isScrolithaLocalOnly()) return config;
  return {
    ...config,
    NATIVE: {
      ...config.NATIVE,
      // Environment variables are a hard ceiling; the persisted provider
      // setting remains an independent audited opt-in.
      enabled: isExplicitNativeProviderEnabled() && config.NATIVE?.enabled === true
    },
    OLLAMA: {
      ...config.OLLAMA,
      enabled: config.OLLAMA?.enabled === true,
      model: SCROLITHA_LOCAL_MODEL
    },
    GEMINI: { ...config.GEMINI, enabled: false },
    OPENAI: { ...config.OPENAI, enabled: false },
    MOCK: { enabled: false },
    allowedProviders: ['OLLAMA']
  };
}

export default {
  loadAIFeatureFlags,
  setAIFeatureFlags,
  getAIFeatureFlagsSync,
  loadProviderConfig,
  setProviderConfig,
  isProviderEnabled
};
