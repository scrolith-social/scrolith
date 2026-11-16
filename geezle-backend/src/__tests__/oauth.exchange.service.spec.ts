/** OAuth exchange codes are single-use and mint a persisted first-party session. */
import crypto from 'crypto';

const mockCreate = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdateMany = jest.fn();
const mockQueryRaw = jest.fn();
const mockAuthSessionCreate = jest.fn();

const mockTx = {
  $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  oAuthExchangeCode: {
    create: (...args: any[]) => mockCreate(...args),
    findUnique: (...args: any[]) => mockFindUnique(...args),
    updateMany: (...args: any[]) => mockUpdateMany(...args)
  },
  authSession: {
    create: (...args: any[]) => mockAuthSessionCreate(...args)
  }
};

jest.mock('../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    ...mockTx,
    $transaction: (operation: (tx: typeof mockTx) => unknown) => operation(mockTx)
  }
}));

import {
  consumeOAuthExchangeCode,
  createOAuthExchangeCode
} from '../services/oauthExchange.service';

describe('oauthExchange.service', () => {
  const originalEnv = { ...process.env };
  const activeUser = { id: 'u1', isActive: true, authSessionVersion: 0 };

  const exchangeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'row1',
    userId: activeUser.id,
    codeHash: 'stored-code-hash',
    authSessionVersion: activeUser.authSessionVersion,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { ...activeUser },
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-for-oauth-exchange';
    process.env.JWT_EXPIRES_IN = '1h';
    mockQueryRaw.mockResolvedValue([activeUser]);
    mockCreate.mockResolvedValue({ id: 'row1' });
    mockAuthSessionCreate.mockResolvedValue({ id: 'session-1' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('creation stores a namespaced code hash and the current session version', async () => {
    const result = await createOAuthExchangeCode({ userId: activeUser.id });

    expect(result.code).toBeTruthy();
    expect(result.code.includes('.')).toBe(false); // not a JWT
    expect(result.code.length).toBeGreaterThanOrEqual(32);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const createData = mockCreate.mock.calls[0][0].data;
    const expectedHash = crypto
      .createHash('sha256')
      .update(`oauth-exchange:${result.code}`)
      .digest('hex');
    expect(createData).toEqual(expect.objectContaining({
      userId: activeUser.id,
      codeHash: expectedHash,
      authSessionVersion: activeUser.authSessionVersion,
      expiresAt: result.expiresAt
    }));
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('consume rejects missing / short codes', async () => {
    const empty = await consumeOAuthExchangeCode('');
    const short = await consumeOAuthExchangeCode('short');

    expect(empty.ok).toBe(false);
    expect(short.ok).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('consume rejects unknown code', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await consumeOAuthExchangeCode('a'.repeat(40));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringMatching(/Invalid|expired/i)
    }));
  });

  test('consume rejects already used code (replay)', async () => {
    mockFindUnique.mockResolvedValue(exchangeRow({ usedAt: new Date() }));
    const result = await consumeOAuthExchangeCode('a'.repeat(40));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringMatching(/already used/i)
    }));
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test('consume rejects expired code', async () => {
    mockFindUnique.mockResolvedValue(exchangeRow({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await consumeOAuthExchangeCode('a'.repeat(40));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringMatching(/expired/i)
    }));
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test('consume success marks code single-use and persists a session JWT', async () => {
    mockFindUnique.mockResolvedValue(exchangeRow());
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await consumeOAuthExchangeCode('a'.repeat(40));

    expect(result.ok).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      userId: activeUser.id,
      token: expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/)
    }));
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'row1',
        usedAt: null,
        authSessionVersion: activeUser.authSessionVersion
      },
      data: { usedAt: expect.any(Date) }
    });
    expect(mockAuthSessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: activeUser.id,
        tokenIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date)
      })
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  test('consume race on single-use returns already used without minting a session', async () => {
    mockFindUnique.mockResolvedValue(exchangeRow());
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await consumeOAuthExchangeCode('a'.repeat(40));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringMatching(/already used/i)
    }));
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  test('password-reset style hash is not found as an OAuth exchange code', async () => {
    mockFindUnique.mockResolvedValue(null);
    const resetToken = 'reset-token-value-abcdefghijklmnopqrstuvwxyz';

    const result = await consumeOAuthExchangeCode(resetToken);

    expect(result.ok).toBe(false);
    const lookupHash = mockFindUnique.mock.calls[0][0].where.codeHash as string;
    const expectedHash = crypto
      .createHash('sha256')
      .update(`oauth-exchange:${resetToken}`)
      .digest('hex');
    expect(lookupHash).toBe(expectedHash);
  });
});
