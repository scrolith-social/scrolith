/** Short-lived, single-use social-login completion codes stored by hash. */

import crypto from 'crypto';
import prisma from '../utils/prismaClient';
import { issueAuthSessionTokenInTransaction } from './authSession.service';

const EXCHANGE_TTL_MS = Math.max(30_000, Number(process.env.OAUTH_EXCHANGE_TTL_MS || 90_000));
const hashCode = (code: string) =>
  crypto.createHash('sha256').update(`oauth-exchange:${code}`).digest('hex');

export type OAuthExchangeCreateResult = { code: string; expiresAt: Date };

export const createOAuthExchangeCode = async (input: { userId: string }): Promise<OAuthExchangeCreateResult> => {
  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + EXCHANGE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string; isActive: boolean; authSessionVersion: number }>>`
      SELECT "id", "isActive", "authSessionVersion"
      FROM "User"
      WHERE "id" = ${input.userId}
      FOR UPDATE
    `;
    const user = users[0];
    if (!user || !user.isActive) throw new Error('Account unavailable');
    await tx.oAuthExchangeCode.create({
      data: {
        userId: user.id,
        codeHash: hashCode(code),
        authSessionVersion: user.authSessionVersion,
        expiresAt
      }
    });
  });
  return { code, expiresAt };
};

export type OAuthExchangeConsumeResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; error: string; status: number };

export const consumeOAuthExchangeCode = async (rawCode: unknown): Promise<OAuthExchangeConsumeResult> => {
  const code = String(rawCode || '').trim();
  if (!code || code.length < 20 || code.length > 200) {
    return { ok: false, error: 'Invalid exchange code', status: 400 };
  }

  return prisma.$transaction(async (tx): Promise<OAuthExchangeConsumeResult> => {
    const row = await tx.oAuthExchangeCode.findUnique({
      where: { codeHash: hashCode(code) },
      include: { user: { select: { id: true, isActive: true, authSessionVersion: true } } }
    });
    if (!row) return { ok: false, error: 'Invalid or expired exchange code', status: 400 };
    if (row.usedAt) return { ok: false, error: 'Exchange code already used', status: 400 };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, error: 'Exchange code expired', status: 400 };
    if (!row.user || !row.user.isActive) return { ok: false, error: 'Account unavailable', status: 403 };

    // Lock the user row so all-device logout/password reset cannot race this
    // one-time exchange and mint a session from a stale session version.
    const users = await tx.$queryRaw<Array<{ id: string; isActive: boolean; authSessionVersion: number }>>`
      SELECT "id", "isActive", "authSessionVersion"
      FROM "User"
      WHERE "id" = ${row.userId}
      FOR UPDATE
    `;
    const currentUser = users[0];
    if (!currentUser || !currentUser.isActive || currentUser.authSessionVersion !== row.authSessionVersion) {
      return { ok: false, error: 'Exchange code was invalidated', status: 401 };
    }

    const marked = await tx.oAuthExchangeCode.updateMany({
      where: { id: row.id, usedAt: null, authSessionVersion: currentUser.authSessionVersion },
      data: { usedAt: new Date() }
    });
    if (marked.count !== 1) return { ok: false, error: 'Exchange code already used', status: 400 };

    const token = await issueAuthSessionTokenInTransaction(tx, row.userId);
    return { ok: true, token, userId: row.userId };
  });
};

export const invalidateUserOAuthExchangeCodes = async (userId: string): Promise<number> => {
  if (!userId) return 0;
  const result = await prisma.oAuthExchangeCode.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() }
  });
  return result.count;
};
