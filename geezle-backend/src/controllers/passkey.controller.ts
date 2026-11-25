import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import prisma from '../utils/prismaClient';
import {
  getClientMeta,
  logAuthEvent,
  mapUserPayload,
  safeFindUserByEmail,
  safeFindUserById
} from './auth.controller';
import { enforceHumanVerification } from '../utils/humanVerificationGate';
import { normalizeLoginDeviceMetadata } from '../services/loginApproval.service';
import { finishPasskeyLoginAfterMfa, type PasskeyLoginApprovalContext } from '../services/passkeyLogin.service';
import {
  PASSKEY_PURPOSE,
  consumePasskeyChallenge,
  createPasskeyChallenge,
  decodePasskeyBytes,
  encodePasskeyBytes,
  normalizePasskeyLabel
} from '../services/passkey.service';

const RP_ID = String(process.env.PASSKEY_RP_ID || 'scrolith.com').trim().toLowerCase();
const RP_NAME = String(process.env.PASSKEY_RP_NAME || 'Scrolith').trim() || 'Scrolith';
const EXPECTED_ORIGINS = String(
  process.env.PASSKEY_ALLOWED_ORIGINS || 'https://scrolith.com,https://www.scrolith.com'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const passkeysEnabled = () => String(process.env.SCROLITH_PASSKEYS_ENABLED || '').toLowerCase() === 'true';
const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
const hasValidRelyingPartyConfiguration = () => {
  if (process.env.NODE_ENV !== 'production') return Boolean(RP_ID && EXPECTED_ORIGINS.length);
  const productionOrigins = new Set(['https://scrolith.com', 'https://www.scrolith.com']);
  return RP_ID === 'scrolith.com' && EXPECTED_ORIGINS.length > 0 && EXPECTED_ORIGINS.every((origin) => productionOrigins.has(origin));
};

const disabled = (res: Response) =>
  res.status(404).json({ success: false, error: 'Passkeys are not enabled', code: 'PASSKEYS_DISABLED' });

const invalidRelyingPartyConfiguration = (res: Response) =>
  res.status(503).json({ success: false, error: 'Passkey sign-in is unavailable because relying-party configuration is invalid', code: 'PASSKEY_RP_CONFIG_INVALID' });

const bodyResponse = (req: Request) => {
  const response = req.body?.response;
  return response && typeof response === 'object' ? response : null;
};

const extractClientDataChallenge = (response: RegistrationResponseJSON | AuthenticationResponseJSON) => {
  try {
    const raw = Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { challenge?: unknown };
    const challenge = String(parsed.challenge || '').trim();
    return challenge || null;
  } catch {
    return null;
  }
};

const clientMetadata = (req: Request) => {
  const meta = getClientMeta(req);
  return {
    platform: String(req.body?.platform || '').trim().slice(0, 32) || undefined,
    userAgent: meta.userAgent,
    ip: meta.ip
  };
};

const getActiveAuthenticatedSession = async (req: Request, userId: string) => {
  const sessionId = String((req.user as any)?.authSessionId || '').trim();
  if (!sessionId) return null;
  const now = new Date();
  return prisma.authSession.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
    select: { createdAt: true }
  });
};

const verifyFreshAccountAuthentication = async (req: Request, userId: string, currentPassword?: unknown) => {
  const session = await getActiveAuthenticatedSession(req, userId);
  if (!session) return false;
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!account) return false;
  if (!account.passwordHash) return new Date().getTime() - session.createdAt.getTime() <= STEP_UP_MAX_AGE_MS;
  const password = String(currentPassword || '');
  if (!password) return false;
  try { return await bcrypt.compare(password, account.passwordHash); }
  catch { return false; }
};

const requestContextFromMetadata = (metadata: any): PasskeyLoginApprovalContext | null => {
  const device = normalizeLoginDeviceMetadata(metadata?.loginDevice);
  if (!device.deviceId) return null;
  return {
    device,
    request: {
      ip: String(metadata?.ip || '').slice(0, 128) || null,
      userAgent: String(metadata?.userAgent || '').slice(0, 512) || null
    }
  };
};

const userForLogin = async (userId: string) => prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true, email: true, name: true, username: true, role: true, avatar: true,
    isActive: true, kycStatus: true, isVerified: true, authSessionVersion: true,
    twoFactorEnabled: true, twoFactorSecret: true, twoFactorBackupCodes: true,
    twoFactorWaivedUntil: true
  }
});

export const beginPasskeyRegistration = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  if (!hasValidRelyingPartyConfiguration()) return invalidRelyingPartyConfiguration(res);
  const userId = String(req.user?.id || '').trim();
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

  const user = await safeFindUserById(userId);
  if (!user || user.isActive === false) return res.status(403).json({ success: false, error: 'Account unavailable' });

  if (!await verifyFreshAccountAuthentication(req, userId, req.body?.currentPassword)) {
    return res.status(401).json({
      success: false,
      error: 'Fresh authentication is required. Password accounts must confirm the current password; passwordless accounts must sign in again within the last five minutes.',
      code: 'PASSKEY_REAUTH_REQUIRED'
    });
  }

  const existing = await prisma.passkeyCredential.findMany({
    where: { userId, revokedAt: null },
    select: { credentialId: true, transports: true }
  });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userID: Buffer.from(user.id, 'utf8'),
    userDisplayName: user.name || user.username || user.email,
    attestationType: 'none',
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    },
    preferredAuthenticatorType: 'localDevice'
  });
  const challenge = await createPasskeyChallenge({
    challenge: options.challenge,
    purpose: PASSKEY_PURPOSE.registration,
    userId,
    metadata: { ...clientMetadata(req), reauthenticatedAt: Date.now() }
  });

  return res.json({ success: true, data: options, challengeId: challenge.id, expiresAt: challenge.expiresAt });
};

export const completePasskeyRegistration = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  if (!hasValidRelyingPartyConfiguration()) return invalidRelyingPartyConfiguration(res);
  const userId = String(req.user?.id || '').trim();
  const challengeId = String(req.body?.challengeId || '').trim();
  const response = bodyResponse(req) as RegistrationResponseJSON | null;
  if (!userId || !challengeId || !response?.id || !response?.response) {
    return res.status(400).json({ success: false, error: 'challengeId and passkey response are required' });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: async (challenge) => {
        const row = await prisma.passkeyChallenge.findUnique({ where: { id: challengeId }, select: { challengeHash: true } });
        if (!row) return false;
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256').update(challenge, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(row.challengeHash), Buffer.from(hash));
      },
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      requireUserPresence: true,
      requireUserVerification: true
    });
    if (!verification.verified) return res.status(400).json({ success: false, error: 'Passkey registration could not be verified' });

    const credential = verification.registrationInfo.credential;
    const duplicate = await prisma.passkeyCredential.findUnique({ where: { credentialId: credential.id }, select: { id: true } });
    if (duplicate) return res.status(409).json({ success: false, error: 'This passkey is already registered', code: 'PASSKEY_EXISTS' });

    const clientChallenge = extractClientDataChallenge(response);
    if (!clientChallenge) return res.status(400).json({ success: false, error: 'Invalid passkey client data' });
    const challenge = await consumePasskeyChallenge({
      id: challengeId,
      challenge: clientChallenge,
      purpose: PASSKEY_PURPOSE.registration,
      userId
    });
    if (!challenge) return res.status(409).json({ success: false, error: 'Passkey registration challenge expired or was already used' });
    const reauthenticatedAt = Number((challenge.metadata as any)?.reauthenticatedAt || 0);
    if (!reauthenticatedAt || Date.now() - reauthenticatedAt > STEP_UP_MAX_AGE_MS || !await getActiveAuthenticatedSession(req, userId)) {
      return res.status(401).json({ success: false, error: 'Fresh authentication expired. Sign in again before adding a passkey.', code: 'PASSKEY_REAUTH_REQUIRED' });
    }

    await prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: encodePasskeyBytes(credential.publicKey),
        counter: credential.counter,
        transports: response.response.transports || [],
        deviceType: verification.registrationInfo.credentialDeviceType,
        backedUp: verification.registrationInfo.credentialBackedUp,
        aaguid: verification.registrationInfo.aaguid,
        label: normalizePasskeyLabel(req.body?.label)
      }
    });
    void logAuthEvent({ userId, event: 'passkey_registered', meta: { deviceType: verification.registrationInfo.credentialDeviceType, backedUp: verification.registrationInfo.credentialBackedUp } }, req);
    return res.status(201).json({ success: true, message: 'Passkey added successfully' });
  } catch (error: any) {
    console.warn('[passkey] registration verification failed', { reason: 'verification_failed' });
    return res.status(400).json({ success: false, error: 'Passkey registration could not be verified', code: 'PASSKEY_REGISTRATION_FAILED' });
  }
};

export const beginPasskeyAuthentication = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  if (!hasValidRelyingPartyConfiguration()) return invalidRelyingPartyConfiguration(res);
  if ((await enforceHumanVerification(req, res, 'login')) === false) return undefined;
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 320);
  const loginDevice = normalizeLoginDeviceMetadata(req.body?.device);
  if (!loginDevice.deviceId) {
    return res.status(400).json({ success: false, error: 'Device security metadata is required', code: 'DEVICE_METADATA_REQUIRED' });
  }
  const expectedUserId = String(req.body?.expectedUserId || '').trim().slice(0, 128);
  let allowCredentials;

  // When the user has already entered an email, narrow the discoverable
  // credential lookup to that account. If the hint is absent or does not have
  // a registered passkey, retain the usernameless flow so we never disclose
  // whether an account or credential exists.
  if (email) {
    const hintedUser = await safeFindUserByEmail(email);
    if (hintedUser?.id && hintedUser.isActive !== false) {
      const credentials = await prisma.passkeyCredential.findMany({
        where: { userId: hintedUser.id, revokedAt: null },
        select: { credentialId: true, transports: true }
      });
      if (credentials.length > 0) {
        allowCredentials = credentials.map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports
        }));
      }
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    ...(allowCredentials ? { allowCredentials } : {})
  });
  const challenge = await createPasskeyChallenge({
    challenge: options.challenge,
    purpose: PASSKEY_PURPOSE.authentication,
    metadata: {
      ...clientMetadata(req),
      loginDevice,
      ...(expectedUserId ? { expectedUserId } : {})
    }
  });
  return res.json({ success: true, data: options, challengeId: challenge.id, expiresAt: challenge.expiresAt });
};

export const completePasskeyAuthentication = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  if (!hasValidRelyingPartyConfiguration()) return invalidRelyingPartyConfiguration(res);
  const challengeId = String(req.body?.challengeId || '').trim();
  const response = bodyResponse(req) as AuthenticationResponseJSON | null;
  if (!challengeId || !response?.id || !response?.response) {
    return res.status(400).json({ success: false, error: 'challengeId and passkey response are required' });
  }

  const stored = await prisma.passkeyCredential.findFirst({
    where: { credentialId: response.id, revokedAt: null },
    select: { id: true, userId: true, credentialId: true, publicKey: true, counter: true, transports: true }
  });
  if (!stored) return res.status(401).json({ success: false, error: 'Passkey not recognized', code: 'PASSKEY_NOT_FOUND' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: async (challenge) => {
        const row = await prisma.passkeyChallenge.findUnique({ where: { id: challengeId }, select: { challengeHash: true } });
        if (!row) return false;
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256').update(challenge, 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(row.challengeHash), Buffer.from(hash));
      },
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: decodePasskeyBytes(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports
      }
    });
    if (!verification.verified) return res.status(401).json({ success: false, error: 'Passkey authentication failed', code: 'PASSKEY_AUTH_FAILED' });

    const clientChallenge = extractClientDataChallenge(response);
    if (!clientChallenge) return res.status(400).json({ success: false, error: 'Invalid passkey client data' });
    const challenge = await consumePasskeyChallenge({
      id: challengeId,
      challenge: clientChallenge,
      purpose: PASSKEY_PURPOSE.authentication
    });
    if (!challenge) return res.status(409).json({ success: false, error: 'Passkey challenge expired or was already used', code: 'PASSKEY_CHALLENGE_USED' });

    const updated = await prisma.passkeyCredential.updateMany({
      where: { id: stored.id, revokedAt: null, counter: stored.counter },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp
      }
    });
    if (updated.count !== 1) return res.status(409).json({ success: false, error: 'Passkey was used concurrently; please try again', code: 'PASSKEY_COUNTER_CONFLICT' });

    const metadata = challenge.metadata as any;
    const expectedUserId = String(metadata?.expectedUserId || '').trim();
    if (expectedUserId && expectedUserId !== stored.userId) {
      return res.status(401).json({ success: false, error: 'The selected account did not match this passkey', code: 'PASSKEY_ACCOUNT_MISMATCH' });
    }
    const user = await userForLogin(stored.userId);
    if (!user || user.isActive === false) return res.status(403).json({ success: false, error: 'Account unavailable' });
    try {
      const staffProfile = await prisma.staffUser.findUnique({
        where: { userId: user.id },
        include: { role: { select: { id: true, name: true, isActive: true } } }
      });
      if (staffProfile?.status !== undefined && staffProfile.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, error: 'Staff account is not active', code: 'STAFF_ACCOUNT_INACTIVE' });
      }
      if (staffProfile && !staffProfile.role?.isActive) {
        return res.status(403).json({ success: false, error: 'Assigned staff role is inactive', code: 'STAFF_ROLE_INACTIVE' });
      }
    } catch {
      return res.status(503).json({ success: false, error: 'Unable to complete account security checks', code: 'LOGIN_GUARD_UNAVAILABLE' });
    }

    const loginContext = requestContextFromMetadata(metadata);
    if (!loginContext) {
      return res.status(400).json({ success: false, error: 'Passkey login device context is unavailable', code: 'DEVICE_METADATA_REQUIRED' });
    }
    const { evaluateAdmin2FAGate } = await import('./admin2fa.controller');
    const mfa = await evaluateAdmin2FAGate(user, { postMfaLoginApproval: loginContext });
    if (mfa.required) {
      void logAuthEvent({ userId: user.id, email: user.email, event: 'passkey_assertion_verified_mfa_required' }, req);
      return res.json({
        success: true,
        requires2FA: true,
        challengeToken: mfa.challengeToken,
        code: '2FA_REQUIRED',
        message: 'Complete authenticator verification to finish passkey sign-in.',
        user: { id: user.id, email: user.email, role: user.role }
      });
    }

    const completed = await finishPasskeyLoginAfterMfa(user, loginContext);
    if (completed.requiresLoginApproval) {
      void logAuthEvent({ userId: user.id, email: user.email, event: 'passkey_login_approval_requested' }, req);
      return res.json({
        success: true,
        requiresLoginApproval: true,
        code: 'LOGIN_APPROVAL_REQUIRED',
        message: 'Approve this login from an existing trusted session.',
        loginApproval: completed.loginApproval,
        user: { id: user.id, email: user.email, role: user.role }
      });
    }

    const token = completed.token;
    res.cookie('Scrolith_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
    void logAuthEvent({ userId: user.id, email: user.email, event: 'passkey_authenticated', meta: { passkeyRecordId: stored.id, deviceType: verification.authenticationInfo.credentialDeviceType, backedUp: verification.authenticationInfo.credentialBackedUp } }, req);
    return res.json({ success: true, user: mapUserPayload(user), token, accessToken: token });
  } catch (error: any) {
    console.warn('[passkey] authentication verification failed', { reason: 'verification_failed' });
    void logAuthEvent({ userId: stored.userId, event: 'passkey_authentication_failed', meta: { reason: 'verification_failed' } }, req);
    return res.status(401).json({ success: false, error: 'Passkey authentication failed', code: 'PASSKEY_AUTH_FAILED' });
  }
};

export const listPasskeys = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  const userId = String(req.user?.id || '').trim();
  const rows = await prisma.passkeyCredential.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastUsedAt: 'desc' },
    select: { id: true, label: true, deviceType: true, backedUp: true, aaguid: true, lastUsedAt: true, createdAt: true }
  });
  return res.json({ success: true, data: rows });
};

export const renamePasskey = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  const userId = String(req.user?.id || '').trim();
  const id = String(req.params.id || '').trim();
  const updated = await prisma.passkeyCredential.updateMany({
    where: { id, userId, revokedAt: null },
    data: { label: normalizePasskeyLabel(req.body?.label) }
  });
  if (updated.count !== 1) return res.status(404).json({ success: false, error: 'Passkey not found' });
  return res.json({ success: true });
};

export const revokePasskey = async (req: Request, res: Response) => {
  if (!passkeysEnabled()) return disabled(res);
  const userId = String(req.user?.id || '').trim();
  const id = String(req.params.id || '').trim();
  if (!await verifyFreshAccountAuthentication(req, userId, req.body?.currentPassword)) {
    return res.status(401).json({
      success: false,
      error: 'Fresh authentication is required. Password accounts must confirm the current password; passwordless accounts must sign in again within the last five minutes.',
      code: 'PASSKEY_REAUTH_REQUIRED'
    });
  }
  const updated = await prisma.passkeyCredential.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  if (updated.count !== 1) return res.status(404).json({ success: false, error: 'Passkey not found' });
  void logAuthEvent({ userId, event: 'passkey_revoked', meta: { passkeyId: id } }, req);
  return res.json({ success: true });
};
