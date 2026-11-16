import bcrypt from 'bcryptjs';
import { login, getCurrentUser } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import prisma from '../utils/prismaClient';
import { issueAuthSessionToken, resolveAuthSessionToken } from '../services/authSession.service';

jest.mock('../utils/humanVerificationGate', () => ({
  enforceHumanVerification: jest.fn().mockResolvedValue(true)
}));

jest.mock('../utils/prismaClient', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    staffUser: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    authAuditLog: {
      create: jest.fn()
    }
  };

  return {
    __esModule: true,
    default: mockPrisma
  };
});

jest.mock('../services/authSession.service', () => ({
  AuthSessionIssueError: class AuthSessionIssueError extends Error {},
  issueAuthSessionToken: jest.fn().mockResolvedValue('synthetic-durable-session-token'),
  issueAuthSessionTokenInTransaction: jest.fn(),
  resolveAuthSessionToken: jest.fn(),
  revokeAuthSession: jest.fn(),
  revokeAllAuthSessionsInTransaction: jest.fn()
}));

jest.mock('../controllers/admin2fa.controller', () => ({
  evaluateAdmin2FAGate: jest.fn().mockResolvedValue({ required: false })
}));

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  staffUser: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res;
};

const createUser = async (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  authSessionVersion: 0,
  email: 'valid@example.com',
  name: 'Valid User',
  username: 'validuser',
  role: 'EMPLOYER',
  isActive: true,
  passwordHash: await bcrypt.hash('correct-password', 4),
  followOnboardingRequired: false,
  followOnboardingCompletedAt: null,
  ...overrides
});

describe('auth login controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'dev_jwt_secret';
    mockPrisma.staffUser.findUnique.mockResolvedValue(null);
    mockPrisma.user.update.mockResolvedValue({});
    (issueAuthSessionToken as jest.Mock).mockResolvedValue('synthetic-durable-session-token');
    (resolveAuthSessionToken as jest.Mock).mockReset();
  });

  test('missing login fields returns 400', async () => {
    const res = createResponse();

    await login({ body: { email: 'valid@example.com' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'MISSING_CREDENTIALS' })
    );
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('unknown user returns 401 instead of 500', async () => {
    const res = createResponse();
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await login({ body: { email: 'missing@example.com', password: 'wrong-password' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'INVALID_CREDENTIALS' })
    );
  });

  test('authentication failure logs contain no identifier or credential values', async () => {
    const res = createResponse();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const identifier = 'sensitive-login@example.invalid';
    const password = 'SensitivePassword123!';
    mockPrisma.user.findUnique.mockRejectedValue(new Error(`database failure email=${identifier} password=${password}`));

    await login({ body: { email: identifier, password } } as any, res as any);

    const output = [
      ...log.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls
    ].flat().map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    expect(output).not.toContain(identifier);
    expect(output).not.toContain(password);
    expect(output).not.toContain('database failure');
    expect(output).toContain('database_error');
    expect(res.status).toHaveBeenCalledWith(500);

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  test('user with missing password hash returns 401 instead of 500', async () => {
    const res = createResponse();
    mockPrisma.user.findUnique.mockResolvedValue(await createUser({ passwordHash: null }));

    await login({ body: { email: 'valid@example.com', password: 'wrong-password' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'INVALID_CREDENTIALS' })
    );
  });

  test('existing user with wrong password returns 401 instead of 500', async () => {
    const res = createResponse();
    mockPrisma.user.findUnique.mockResolvedValue(await createUser());

    await login({ body: { email: 'valid@example.com', password: 'wrong-password' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'INVALID_CREDENTIALS' })
    );
    expect(mockPrisma.staffUser.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('disabled user returns 403', async () => {
    const res = createResponse();
    mockPrisma.user.findUnique.mockResolvedValue(await createUser({ isActive: false }));

    await login({ body: { email: 'valid@example.com', password: 'correct-password' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'ACCOUNT_DISABLED' })
    );
  });

  test('successful login returns token, accessToken, and user', async () => {
    const res = createResponse();
    mockPrisma.user.findUnique.mockResolvedValue(await createUser());

    await login({ body: { email: 'valid@example.com', password: 'correct-password' } } as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.token).toEqual(expect.any(String));
    expect(payload.accessToken).toBe(payload.token);
    expect(issueAuthSessionToken).toHaveBeenCalledWith('user-1', 0);
    expect(payload.user).toEqual(expect.objectContaining({ id: 'user-1', email: 'valid@example.com' }));
    expect(res.cookie).toHaveBeenCalledWith('Scrolith_token', payload.token, expect.any(Object));
  });

  test('/auth/me accepts Bearer token and returns the current user', async () => {
    const token = 'synthetic-durable-session-token';
    (resolveAuthSessionToken as jest.Mock).mockResolvedValue({
      sessionId: 'session-row-1',
      userId: 'user-1',
      sessionVersion: 0,
      user: { id: 'user-1', email: 'valid@example.com', role: 'EMPLOYER', isActive: true }
    });
    mockPrisma.user.findUnique.mockResolvedValue(await createUser());

    const req: any = {
      headers: { authorization: `Bearer ${token}` }
    };
    const authRes = createResponse();
    const next = jest.fn();

    await authMiddleware(req, authRes as any, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ id: 'user-1' }));

    const meRes = createResponse();
    await getCurrentUser(req, meRes as any);

    expect(meRes.status).toHaveBeenCalledWith(200);
    expect(meRes.json).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: 'user-1', email: 'valid@example.com' })
    });
  });

  test('rejects a token marked revoked by the durable session store', async () => {
    (resolveAuthSessionToken as jest.Mock).mockResolvedValue(null);
    const req: any = { headers: { authorization: 'Bearer synthetic-revoked-token' } };
    const res = createResponse();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('fails closed when the durable session store is unavailable', async () => {
    (resolveAuthSessionToken as jest.Mock).mockRejectedValue(new Error('synthetic database failure'));
    const req: any = { headers: { authorization: 'Bearer synthetic-session-token' } };
    const res = createResponse();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
