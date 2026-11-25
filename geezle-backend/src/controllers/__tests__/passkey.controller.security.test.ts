import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  completePasskeyAuthentication,
  completePasskeyRegistration,
  revokePasskey
} from '../passkey.controller';
import prisma from '../../utils/prismaClient';
import { enforceHumanVerification } from '../../utils/humanVerificationGate';
import { evaluateAdmin2FAGate } from '../admin2fa.controller';
import { finishPasskeyLoginAfterMfa } from '../../services/passkeyLogin.service';
import { consumePasskeyChallenge, createPasskeyChallenge } from '../../services/passkey.service';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { safeFindUserById } from '../auth.controller';
import { generateRegistrationOptions } from '@simplewebauthn/server';

jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    authSession: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    staffUser: { findUnique: jest.fn() },
    passkeyCredential: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    passkeyChallenge: { findUnique: jest.fn() }
  }
}));

jest.mock('../../utils/humanVerificationGate', () => ({ enforceHumanVerification: jest.fn() }));
jest.mock('bcryptjs', () => ({ __esModule: true, default: { compare: jest.fn() } }));
jest.mock('../../services/passkey.service', () => ({
  PASSKEY_PURPOSE: { authentication: 'AUTHENTICATION', registration: 'REGISTRATION' },
  consumePasskeyChallenge: jest.fn(),
  createPasskeyChallenge: jest.fn(),
  decodePasskeyBytes: jest.fn(() => new Uint8Array([1, 2, 3])),
  encodePasskeyBytes: jest.fn(() => 'public-key'),
  normalizePasskeyLabel: jest.fn((value) => String(value || 'Passkey'))
}));
jest.mock('../../services/loginApproval.service', () => ({
  normalizeLoginDeviceMetadata: jest.fn((value) => value)
}));
jest.mock('../../services/passkeyLogin.service', () => ({ finishPasskeyLoginAfterMfa: jest.fn() }));
jest.mock('../admin2fa.controller', () => ({ evaluateAdmin2FAGate: jest.fn() }));
jest.mock('../auth.controller', () => ({
  getClientMeta: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'synthetic-browser' })),
  logAuthEvent: jest.fn().mockResolvedValue(undefined),
  mapUserPayload: jest.fn((user) => ({ id: user.id, email: user.email })),
  safeFindUserByEmail: jest.fn(),
  safeFindUserById: jest.fn()
}));
jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(async (input: any) => {
    const accepted = await input.expectedChallenge('synthetic-challenge');
    if (!accepted) throw new Error('challenge mismatch');
    return {
      verified: true,
      registrationInfo: {
        credential: { id: 'credential-new', publicKey: new Uint8Array([9, 8, 7]), counter: 0 },
        credentialDeviceType: 'singleDevice', credentialBackedUp: false, aaguid: 'synthetic-aaguid'
      }
    };
  }),
  verifyAuthenticationResponse: jest.fn(async (input: any) => {
    const accepted = await input.expectedChallenge('synthetic-challenge');
    if (!accepted) throw new Error('challenge mismatch');
    return {
      verified: true,
      authenticationInfo: {
        newCounter: 2,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false
      }
    };
  })
}));

const mockDb = prisma as any;
const mockHumanVerification = enforceHumanVerification as jest.Mock;
const mockMfaGate = evaluateAdmin2FAGate as jest.Mock;
const mockFinish = finishPasskeyLoginAfterMfa as jest.Mock;
const mockConsume = consumePasskeyChallenge as jest.Mock;
const mockVerify = verifyAuthenticationResponse as jest.Mock;
const mockSafeFindUserById = safeFindUserById as jest.Mock;
const mockGenerateRegistrationOptions = generateRegistrationOptions as jest.Mock;
const mockVerifyRegistration = verifyRegistrationResponse as jest.Mock;
const mockCreatePasskeyChallenge = createPasskeyChallenge as jest.Mock;
const mockBcryptCompare = bcrypt.compare as jest.Mock;

const createResponse = () => {
  const response: any = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.cookie = jest.fn().mockReturnValue(response);
  return response;
};

const makeAuthRequest = (overrides: Record<string, any> = {}) => ({
  body: {
    challengeId: 'challenge-row',
    device: { deviceId: 'device-synthetic', platform: 'web' },
    response: {
      id: 'credential-synthetic',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ challenge: 'synthetic-challenge' })).toString('base64url')
      }
    },
    ...overrides
  },
  headers: { 'user-agent': 'synthetic-browser' },
  user: undefined
} as any);

describe('passkey authentication security gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SCROLITH_PASSKEYS_ENABLED = 'true';
    mockHumanVerification.mockResolvedValue(true);
    mockMfaGate.mockResolvedValue({ required: false });
    mockFinish.mockResolvedValue({ token: 'synthetic-session', requiresLoginApproval: false });
    mockDb.passkeyCredential.findFirst.mockResolvedValue({
      id: 'passkey-row', userId: 'user-synthetic', credentialId: 'credential-synthetic',
      publicKey: 'public-key', counter: 1, transports: []
    });
    mockDb.passkeyCredential.updateMany.mockResolvedValue({ count: 1 });
    mockDb.passkeyCredential.findMany.mockResolvedValue([]);
    mockDb.passkeyCredential.findUnique.mockResolvedValue(null);
    mockDb.passkeyCredential.create.mockResolvedValue({ id: 'new-passkey' });
    mockGenerateRegistrationOptions.mockResolvedValue({ challenge: 'synthetic-challenge', rp: { id: 'scrolith.com' } });
    mockCreatePasskeyChallenge.mockResolvedValue({ id: 'registration-challenge', expiresAt: new Date(Date.now() + 120_000) });
    mockBcryptCompare.mockImplementation(async (password: string, hash: string) => password === 'correct synthetic password' && hash === 'synthetic-password-hash');
    mockDb.passkeyChallenge.findUnique.mockResolvedValue({
      challengeHash: crypto.createHash('sha256').update('synthetic-challenge').digest('hex')
    });
    mockConsume.mockResolvedValue({
      metadata: {
        loginDevice: { deviceId: 'device-synthetic', platform: 'web' },
        ip: '127.0.0.1', userAgent: 'synthetic-browser'
      }
    });
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-synthetic', email: 'synthetic@example.invalid', name: 'Synthetic User',
      username: 'synthetic', role: 'FREELANCER', isActive: true, authSessionVersion: 4,
      kycStatus: 'NOT_STARTED', isVerified: false, twoFactorEnabled: false,
      twoFactorSecret: null, twoFactorBackupCodes: [], twoFactorWaivedUntil: null
    });
    mockDb.staffUser.findUnique.mockResolvedValue(null);
    mockSafeFindUserById.mockResolvedValue({ id: 'user-synthetic', isActive: true, email: 'synthetic@example.invalid' });
    mockDb.authSession.findFirst.mockResolvedValue({ createdAt: new Date() });
  });

  test('Human Verification must pass before an authentication challenge is issued', async () => {
    mockHumanVerification.mockResolvedValue(false);
    const res = createResponse();

    await beginPasskeyAuthentication(makeAuthRequest({ email: 'synthetic@example.invalid' }), res);

    expect(mockHumanVerification).toHaveBeenCalledWith(expect.anything(), res, 'login');
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ challengeId: expect.any(String) }));
  });

  test('a verified passkey cannot bypass the required MFA challenge or issue a session', async () => {
    mockMfaGate.mockResolvedValue({ required: true, challengeToken: 'mfa-challenge' });
    const res = createResponse();

    await completePasskeyAuthentication(makeAuthRequest(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requires2FA: true, challengeToken: 'mfa-challenge' }));
    expect(res.cookie).not.toHaveBeenCalled();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  test('a verified passkey cannot bypass new-device approval', async () => {
    mockFinish.mockResolvedValue({
      requiresLoginApproval: true,
      loginApproval: { id: 'approval-id', approvalToken: 'approval-secret', expiresAt: '2030-01-01T00:00:00Z' }
    });
    const res = createResponse();

    await completePasskeyAuthentication(makeAuthRequest(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiresLoginApproval: true }));
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('a valid assertion issues a session only after both gates pass', async () => {
    const res = createResponse();

    await completePasskeyAuthentication(makeAuthRequest(), res);

    expect(mockMfaGate).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-synthetic' }), expect.objectContaining({ postMfaLoginApproval: expect.any(Object) }));
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({
      expectedRPID: 'scrolith.com',
      expectedOrigin: expect.arrayContaining(['https://scrolith.com', 'https://www.scrolith.com']),
      requireUserVerification: true
    }));
    expect(mockFinish).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith('Scrolith_token', 'synthetic-session', expect.objectContaining({ httpOnly: true }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, token: 'synthetic-session' }));
  });

  test('unknown and revoked credentials do not reach session issuance', async () => {
    mockDb.passkeyCredential.findFirst.mockResolvedValue(null);
    const res = createResponse();

    await completePasskeyAuthentication(makeAuthRequest(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSKEY_NOT_FOUND' }));
    expect(mockMfaGate).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('a remembered tile cannot authenticate a different account', async () => {
    mockConsume.mockResolvedValue({ metadata: { expectedUserId: 'different-user', loginDevice: { deviceId: 'device-synthetic' } } });
    const res = createResponse();

    await completePasskeyAuthentication(makeAuthRequest(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSKEY_ACCOUNT_MISMATCH' }));
    expect(mockMfaGate).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('passwordless enrollment requires a session authenticated within five minutes', async () => {
    mockDb.authSession.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 6 * 60 * 1000) });
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: null });
    const req: any = { user: { id: 'user-synthetic', authSessionId: 'session-synthetic' }, body: {} };
    const res = createResponse();

    await beginPasskeyRegistration(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSKEY_REAUTH_REQUIRED' }));
    expect(mockGenerateRegistrationOptions).not.toHaveBeenCalled();
  });

  test('password enrollment requires and verifies the current password before issuing WebAuthn options', async () => {
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: 'synthetic-password-hash' });
    const req: any = { user: { id: 'user-synthetic', authSessionId: 'session-synthetic' }, body: { currentPassword: 'correct synthetic password' } };
    const res = createResponse();

    await beginPasskeyRegistration(req, res);

    expect(mockBcryptCompare).toHaveBeenCalledWith('correct synthetic password', 'synthetic-password-hash');
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({ rpID: 'scrolith.com' }));
    expect(mockCreatePasskeyChallenge).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'REGISTRATION', userId: 'user-synthetic' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, challengeId: 'registration-challenge' }));
  });

  test('password enrollment is denied when the current password does not match', async () => {
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: 'synthetic-password-hash' });
    const req: any = { user: { id: 'user-synthetic', authSessionId: 'session-synthetic' }, body: { currentPassword: 'incorrect synthetic password' } };
    const res = createResponse();

    await beginPasskeyRegistration(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSKEY_REAUTH_REQUIRED' }));
    expect(mockGenerateRegistrationOptions).not.toHaveBeenCalled();
  });

  test('verified registration stores the public credential on the server after fresh-auth challenge consumption', async () => {
    const req: any = {
      user: { id: 'user-synthetic', authSessionId: 'session-synthetic' },
      body: {
        challengeId: 'registration-challenge',
        response: {
          id: 'credential-new',
          response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: 'synthetic-challenge' })).toString('base64url'), transports: ['internal'] }
        }
      }
    };
    mockConsume.mockResolvedValue({ metadata: { reauthenticatedAt: Date.now() } });
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: null });
    const res = createResponse();

    await completePasskeyRegistration(req, res);

    expect(mockVerifyRegistration).toHaveBeenCalledWith(expect.objectContaining({ expectedRPID: 'scrolith.com', expectedOrigin: expect.arrayContaining(['https://scrolith.com']) }));
    expect(mockConsume).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'REGISTRATION', userId: 'user-synthetic' }));
    expect(mockDb.passkeyCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-synthetic', credentialId: 'credential-new', publicKey: 'public-key' })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('passwordless passkey revocation requires a recently authenticated session', async () => {
    mockDb.authSession.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 6 * 60 * 1000) });
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: null });
    const req: any = {
      user: { id: 'user-synthetic', authSessionId: 'session-synthetic' },
      params: { id: 'passkey-row' }, body: {}
    };
    const res = createResponse();

    await revokePasskey(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSKEY_REAUTH_REQUIRED' }));
    expect(mockDb.passkeyCredential.updateMany).not.toHaveBeenCalled();
  });

  test('password passkey removal verifies the current password before revoking the credential', async () => {
    mockDb.user.findUnique.mockResolvedValue({ passwordHash: 'synthetic-password-hash' });
    const req: any = {
      user: { id: 'user-synthetic', authSessionId: 'session-synthetic' },
      params: { id: 'passkey-row' },
      body: { currentPassword: 'correct synthetic password' }
    };
    const res = createResponse();

    await revokePasskey(req, res);

    expect(mockBcryptCompare).toHaveBeenCalledWith('correct synthetic password', 'synthetic-password-hash');
    expect(mockDb.passkeyCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'passkey-row', userId: 'user-synthetic', revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
