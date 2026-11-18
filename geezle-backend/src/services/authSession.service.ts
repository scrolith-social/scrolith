import crypto from 'crypto';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import prisma from '../utils/prismaClient';
import { jwtSecret } from '../utils/security/requiredSecret';

const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || '7d');
const AUTH_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
type AuthSessionTransaction = Pick<
  typeof prisma,
  '$queryRaw' | 'authSession' | 'user' | 'oAuthExchangeCode' | 'loginApprovalAttempt'
>;

export type AuthTokenPrincipal = {
  id: string;
  email: string;
  role: string;
  sid: string;
  sv: number;
  exp: number;
};

export type ResolvedAuthSession = {
  sessionId: string;
  userId: string;
  sessionVersion: number;
  user: { id: string; email: string; role: string; isActive: boolean };
};

export class AuthSessionIssueError extends Error {
  readonly code = 'AUTH_SESSION_ISSUE_FAILED';
}

const hashSessionId = (sessionId: string) =>
  crypto.createHash('sha256').update(`scrolith:first-party-session:${sessionId}`).digest('hex');

/**
 * Issue and persist a first-party JWT atomically. The random sid is never stored
 * in plaintext; the database contains only its SHA-256 lookup hash.
 */
export const issueAuthSessionTokenInTransaction = async (
  tx: AuthSessionTransaction,
  userId: string,
  expectedSessionVersion?: number
): Promise<string> => {
  const users = await tx.$queryRaw<Array<{
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    authSessionVersion: number;
  }>>`
    SELECT "id", "email", "role", "isActive", "authSessionVersion"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  const user = users[0];
  if (!user || !user.isActive) throw new AuthSessionIssueError('Account unavailable');
  if (expectedSessionVersion !== undefined && user.authSessionVersion !== expectedSessionVersion) {
    throw new AuthSessionIssueError('Authentication context expired');
  }

  const sid = crypto.randomBytes(32).toString('base64url');
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, sid, sv: user.authSessionVersion },
    jwtSecret(),
    { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'], algorithm: 'HS256' }
  );
  const claims = jwt.decode(token) as JwtPayload | null;
  if (!claims || !Number.isFinite(claims.exp)) throw new AuthSessionIssueError('Token expiry unavailable');

  await tx.authSession.create({
    data: {
      userId: user.id,
      tokenIdHash: hashSessionId(sid),
      expiresAt: new Date(claims.exp! * 1000)
    }
  });
  return token;
};

export const issueAuthSessionToken = async (userId: string, expectedSessionVersion?: number): Promise<string> =>
  prisma.$transaction((tx) => issueAuthSessionTokenInTransaction(tx, userId, expectedSessionVersion));

const isValidPrincipal = (claims: JwtPayload): claims is JwtPayload & AuthTokenPrincipal =>
  typeof claims.id === 'string' && claims.id.length > 0 &&
  typeof claims.email === 'string' && typeof claims.role === 'string' &&
  typeof claims.sid === 'string' && AUTH_SESSION_ID_PATTERN.test(claims.sid) &&
  Number.isSafeInteger(claims.sv) && Number(claims.sv) >= 0 &&
  Number.isSafeInteger(claims.exp) && Number(claims.exp) > Math.floor(Date.now() / 1000);

/** Invalid/revoked/legacy tokens return null. Database errors deliberately throw. */
export const resolveAuthSessionToken = async (rawToken: string): Promise<ResolvedAuthSession | null> => {
  let decoded: JwtPayload;
  try {
    const verified = jwt.verify(rawToken, jwtSecret(), { algorithms: ['HS256'] });
    if (!verified || typeof verified === 'string') return null;
    decoded = verified;
  } catch {
    return null;
  }
  if (!isValidPrincipal(decoded)) return null;

  const now = new Date();
  const row = await prisma.authSession.findFirst({
    where: {
      tokenIdHash: hashSessionId(decoded.sid),
      userId: decoded.id,
      revokedAt: null,
      expiresAt: { gt: now }
    },
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, email: true, role: true, isActive: true, authSessionVersion: true } }
    }
  });
  if (!row || row.user.authSessionVersion !== decoded.sv) return null;
  return {
    sessionId: row.id,
    userId: row.userId,
    sessionVersion: decoded.sv,
    user: { id: row.user.id, email: row.user.email, role: row.user.role, isActive: row.user.isActive }
  };
};

export const isAuthSessionRecordActive = async (input: {
  sessionId: string;
  userId: string;
  sessionVersion: number;
  role?: string;
}): Promise<boolean> => {
  const row = await prisma.authSession.findFirst({
    where: {
      id: input.sessionId,
      userId: input.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    },
    select: {
      user: { select: { id: true, role: true, isActive: true, authSessionVersion: true } }
    }
  });
  if (!row?.user.isActive || row.user.authSessionVersion !== input.sessionVersion) return false;
  if (input.role && String(row.user.role) !== input.role) return false;

  const staff = await prisma.staffUser.findUnique({
    where: { userId: input.userId },
    select: { status: true, role: { select: { isActive: true } } }
  });
  return !staff || (staff.status === 'ACTIVE' && staff.role.isActive);
};

/** Enforce durable revocation for an already connected Socket.IO client. */
export const attachSocketAuthSessionGuard = (socket: any): void => {
  const session = socket?.data?.authSession;
  if (!session?.sessionId || !session?.userId || !Number.isSafeInteger(session?.sessionVersion)) return;
  const role = String(socket?.data?.user?.role || '');
  const sessionRoom = `auth-session:${session.sessionId}`;
  const userRoom = `auth-user:${session.userId}`;
  socket.join(sessionRoom);
  socket.join(userRoom);

  let closing = false;
  const rejectSocket = () => {
    if (closing) return;
    closing = true;
    try { socket.disconnect(true); } catch { /* the durable session row remains revoked */ }
  };
  const check = async () => {
    if (!await isAuthSessionRecordActive({ ...session, role })) rejectSocket();
  };

  // Check every client-originated event so a revoked socket cannot continue
  // sending commands, and poll idle sockets so they are disconnected promptly.
  socket.use((_packet: unknown, next: (error?: Error) => void) => {
    void check().then(() => {
      if (closing) next(new Error('unauthorized'));
      else next();
    }).catch(() => {
      rejectSocket();
      next(new Error('unauthorized'));
    });
  });
  const pollMs = Math.max(1000, Math.min(5000, Number.parseInt(process.env.AUTH_SOCKET_REVALIDATE_MS || '2000', 10) || 2000));
  const interval = setInterval(() => { void check().catch(rejectSocket); }, pollMs);
  interval.unref?.();
  socket.once('disconnect', () => clearInterval(interval));
};

export const revokeAuthSession = async (input: {
  sessionId: string;
  userId: string;
  reason: string;
  now?: Date;
}): Promise<boolean> => {
  const result = await prisma.authSession.updateMany({
    where: { id: input.sessionId, userId: input.userId, revokedAt: null },
    data: { revokedAt: input.now || new Date(), revokeReason: input.reason.slice(0, 80) }
  });
  return result.count === 1;
};

export const revokeAllAuthSessionsInTransaction = async (
  tx: AuthSessionTransaction,
  userId: string,
  reason: string,
  now = new Date()
): Promise<number> => {
  await tx.user.update({
    where: { id: userId },
    data: { authSessionVersion: { increment: 1 }, refreshToken: null }
  });
  const sessions = await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason.slice(0, 80) }
  });
  await tx.loginApprovalAttempt.updateMany({
    where: { userId, status: { in: ['PENDING', 'APPROVED'] }, consumedAt: null },
    data: { status: 'EXPIRED' }
  });
  await tx.oAuthExchangeCode.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now }
  });
  return sessions.count;
};

export const revokeAllAuthSessions = async (userId: string, reason: string): Promise<number> =>
  prisma.$transaction((tx) => revokeAllAuthSessionsInTransaction(tx, userId, reason));

/** Retain expired revocation evidence for one day, then remove it opportunistically. */
export const pruneExpiredAuthSessions = async (now = new Date()): Promise<void> => {
  const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
  await prisma.$transaction([
    prisma.authSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.oAuthExchangeCode.deleteMany({ where: { expiresAt: { lt: cutoff } } })
  ]);
};
