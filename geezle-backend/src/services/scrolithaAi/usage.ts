/**
 * Phase 33.0 — Durable quotas, rate limits, and usage cost ceilings.
 *
 * AIUsageLedger is used as an append-only reservation/settlement ledger. A
 * RESERVED row accounts for the conservative maximum before a provider call;
 * a SETTLEMENT_* row records the delta to measured usage. Both rows share the
 * reservation timestamp, so UTC day/month accounting remains stable if a
 * request crosses a calendar boundary. No in-memory value is authoritative.
 */
import { randomUUID } from 'crypto';
import prisma from '../../utils/prismaClient';
import type { AICapabilityId, AIProviderId } from './types';

const SETTLEMENT_STATUSES = [
  'SETTLEMENT_COMPLETED',
  'SETTLEMENT_FAILED',
  'SETTLEMENT_BLOCKED'
] as const;

const MAX_REQUEST_LEASE_MS = 5 * 60_000;
const USD_MICRO_SCALE = 1_000_000;
const MAX_CONFIGURABLE_REQUEST_RUNTIME_MS = 180_000;

export type QuotaDecision = {
  allowed: boolean;
  reason?: string;
  retryAfter?: number | null;
  requestId?: string;
  remaining?: {
    dailyRequests?: number;
    monthlyTokens?: number;
    globalMonthlyTokens?: number;
    globalMonthlyRequests?: number;
    maxRequestRuntimeMs?: number;
    monthlyBudgetUsd?: number;
    globalDailyBudgetUsd?: number;
  };
};

export type UsageSettlement = {
  withinLimits: boolean;
  reason?: string;
  duplicate?: boolean;
};

type QuotaLimits = {
  dailyRequestsPerUser: number;
  monthlyTokensPerUser: number;
  globalMonthlyTokens: number;
  globalMonthlyRequests: number;
  monthlyBudgetUsdPerUser: number;
  globalDailyBudgetUsd: number;
  maxRequestRuntimeMs: number;
  concurrencyPerUser: number;
  ratePerMinute: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return Number(raw);
}

function getLimits(): QuotaLimits | null {
  const limits: QuotaLimits = {
    dailyRequestsPerUser: envNumber('SCROLITHA_AI_DAILY_REQUESTS', 100),
    monthlyTokensPerUser: envNumber('SCROLITHA_AI_MONTHLY_TOKENS', 500_000),
    globalMonthlyTokens: envNumber('SCROLITHA_AI_GLOBAL_MONTHLY_TOKENS', 500_000),
    globalMonthlyRequests: envNumber('SCROLITHA_AI_GLOBAL_MONTHLY_REQUESTS', 1_000),
    monthlyBudgetUsdPerUser: envNumber('SCROLITHA_AI_MONTHLY_BUDGET_USD', 5),
    globalDailyBudgetUsd: envNumber('SCROLITHA_AI_GLOBAL_DAILY_BUDGET_USD', 100),
    maxRequestRuntimeMs: envNumber('SCROLITHA_AI_MAX_REQUEST_RUNTIME_MS', 60_000),
    concurrencyPerUser: envNumber('SCROLITHA_AI_CONCURRENCY', 3),
    ratePerMinute: envNumber('SCROLITHA_AI_RATE_PER_MINUTE', 20)
  };

  return Object.values(limits).every((value) => Number.isFinite(value) && value >= 0) &&
    Number.isSafeInteger(limits.monthlyTokensPerUser) &&
    Number.isSafeInteger(limits.globalMonthlyTokens) &&
    Number.isSafeInteger(limits.globalMonthlyRequests) &&
    Number.isSafeInteger(limits.maxRequestRuntimeMs) &&
    limits.maxRequestRuntimeMs >= 1_000 &&
    limits.maxRequestRuntimeMs <= MAX_CONFIGURABLE_REQUEST_RUNTIME_MS
    ? limits
    : null;
}

/** Hard-capped wall time for provider work in a single gateway request. */
export function getMaxAiRequestRuntimeMs(): number | null {
  return getLimits()?.maxRequestRuntimeMs ?? null;
}

/** Clamp a provider attempt to both its configured timeout and request deadline. */
export function boundProviderTimeoutMs(configuredTimeoutMs: number, remainingRuntimeMs: number): number {
  if (!Number.isFinite(configuredTimeoutMs) || !Number.isFinite(remainingRuntimeMs)) return 0;
  return Math.max(0, Math.min(
    MAX_CONFIGURABLE_REQUEST_RUNTIME_MS,
    Math.floor(configuredTimeoutMs),
    Math.floor(remainingRuntimeMs)
  ));
}

function utcPeriods(now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  return {
    dayKey: dayStart.toISOString().slice(0, 10),
    dayStart,
    nextDayStart,
    monthStart,
    nextMonthStart,
    minuteStart,
    nextMinuteStart: new Date(minuteStart.getTime() + 60_000)
  };
}

function toMicros(usd: number): number {
  return Math.ceil(Math.max(0, usd) * USD_MICRO_SCALE - 1e-7);
}

function usdFromMicros(micros: number): number {
  return Math.ceil(micros) / USD_MICRO_SCALE;
}

function denied(reason: string, requestId?: string, retryAfter?: number | null): QuotaDecision {
  return { allowed: false, reason, requestId, retryAfter };
}

function requestCountWhere(userId: string | null | undefined, start: Date, end: Date) {
  return {
    ...(userId === undefined ? {} : { userId }),
    createdAt: { gte: start, lt: end },
    status: { notIn: [...SETTLEMENT_STATUSES] }
  };
}

function usageWhere(userId: string | null | undefined, start: Date, end: Date) {
  return {
    ...(userId === undefined ? {} : { userId }),
    createdAt: { gte: start, lt: end }
  };
}

function summedTokens(value: unknown): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function summedUsd(value: unknown): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function validateUsageNumber(value: number, integer: boolean): boolean {
  return Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value));
}

async function lockQuotaKey(tx: any, key: string): Promise<void> {
  // Transaction-scoped locks coordinate all API replicas and are released on
  // commit/rollback. Call paths acquire request → global day → global month → user.
  // Prisma cannot decode PostgreSQL's `void` return type. The scalar subquery
  // still acquires the lock, while the outer SELECT returns a supported int.
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS quota_lock`;
}

export function estimateCostUsd(provider: AIProviderId, totalTokens: number): number {
  // Internal estimate only; this is not provider billing or Azure infrastructure cost.
  const per1k =
    provider === 'OPENAI' ? 0.002 : provider === 'GEMINI' ? 0.001 : provider === 'OLLAMA' ? 0.0001 : 0;
  return (Math.max(0, totalTokens) / 1000) * per1k;
}

/**
 * A service factory lets tests create a fresh service instance over the same
 * database connection, proving quota decisions do not depend on process maps.
 */
export function createQuotaService(database: any = prisma as any) {
  async function checkQuota(input: {
    userId?: string | null;
    capability: AICapabilityId;
    provider?: AIProviderId;
    estimatedTokens?: number;
    estimatedCostUsd?: number;
    requestId?: string;
    correlationId?: string | null;
    now?: Date;
  }): Promise<QuotaDecision> {
    const requestId = input.requestId?.trim() || randomUUID();
    const userId = input.userId || null;
    const now = input.now ? new Date(input.now) : new Date();
    const periods = utcPeriods(now);
    const limits = getLimits();
    const estimatedTokens = input.estimatedTokens ?? 0;
    const estimatedCostUsd = input.estimatedCostUsd ??
      estimateCostUsd(input.provider || 'OPENAI', estimatedTokens);

    if (!limits) return denied('QUOTA_CONFIGURATION_INVALID', requestId);
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0 ||
        !validateUsageNumber(estimatedCostUsd, false)) {
      return denied('QUOTA_ESTIMATE_INVALID', requestId);
    }

    const reservedCost = usdFromMicros(toMicros(estimatedCostUsd));
    const userLockId = userId || 'anonymous';

    try {
      return await database.$transaction(async (tx: any) => {
        await lockQuotaKey(tx, `scrolitha-ai-request:${requestId}`);
        await lockQuotaKey(tx, `scrolitha-ai-global:${periods.dayKey}`);
        await lockQuotaKey(tx, `scrolitha-ai-global-month:${periods.monthStart.toISOString().slice(0, 7)}`);
        await lockQuotaKey(tx, `scrolitha-ai-user:${userLockId}`);

        const duplicate = await tx.aIUsageLedger.findFirst({
          where: { requestId },
          select: { id: true }
        });
        if (duplicate) return denied('REQUEST_ALREADY_ACCOUNTED', requestId);

        const dailyRequests = await tx.aIUsageLedger.count({
          where: requestCountWhere(userId, periods.dayStart, periods.nextDayStart)
        });
        if (dailyRequests >= limits.dailyRequestsPerUser) {
          return denied('DAILY_REQUEST_QUOTA_EXCEEDED', requestId, 3600);
        }

        const requestsThisMinute = await tx.aIUsageLedger.count({
          where: requestCountWhere(userId, periods.minuteStart, periods.nextMinuteStart)
        });
        if (requestsThisMinute >= limits.ratePerMinute) {
          return denied('RATE_LIMIT_EXCEEDED', requestId, 60);
        }

        const monthUsage = await tx.aIUsageLedger.aggregate({
          where: usageWhere(userId, periods.monthStart, periods.nextMonthStart),
          _sum: { totalTokens: true, estimatedCostUsd: true }
        });
        const monthlyTokens = summedTokens(monthUsage._sum.totalTokens);
        const monthlyCostMicros = toMicros(summedUsd(monthUsage._sum.estimatedCostUsd));

        if (monthlyTokens + estimatedTokens > limits.monthlyTokensPerUser) {
          return denied('MONTHLY_TOKEN_CEILING_EXCEEDED', requestId);
        }
        const globalMonthlyRequests = await tx.aIUsageLedger.count({
          // Each durable reservation consumes one global monthly request slot.
          // Settlement rows are excluded by requestCountWhere.
          where: requestCountWhere(undefined, periods.monthStart, periods.nextMonthStart)
        });
        if (globalMonthlyRequests >= limits.globalMonthlyRequests) {
          return denied('GLOBAL_MONTHLY_REQUEST_LIMIT_EXCEEDED', requestId);
        }
        const globalMonthUsage = await tx.aIUsageLedger.aggregate({
          // Omit the user predicate so authenticated and anonymous requests
          // reserve against one global UTC calendar-month ceiling.
          where: usageWhere(undefined, periods.monthStart, periods.nextMonthStart),
          _sum: { totalTokens: true }
        });
        const globalMonthlyTokens = summedTokens(globalMonthUsage._sum.totalTokens);
        if (globalMonthlyTokens + estimatedTokens > limits.globalMonthlyTokens) {
          return denied('GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED', requestId);
        }
        if (monthlyCostMicros + toMicros(reservedCost) > toMicros(limits.monthlyBudgetUsdPerUser)) {
          return denied('MONTHLY_AI_BUDGET_EXCEEDED', requestId);
        }

        const globalUsage = await tx.aIUsageLedger.aggregate({
          // undefined intentionally omits the user predicate so this is a
          // true all-user daily limit; null would count only anonymous usage.
          where: usageWhere(undefined, periods.dayStart, periods.nextDayStart),
          _sum: { estimatedCostUsd: true }
        });
        const globalCostMicros = toMicros(summedUsd(globalUsage._sum.estimatedCostUsd));
        if (globalCostMicros + toMicros(reservedCost) > toMicros(limits.globalDailyBudgetUsd)) {
          return denied('GLOBAL_AI_BUDGET_EXCEEDED', requestId);
        }

        const activeSince = new Date(now.getTime() - MAX_REQUEST_LEASE_MS);
        const activeReservations = await tx.aIUsageLedger.findMany({
          where: {
            userId,
            status: 'RESERVED',
            createdAt: { gte: activeSince, lte: now },
            requestId: { not: null }
          },
          select: { requestId: true }
        });
        const activeRequestIds = [...new Set(
          activeReservations.map((row: { requestId: string | null }) => row.requestId).filter(Boolean)
        )] as string[];
        let activeCount = 0;
        if (activeRequestIds.length) {
          const settled = await tx.aIUsageLedger.findMany({
            where: {
              requestId: { in: activeRequestIds },
              status: { in: [...SETTLEMENT_STATUSES] }
            },
            select: { requestId: true },
            distinct: ['requestId']
          });
          const settledIds = new Set(settled.map((row: { requestId: string | null }) => row.requestId));
          activeCount = activeRequestIds.filter((id) => !settledIds.has(id)).length;
        }
        if (activeCount >= limits.concurrencyPerUser) {
          return denied('CONCURRENCY_LIMIT_EXCEEDED', requestId, 5);
        }

        await tx.aIUsageLedger.create({
          data: {
            userId,
            capability: input.capability,
            provider: 'RESERVATION',
            model: 'quota-reservation',
            promptTokens: estimatedTokens,
            completionTokens: 0,
            totalTokens: estimatedTokens,
            estimatedCostUsd: reservedCost,
            status: 'RESERVED',
            correlationId: input.correlationId || null,
            requestId,
            createdAt: now
          }
        });

        return {
          allowed: true,
          requestId,
          remaining: {
            dailyRequests: Math.max(0, limits.dailyRequestsPerUser - dailyRequests - 1),
            monthlyTokens: Math.max(0, limits.monthlyTokensPerUser - monthlyTokens - estimatedTokens),
            globalMonthlyTokens: Math.max(0, limits.globalMonthlyTokens - globalMonthlyTokens - estimatedTokens),
            globalMonthlyRequests: Math.max(0, limits.globalMonthlyRequests - globalMonthlyRequests - 1),
            maxRequestRuntimeMs: limits.maxRequestRuntimeMs,
            monthlyBudgetUsd: Math.max(0, limits.monthlyBudgetUsdPerUser -
              usdFromMicros(monthlyCostMicros + toMicros(reservedCost))),
            globalDailyBudgetUsd: Math.max(0, limits.globalDailyBudgetUsd -
              usdFromMicros(globalCostMicros + toMicros(reservedCost)))
          }
        };
      });
    } catch {
      // Never permit provider execution when quota persistence or locking fails.
      return denied('QUOTA_PERSISTENCE_UNAVAILABLE', requestId);
    }
  }

  async function recordUsage(input: {
    userId?: string | null;
    capability: AICapabilityId;
    provider: AIProviderId;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    usageKnown?: boolean;
    correlationId?: string | null;
    requestId?: string | null;
    status: string;
  }): Promise<UsageSettlement> {
    const requestId = input.requestId?.trim();
    if (!requestId) throw new Error('USAGE_PERSISTENCE_UNAVAILABLE');

    try {
      return await database.$transaction(async (tx: any) => {
        const candidates = await tx.aIUsageLedger.findMany({
          where: { requestId, status: 'RESERVED' },
          take: 2
        });
        if (candidates.length !== 1) {
          const alreadySettled = await tx.aIUsageLedger.findFirst({
            where: { requestId, status: { in: [...SETTLEMENT_STATUSES] } },
            select: { id: true }
          });
          if (alreadySettled && candidates.length === 0) {
            return { withinLimits: true, duplicate: true };
          }
          throw new Error('reservation missing or ambiguous');
        }

        const reservation = candidates[0];
        const reservationTime = new Date(reservation.createdAt);
        const periods = utcPeriods(reservationTime);
        const userId = reservation.userId || null;
        const userLockId = userId || 'anonymous';
        if (input.userId && input.userId !== userId) {
          throw new Error('reservation owner mismatch');
        }

        await lockQuotaKey(tx, `scrolitha-ai-request:${requestId}`);
        await lockQuotaKey(tx, `scrolitha-ai-global:${periods.dayKey}`);
        await lockQuotaKey(tx, `scrolitha-ai-global-month:${periods.monthStart.toISOString().slice(0, 7)}`);
        await lockQuotaKey(tx, `scrolitha-ai-user:${userLockId}`);

        const existingSettlement = await tx.aIUsageLedger.findFirst({
          where: { requestId, status: { in: [...SETTLEMENT_STATUSES] } },
          select: { id: true }
        });
        if (existingSettlement) return { withinLimits: true, duplicate: true };

        const hasUsageMetrics = input.totalTokens !== undefined ||
          input.promptTokens !== undefined || input.completionTokens !== undefined;
        const providerHasKnownZeroUsage = input.provider === 'NATIVE' || input.provider === 'MOCK';
        const usageKnown = input.usageKnown ??
          (hasUsageMetrics || input.estimatedCostUsd !== undefined || providerHasKnownZeroUsage);
        const measuredTokens = input.totalTokens ??
          (input.promptTokens || 0) + (input.completionTokens || 0);
        const actualTokens = usageKnown ? measuredTokens : reservation.totalTokens;
        const measuredCost = input.estimatedCostUsd ??
          (usageKnown
            ? estimateCostUsd(input.provider, actualTokens)
            : Number(reservation.estimatedCostUsd));

        if (!validateUsageNumber(actualTokens, true) || !validateUsageNumber(measuredCost, false)) {
          throw new Error('invalid usage metrics');
        }

        const settlementOutcome = ['COMPLETED', 'FAILED', 'BLOCKED'].includes(input.status)
          ? input.status
          : 'FAILED';
        const tokenDelta = actualTokens - Number(reservation.totalTokens);
        const costDelta = measuredCost - Number(reservation.estimatedCostUsd);

        // Append a compensating row instead of mutating the reservation or
        // historical usage. The pair sums to actual usage for quota totals.
        await tx.aIUsageLedger.create({
          data: {
            userId,
            capability: input.capability,
            provider: input.provider,
            model: input.model,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: tokenDelta,
            estimatedCostUsd: costDelta,
            status: `SETTLEMENT_${settlementOutcome}`,
            correlationId: input.correlationId || null,
            requestId,
            createdAt: reservationTime
          }
        });

        const limits = getLimits();
        if (!limits) return { withinLimits: false, reason: 'QUOTA_CONFIGURATION_INVALID' };

        const monthUsage = await tx.aIUsageLedger.aggregate({
          where: usageWhere(userId, periods.monthStart, periods.nextMonthStart),
          _sum: { totalTokens: true, estimatedCostUsd: true }
        });
        const globalUsage = await tx.aIUsageLedger.aggregate({
          where: usageWhere(undefined, periods.dayStart, periods.nextDayStart),
          _sum: { estimatedCostUsd: true }
        });
        const globalMonthUsage = await tx.aIUsageLedger.aggregate({
          where: usageWhere(undefined, periods.monthStart, periods.nextMonthStart),
          _sum: { totalTokens: true }
        });
        const overUserTokenLimit = summedTokens(monthUsage._sum.totalTokens) > limits.monthlyTokensPerUser;
        const overGlobalMonthlyTokenLimit =
          summedTokens(globalMonthUsage._sum.totalTokens) > limits.globalMonthlyTokens;
        const overUserBudget = toMicros(summedUsd(monthUsage._sum.estimatedCostUsd)) >
          toMicros(limits.monthlyBudgetUsdPerUser);
        const overGlobalBudget = toMicros(summedUsd(globalUsage._sum.estimatedCostUsd)) >
          toMicros(limits.globalDailyBudgetUsd);

        if (overUserTokenLimit) return { withinLimits: false, reason: 'MONTHLY_TOKEN_CEILING_EXCEEDED' };
        if (overGlobalMonthlyTokenLimit) {
          return { withinLimits: false, reason: 'GLOBAL_MONTHLY_TOKEN_CEILING_EXCEEDED' };
        }
        if (overUserBudget) return { withinLimits: false, reason: 'MONTHLY_AI_BUDGET_EXCEEDED' };
        if (overGlobalBudget) return { withinLimits: false, reason: 'GLOBAL_AI_BUDGET_EXCEEDED' };
        return { withinLimits: true };
      });
    } catch {
      // Keep the reservation untouched on rollback and do not return generated
      // output to the caller when its durable usage record could not be saved.
      throw new Error('USAGE_PERSISTENCE_UNAVAILABLE');
    }
  }

  async function getUsageSummary(userId: string) {
    const now = new Date();
    const periods = utcPeriods(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const lastThirtyDaysEnd = now;

    const [todayRequests, todayUsage, monthRequests, monthUsage, lastThirtyRequests, lastThirtyUsage] =
      await Promise.all([
        database.aIUsageLedger.count({
          where: requestCountWhere(userId, periods.dayStart, periods.nextDayStart)
        }),
        database.aIUsageLedger.aggregate({
          where: usageWhere(userId, periods.dayStart, periods.nextDayStart),
          _sum: { totalTokens: true, estimatedCostUsd: true }
        }),
        database.aIUsageLedger.count({
          where: requestCountWhere(userId, periods.monthStart, periods.nextMonthStart)
        }),
        database.aIUsageLedger.aggregate({
          where: usageWhere(userId, periods.monthStart, periods.nextMonthStart),
          _sum: { totalTokens: true, estimatedCostUsd: true }
        }),
        database.aIUsageLedger.count({
          where: requestCountWhere(userId, thirtyDaysAgo, lastThirtyDaysEnd)
        }),
        database.aIUsageLedger.aggregate({
          where: usageWhere(userId, thirtyDaysAgo, lastThirtyDaysEnd),
          _sum: { totalTokens: true, estimatedCostUsd: true }
        })
      ]);

    const recentRows = await database.aIUsageLedger.findMany({
      where: {
        userId,
        createdAt: { gte: thirtyDaysAgo, lt: lastThirtyDaysEnd },
        status: { notIn: [...SETTLEMENT_STATUSES] }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    const requestIds = recentRows.map((row: any) => row.requestId).filter(Boolean);
    const settlements = requestIds.length
      ? await database.aIUsageLedger.findMany({
          where: { requestId: { in: requestIds }, status: { in: [...SETTLEMENT_STATUSES] } },
          orderBy: { createdAt: 'desc' }
        })
      : [];
    const settlementByRequest = new Map<string, any>();
    for (const settlement of settlements) {
      if (settlement.requestId && !settlementByRequest.has(settlement.requestId)) {
        settlementByRequest.set(settlement.requestId, settlement);
      }
    }

    const monthlyTokens = summedTokens(monthUsage._sum.totalTokens);
    const monthlyCost = summedUsd(monthUsage._sum.estimatedCostUsd);
    const limits = getLimits();
    if (!limits) throw new Error('QUOTA_CONFIGURATION_INVALID');

    return {
      today: {
        requests: todayRequests,
        tokens: summedTokens(todayUsage._sum.totalTokens),
        estimatedCostUsd: summedUsd(todayUsage._sum.estimatedCostUsd)
      },
      thisMonth: {
        requests: monthRequests,
        tokens: monthlyTokens,
        estimatedCostUsd: monthlyCost
      },
      last30Days: {
        requests: lastThirtyRequests,
        tokens: summedTokens(lastThirtyUsage._sum.totalTokens),
        estimatedCostUsd: summedUsd(lastThirtyUsage._sum.estimatedCostUsd)
      },
      limits: {
        dailyRequests: limits.dailyRequestsPerUser,
        monthlyTokens: limits.monthlyTokensPerUser,
        globalMonthlyTokens: limits.globalMonthlyTokens,
        globalMonthlyRequests: limits.globalMonthlyRequests,
        monthlyBudgetUsd: limits.monthlyBudgetUsdPerUser,
        globalDailyBudgetUsd: limits.globalDailyBudgetUsd,
        maxRequestRuntimeMs: limits.maxRequestRuntimeMs,
        ratePerMinute: limits.ratePerMinute,
        concurrency: limits.concurrencyPerUser
      },
      recent: recentRows.map((row: any) => {
        const settlement = row.requestId ? settlementByRequest.get(row.requestId) : undefined;
        const tokenCount = Number(row.totalTokens || 0) + Number(settlement?.totalTokens || 0);
        const cost = Number(row.estimatedCostUsd || 0) + Number(settlement?.estimatedCostUsd || 0);
        return {
          id: row.id,
          capability: row.capability,
          provider: settlement?.provider || row.provider,
          model: settlement?.model || row.model,
          totalTokens: tokenCount,
          status: settlement ? String(settlement.status).replace(/^SETTLEMENT_/, '') : row.status,
          createdAt: row.createdAt,
          estimatedCostUsd: cost
        };
      })
    };
  }

  return { checkQuota, recordUsage, getUsageSummary };
}

const quotaService = createQuotaService();

// Retained for existing lifecycle instrumentation. Enforcement is durable in
// checkQuota and does not depend on this per-process observation map.
const inflight = new Map<string, number>();

export function beginRequest(userId?: string | null): void {
  const uid = userId || 'anonymous';
  inflight.set(uid, (inflight.get(uid) || 0) + 1);
}

export function endRequest(userId?: string | null): void {
  const uid = userId || 'anonymous';
  inflight.set(uid, Math.max(0, (inflight.get(uid) || 1) - 1));
}

export const checkQuota = quotaService.checkQuota;
export const recordUsage = quotaService.recordUsage;
export const getUsageSummary = quotaService.getUsageSummary;

export default {
  checkQuota,
  beginRequest,
  endRequest,
  recordUsage,
  getUsageSummary,
  estimateCostUsd,
  getMaxAiRequestRuntimeMs,
  boundProviderTimeoutMs,
  createQuotaService
};
