import { createServer, Server as HttpServer } from 'http';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { io as SocketClient, Socket } from 'socket.io-client';
import jwt, { JwtPayload } from 'jsonwebtoken';
import initSocket from '../../realtime/socket';
import { resetPassword } from '../../controllers/auth.controller';
import { verify2FALogin } from '../../controllers/admin2fa.controller';
import authRoutes from '../../routes/auth.routes';
import oauthDevRoutes from '../../routes/oauth.dev.routes';
import { issueAuthSessionToken, revokeAllAuthSessionsInTransaction } from '../../services/authSession.service';
import { hashSensitiveValue } from '../../services/developerPlatform.service';
import { consumeApprovedLogin } from '../../services/loginApproval.service';
import { createOAuthExchangeCode, consumeOAuthExchangeCode } from '../../services/oauthExchange.service';
import prisma from '../../utils/prismaClient';

jest.mock('../../utils/humanVerificationGate', () => ({
  enforceHumanVerification: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../services/totp.service', () => ({
  buildOtpAuthUri: jest.fn(),
  generateBackupCodes: jest.fn(() => []),
  generateBase32Secret: jest.fn(),
  hashBackupCode: jest.fn((value: string) => `synthetic:${value}`),
  verifyTotp: jest.fn(() => true)
}));

jest.setTimeout(60_000);

const assertDisposableLoopbackDatabase = () => {
  const raw = String(process.env.DATABASE_URL || '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Auth session integration requires an explicit disposable local DATABASE_URL.');
  }
  const dbName = parsed.pathname.replace(/^\/+/, '').toLowerCase();
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = String(process.env.TEST_DB_KIND || '');
  const approvedKind = ['local-postgres', 'local-disposable'].includes(kind);
  const expectedInstance = kind === 'local-postgres' ? 'local-postgres-test' : 'local-disposable-postgres-test';
  const expectedPort = Number(process.env.TEST_DB_PORT || 0);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) ||
      !dbName.includes('test') && !dbName.includes('e2e') ||
      !approvedKind || !expectedPort || Number(parsed.port) !== expectedPort ||
      process.env.TEST_DB_PROJECT !== 'local-only' ||
      process.env.TEST_DB_INSTANCE !== expectedInstance ||
      process.env.TEST_DB_NAME !== dbName ||
      process.env.DISABLE_BACKGROUND_WORKERS !== 'true') {
    throw new Error('Auth session integration refuses non-loopback or unmarked databases.');
  }
};

const testApp = express();
testApp.use(express.json());
testApp.use('/api/auth', authRoutes);
testApp.use('/api/oauth', oauthDevRoutes);

describe('durable auth session revocation integration', () => {
  let userId = '';
  let developerUserId = '';
  let email = '';
  const previousDeveloperPepper = process.env.DEV_PLATFORM_HASH_PEPPER;
  const activeSockets: Socket[] = [];
  const socketServers: Array<{ io: ReturnType<typeof initSocket>; http: HttpServer }> = [];
  const challengeScopes: string[] = [];
  const previousSocketRevalidate = process.env.AUTH_SOCKET_REVALIDATE_MS;

  beforeAll(async () => {
    assertDisposableLoopbackDatabase();
    process.env.DEV_PLATFORM_HASH_PEPPER = `synthetic-auth-test-${crypto.randomBytes(32).toString('hex')}`;
    process.env.AUTH_SOCKET_REVALIDATE_MS = '1000';
    email = `auth-session-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test`;
    const user = await prisma.user.create({
      data: { email, name: 'Synthetic Auth Session Test', role: 'USER', isActive: true }
    });
    userId = user.id;
  });

  afterAll(async () => {
    for (const client of activeSockets) {
      try { client.disconnect(); } catch { /* best-effort test cleanup */ }
    }
    await Promise.all(socketServers.map(async ({ io, http }) => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    }));
    if (challengeScopes.length) {
      await prisma.appSetting.deleteMany({ where: { scope: { in: challengeScopes } } });
    }
    if (developerUserId) await prisma.developerUser.deleteMany({ where: { id: developerUserId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (previousSocketRevalidate === undefined) delete process.env.AUTH_SOCKET_REVALIDATE_MS;
    else process.env.AUTH_SOCKET_REVALIDATE_MS = previousSocketRevalidate;
    if (previousDeveloperPepper === undefined) delete process.env.DEV_PLATFORM_HASH_PEPPER;
    else process.env.DEV_PLATFORM_HASH_PEPPER = previousDeveloperPepper;
    await prisma.$disconnect();
  });

  const newSession = () => issueAuthSessionToken(userId);
  const protectedGet = (token: string) => request(testApp).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  test('logout revokes only that bearer session; another device stays active', async () => {
    const tokenA = await newSession();
    const tokenB = await newSession();
    expect((await protectedGet(tokenA)).status).toBe(200);
    expect((await protectedGet(tokenB)).status).toBe(200);

    expect((await request(testApp).post('/api/auth/logout').set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    expect((await protectedGet(tokenA)).status).toBe(401);
    expect((await protectedGet(tokenB)).status).toBe(200);
  });

  test('logout-all revokes all active sessions and invalidates outstanding OAuth exchange codes', async () => {
    const tokenA = await newSession();
    const tokenB = await newSession();
    const pendingOAuth = await createOAuthExchangeCode({ userId });
    const approvalToken = crypto.randomBytes(32).toString('base64url');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { authSessionVersion: true } });
    const approval = await prisma.loginApprovalAttempt.create({
      data: {
        userId,
        authSessionVersion: user.authSessionVersion,
        requestedDeviceId: 'synthetic-pending-device',
        approvalTokenHash: crypto.createHash('sha256').update(approvalToken).digest('hex'),
        status: 'APPROVED',
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const response = await request(testApp).post('/api/auth/logout-all').set('Authorization', `Bearer ${tokenA}`);
    expect(response.status).toBe(200);
    expect((await protectedGet(tokenA)).status).toBe(401);
    expect((await protectedGet(tokenB)).status).toBe(401);
    // OAuth token endpoints report an invalidated/expired exchange code as
    // invalid_grant-style input (HTTP 400); the important invariant is that it
    // cannot mint another authenticated session after logout-all.
    expect(await consumeOAuthExchangeCode(pendingOAuth.code)).toMatchObject({ ok: false, status: 400 });
    await expect(consumeApprovedLogin(approval.id, approvalToken)).rejects.toThrow(/invalid|available/i);
  });

  test('OAuth refresh-token reuse is rejected after the user explicitly revokes the grant', async () => {
    const developerUser = await prisma.developerUser.create({
      data: { developerEmail: `oauth-revoke-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@local.test`, userId }
    });
    developerUserId = developerUser.id;
    const clientId = `synthetic-client-${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const initialAccessToken = crypto.randomBytes(32).toString('base64url');
    const app = await prisma.developerApp.create({
      data: {
        ownerUserId: userId,
        developerUserId,
        name: 'Synthetic OAuth revocation test',
        clientId,
        clientSecretHash: hashSensitiveValue(clientSecret),
        status: 'ACTIVE'
      }
    });
    await prisma.oAuthToken.create({
      data: {
        appId: app.id,
        userId,
        accessTokenHash: hashSensitiveValue(initialAccessToken),
        refreshTokenHash: hashSensitiveValue(refreshToken),
        scopes: ['openid'],
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        refreshTokenExpiresAt: new Date(Date.now() + 60_000)
      }
    });

    const refreshed = await request(testApp).post('/api/oauth/token').send({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toEqual(expect.any(String));

    const revoked = await request(testApp).post('/api/oauth/revoke').send({
      client_id: clientId,
      client_secret: clientSecret,
      token: refreshToken
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ success: true, revoked: 1 });

    const replayed = await request(testApp).post('/api/oauth/token').send({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    expect(replayed.status).toBe(400);
    expect(replayed.body.error).toBe('Invalid refresh token.');
    const revokedAccess = await request(testApp)
      .get('/api/oauth/userinfo')
      .set('Authorization', `Bearer ${refreshed.body.access_token}`);
    expect(revokedAccess.status).toBe(401);
  });

  test('OAuth exchange codes are single use and mint a session backed by the shared store', async () => {
    const code = await createOAuthExchangeCode({ userId });
    const first = await consumeOAuthExchangeCode(code.code);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await protectedGet(first.token)).status).toBe(200);
    expect(await consumeOAuthExchangeCode(code.code)).toMatchObject({ ok: false, status: 400 });
  });

  test('legacy, malformed, forged, and expired bearer tokens are rejected', async () => {
    const secret = process.env.JWT_SECRET || 'local_test_jwt_secret';
    const session = await newSession();
    const payload = jwt.decode(session) as JwtPayload;
    const forged = jwt.sign(
      { id: userId, email, role: 'USER', sid: 'A'.repeat(43), sv: payload.sv },
      'synthetic-wrong-secret',
      { expiresIn: '1h' }
    );
    const legacy = jwt.sign({ id: userId, email, role: 'USER' }, secret, { expiresIn: '1h' });
    const expired = jwt.sign({ id: userId, email, role: 'USER', sid: 'A'.repeat(43), sv: 0 }, secret, { expiresIn: '-1s' });

    for (const token of ['not-a-jwt', forged, legacy, expired]) {
      expect((await protectedGet(token)).status).toBe(401);
    }
  });

  test('HTTP and Socket.IO fail closed when shared session-state reads fail', async () => {
    const token = await newSession();
    const findSession = jest.spyOn(prisma.authSession, 'findFirst').mockRejectedValue(
      new Error('synthetic shared session store outage')
    );
    try {
      const response = await protectedGet(token);
      expect(response.status).toBe(503);

      const http = createServer();
      const io = initSocket(http);
      socketServers.push({ io, http });
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(0, () => resolve());
      });
      const client = SocketClient(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: `Bearer ${token}` }
      });
      activeSockets.push(client);
      const connectionError = await new Promise<Error>((resolve, reject) => {
        client.once('connect_error', resolve);
        client.once('connect', () => reject(new Error('Socket connected while session state was unavailable')));
        setTimeout(() => reject(new Error('Socket did not fail closed promptly')), 5_000).unref();
      });
      expect(connectionError.message).toMatch(/unauthorized/i);
      expect(client.connected).toBe(false);
    } finally {
      findSession.mockRestore();
    }
  });

  test('a protected request racing logout cannot authorize requests after logout commits', async () => {
    const token = await newSession();
    const [inFlight, logoutResponse] = await Promise.all([
      protectedGet(token),
      request(testApp).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)
    ]);
    expect([200, 401]).toContain(inFlight.status);
    expect(logoutResponse.status).toBe(200);
    expect((await protectedGet(token)).status).toBe(401);
  });

  test('revocation from a second HTTP app invalidates an already-connected Socket.IO client', async () => {
    const token = await newSession();
    const http = createServer();
    const io = initSocket(http);
    io.on('connection', (socket) => {
      socket.on('auth:probe', () => socket.emit('auth:probe:accepted'));
    });
    socketServers.push({ io, http });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, () => resolve());
    });
    const port = (http.address() as AddressInfo).port;
    const client = SocketClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: `Bearer ${token}` }
    });
    activeSockets.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

    let protectedEventReachedHandler = false;
    client.on('auth:probe:accepted', () => { protectedEventReachedHandler = true; });
    const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));
    const logoutResponse = await request(testApp).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(logoutResponse.status).toBe(200);
    client.emit('auth:probe');
    await disconnected;
    expect(protectedEventReachedHandler).toBe(false);
  });

  test('shared session state remains revoked when checked through another API app instance', async () => {
    const token = await newSession();
    const secondApp = express();
    secondApp.use('/api/auth', authRoutes);
    expect((await protectedGet(token)).status).toBe(200);
    expect((await request(testApp).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(secondApp).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('password reset atomically invalidates existing bearer sessions', async () => {
    const token = await newSession();
    const resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: crypto.createHash('sha256').update(resetToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    await resetPassword({ body: { token: resetToken, password: 'SyntheticNewPassword123!' }, headers: {} } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect((await protectedGet(token)).status).toBe(401);
  });

  test('a pre-logout MFA challenge cannot create a new session after the epoch changes', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN', twoFactorEnabled: true, twoFactorSecret: 'SYNTHETIC_TOTP_SECRET' }
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { authSessionVersion: true } });
    const challengeToken = crypto.randomBytes(24).toString('hex');
    const challengeScope = `2fa_challenge_${challengeToken}`;
    challengeScopes.push(challengeScope);
    await prisma.appSetting.create({
      data: {
        scope: challengeScope,
        data: { userId, authSessionVersion: before.authSessionVersion, exp: Date.now() + 60_000, needsSetup: false }
      }
    });
    await prisma.$transaction((tx) => revokeAllAuthSessionsInTransaction(tx, userId, 'test_invalidate_mfa'));
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), cookie: jest.fn() };
    const sessionsBefore = await prisma.authSession.count({ where: { userId } });

    await verify2FALogin({ body: { challengeToken, code: '123456' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(await prisma.authSession.count({ where: { userId } })).toBe(sessionsBefore);
  });
});
