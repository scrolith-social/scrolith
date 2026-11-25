/**
 * Google Authenticator (TOTP) enrollment + verification + admin emergency waiver.
 */
import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prismaClient';
import {
  buildOtpAuthUri,
  generateBackupCodes,
  generateBase32Secret,
  hashBackupCode,
  verifyTotp
} from '../services/totp.service';
import { getSystemControls, isAdminRole } from '../services/systemControls.service';
import { isAnalystMfaRequiredByPolicy } from '../services/analystRole';
import {
  AuthSessionIssueError,
  issueAuthSessionTokenInTransaction
} from '../services/authSession.service';
import { finishPasskeyLoginAfterMfa, type PasskeyLoginApprovalContext } from '../services/passkeyLogin.service';

const isWaived = (user: { twoFactorWaivedUntil?: Date | null }) => {
  if (!user?.twoFactorWaivedUntil) return false;
  return new Date(user.twoFactorWaivedUntil).getTime() > Date.now();
};

type SetupChallengeData = {
  userId?: string;
  authSessionVersion?: number;
  exp?: number;
  needsSetup?: boolean;
  setupStartedAt?: number;
};

const setupChallengeTokenFromRequest = (req: Request): string =>
  String(
    req.body?.setupChallengeToken ||
      req.body?.challengeToken ||
      req.body?.challenge_token ||
      ''
  ).trim();

type EffectiveMfaDecision = {
  required: boolean;
  staff: {
    status: string;
    require2FA: boolean;
    role: { isActive: boolean } | null;
  } | null;
};

export const getEffectiveMfaDecision = async (user: { id: string; role: string }): Promise<EffectiveMfaDecision> => {
  const [controls, staff] = await Promise.all([
    getSystemControls(),
    prisma.staffUser.findUnique({
      where: { userId: user.id },
      select: {
        status: true,
        require2FA: true,
        role: { select: { isActive: true } }
      }
    })
  ]);
  const globalPolicyRequired =
    controls.admin2FA &&
    (isAdminRole(user.role) || isAnalystMfaRequiredByPolicy(user.role, controls.admin2FA));
  const activeStaffRequirement =
    staff?.status === 'ACTIVE' &&
    staff.role?.isActive === true &&
    staff.require2FA === true;
  return {
    required: Boolean(globalPolicyRequired || activeStaffRequirement),
    staff
  };
};

const loadSetupChallenge = async (req: Request, requireStarted: boolean) => {
  const challengeToken = setupChallengeTokenFromRequest(req);
  if (!/^[a-f0-9]{48}$/i.test(challengeToken)) return null;

  const record = await prisma.appSetting.findUnique({
    where: { scope: `2fa_challenge_${challengeToken}` }
  });
  const data = (record?.data || {}) as SetupChallengeData;
  if (
    !record ||
    data.needsSetup !== true ||
    !data.userId ||
    !Number.isFinite(Number(data.exp)) ||
    Number(data.exp) <= Date.now() ||
    (requireStarted && !Number.isFinite(Number(data.setupStartedAt)))
  ) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: String(data.userId) },
    select: {
      id: true,
      email: true,
      role: true,
      authSessionVersion: true,
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorWaivedUntil: true
    }
  });
  if (!user || user.isActive === false || user.twoFactorEnabled || isWaived(user) ||
    !Number.isSafeInteger(data.authSessionVersion) || user.authSessionVersion !== data.authSessionVersion) return null;

  const mfaDecision = await getEffectiveMfaDecision(user);
  if (mfaDecision.staff && (mfaDecision.staff.status !== 'ACTIVE' || mfaDecision.staff.role?.isActive !== true)) {
    return null;
  }
  if (!mfaDecision.required) return null;

  return { challengeToken, record, data, user };
};

export const getMy2FAStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        twoFactorEnrolledAt: true,
        twoFactorWaivedUntil: true,
        twoFactorWaivedReason: true
      }
    });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const mfaDecision = await getEffectiveMfaDecision(user);
    return res.json({
      success: true,
      data: {
        admin2FAPolicyEnforced: mfaDecision.required,
        isAdmin: isAdminRole(user.role),
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        enrolledAt: user.twoFactorEnrolledAt,
        waived: isWaived(user),
        waivedUntil: user.twoFactorWaivedUntil,
        waivedReason: user.twoFactorWaivedReason,
        requiresSetup:
          mfaDecision.required &&
          !user.twoFactorEnabled &&
          !isWaived(user)
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to load 2FA status' });
  }
};

export const begin2FAEnrollment = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, twoFactorEnabled: true }
    });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    // Available to all authenticated users (freelancer/employer/admin security settings).
    const secret = generateBase32Secret(20);
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: false
      } as any
    });
    // Keep UserSettings flag in sync for dashboard toggles that still read it.
    await prisma.userSettings
      .upsert({
        where: { userId },
        create: { userId, twoFactorEnabled: false } as any,
        update: { twoFactorEnabled: false } as any
      })
      .catch(() => undefined);
    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: user.email,
      issuer: 'Scrolith'
    });
    return res.json({
      success: true,
      data: {
        secret,
        otpauthUrl,
        // Frontend can render QR from otpauthUrl (e.g. https://api.qrserver.com or local lib)
        qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to begin 2FA enrollment' });
  }
};

export const confirm2FAEnrollment = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const token = String(req.body?.token || req.body?.code || '').trim();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFactorSecret: true }
    });
    if (!user?.twoFactorSecret) {
      return res.status(400).json({ success: false, error: 'Start enrollment first' });
    }
    if (!verifyTotp(user.twoFactorSecret, token)) {
      return res.status(400).json({ success: false, error: 'Invalid authenticator code', code: 'INVALID_TOTP' });
    }
    const backupPlain = generateBackupCodes(8);
    const backupHashed = backupPlain.map(hashBackupCode);
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: backupHashed,
        twoFactorEnrolledAt: new Date(),
        twoFactorWaivedUntil: null,
        twoFactorWaivedById: null,
        twoFactorWaivedReason: null
      } as any
    });
    await prisma.userSettings
      .upsert({
        where: { userId },
        create: { userId, twoFactorEnabled: true } as any,
        update: { twoFactorEnabled: true } as any
      })
      .catch(() => undefined);
    return res.json({
      success: true,
      data: {
        enabled: true,
        backupCodes: backupPlain
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to confirm 2FA' });
  }
};

/**
 * Initial privileged enrollment using only the short-lived setup challenge
 * returned after a successful password check. This intentionally does not
 * attach req.user or issue a session before MFA is confirmed.
 */
export const begin2FAEnrollmentFromSetup = async (req: Request, res: Response) => {
  try {
    const context = await loadSetupChallenge(req, false);
    if (!context) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired MFA setup challenge',
        code: 'MFA_SETUP_CHALLENGE_INVALID'
      });
    }

    const secret = generateBase32Secret(20);
    await prisma.$transaction(async (tx) => {
      const users = await tx.$queryRaw<Array<{ id: string; authSessionVersion: number; isActive: boolean }>>`
        SELECT "id", "authSessionVersion", "isActive" FROM "User" WHERE "id" = ${context.user.id} FOR UPDATE
      `;
      if (!users[0]?.isActive || users[0].authSessionVersion !== context.data.authSessionVersion) {
        throw new AuthSessionIssueError('Authentication context expired');
      }
      const challenge = await tx.appSetting.updateMany({
        where: { scope: `2fa_challenge_${context.challengeToken}` },
        data: { data: { ...context.data, setupStartedAt: Date.now() } }
      });
      if (challenge.count !== 1) throw new AuthSessionIssueError('MFA setup challenge expired');
      await tx.user.update({
        where: { id: context.user.id },
        data: { twoFactorSecret: secret, twoFactorEnabled: false } as any
      });
      await tx.userSettings.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, twoFactorEnabled: false } as any,
        update: { twoFactorEnabled: false } as any
      }).catch(() => undefined);
    });

    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: context.user.email,
      issuer: 'Scrolith'
    });
    return res.json({
      success: true,
      data: {
        secret,
        otpauthUrl,
        qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`
      }
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to begin MFA setup' });
  }
};

export const confirm2FAEnrollmentFromSetup = async (req: Request, res: Response) => {
  try {
    const context = await loadSetupChallenge(req, true);
    const token = String(req.body?.token || req.body?.code || '').trim();
    if (!context || !token) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired MFA setup challenge',
        code: 'MFA_SETUP_CHALLENGE_INVALID'
      });
    }
    if (!context.user.twoFactorSecret || !verifyTotp(context.user.twoFactorSecret, token)) {
      return res.status(400).json({ success: false, error: 'Invalid authenticator code', code: 'INVALID_TOTP' });
    }

    const backupPlain = generateBackupCodes(8);
    const backupHashed = backupPlain.map(hashBackupCode);
    await prisma.$transaction(async (tx: any) => {
      const users = await tx.$queryRaw<Array<{ id: string; authSessionVersion: number; isActive: boolean }>>`
        SELECT "id", "authSessionVersion", "isActive" FROM "User" WHERE "id" = ${context.user.id} FOR UPDATE
      `;
      if (!users[0]?.isActive || users[0].authSessionVersion !== context.data.authSessionVersion) {
        throw new AuthSessionIssueError('Authentication context expired');
      }
      const claimed = await tx.appSetting.deleteMany({
        where: { scope: `2fa_challenge_${context.challengeToken}` }
      });
      if (claimed.count !== 1) {
        throw new Error('MFA setup challenge already used');
      }
      await tx.user.update({
        where: { id: context.user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorBackupCodes: backupHashed,
          twoFactorEnrolledAt: new Date(),
          twoFactorWaivedUntil: null,
          twoFactorWaivedById: null,
          twoFactorWaivedReason: null,
          twoFactorSecret: context.user.twoFactorSecret
        } as any
      });
      await tx.userSettings.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, twoFactorEnabled: true } as any,
        update: { twoFactorEnabled: true } as any
      });
    });

    return res.json({
      success: true,
      data: {
        enabled: true,
        backupCodes: backupPlain
      }
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('already used')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired MFA setup challenge',
        code: 'MFA_SETUP_CHALLENGE_INVALID'
      });
    }
    return res.status(500).json({ success: false, error: 'Failed to confirm MFA setup' });
  }
};

export const disableMy2FA = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const token = String(req.body?.token || req.body?.code || '').trim();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFactorSecret: true, twoFactorEnabled: true, twoFactorBackupCodes: true }
    });
    if (!user?.twoFactorEnabled) {
      return res.json({ success: true, data: { enabled: false } });
    }
    const okTotp = user.twoFactorSecret && verifyTotp(user.twoFactorSecret, token);
    const hashed = hashBackupCode(token);
    const okBackup = Array.isArray(user.twoFactorBackupCodes) && user.twoFactorBackupCodes.includes(hashed);
    if (!okTotp && !okBackup) {
      return res.status(400).json({ success: false, error: 'Invalid code', code: 'INVALID_TOTP' });
    }
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
        twoFactorEnrolledAt: null
      } as any
    });
    await prisma.userSettings
      .upsert({
        where: { userId },
        create: { userId, twoFactorEnabled: false } as any,
        update: { twoFactorEnabled: false } as any
      })
      .catch(() => undefined);
    return res.json({ success: true, data: { enabled: false } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to disable 2FA' });
  }
};

/** Admin emergency waiver so a locked-out admin can still sign in. */
export const waiveUser2FA = async (req: Request, res: Response) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const targetId = String(req.params.userId || '').trim();
    if (!targetId) return res.status(400).json({ success: false, error: 'userId required' });
    const hours = Math.min(Math.max(Number(req.body?.hours ?? 24), 1), 168);
    const reason = String(req.body?.reason || 'Emergency admin access waiver').slice(0, 500);
    const until = new Date(Date.now() + hours * 3600 * 1000);
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        twoFactorWaivedUntil: until,
        twoFactorWaivedById: actorId,
        twoFactorWaivedReason: reason
      } as any,
      select: {
        id: true,
        email: true,
        twoFactorEnabled: true,
        twoFactorWaivedUntil: true,
        twoFactorWaivedReason: true
      }
    });
    return res.json({
      success: true,
      data: {
        userId: updated.id,
        email: updated.email,
        waivedUntil: updated.twoFactorWaivedUntil,
        reason: updated.twoFactorWaivedReason,
        twoFactorEnabled: updated.twoFactorEnabled
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to waive 2FA' });
  }
};

export const clearUser2FAWaiver = async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.userId || '').trim();
    if (!targetId) return res.status(400).json({ success: false, error: 'userId required' });
    await prisma.user.update({
      where: { id: targetId },
      data: {
        twoFactorWaivedUntil: null,
        twoFactorWaivedById: null,
        twoFactorWaivedReason: null
      } as any
    });
    return res.json({ success: true, data: { userId: targetId, waived: false } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to clear waiver' });
  }
};

export const resetUser2FA = async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.userId || '').trim();
    if (!targetId) return res.status(400).json({ success: false, error: 'userId required' });
    await prisma.user.update({
      where: { id: targetId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
        twoFactorEnrolledAt: null
      } as any
    });
    await prisma.userSettings
      .upsert({
        where: { userId: targetId },
        create: { userId: targetId, twoFactorEnabled: false } as any,
        update: { twoFactorEnabled: false } as any
      })
      .catch(() => undefined);
    return res.json({ success: true, data: { userId: targetId, twoFactorEnabled: false } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to reset 2FA' });
  }
};

export const listAdmin2FADirectory = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim();
    const onlyEnrolled = String(req.query.enrolled || '') === '1' || String(req.query.enrolled || '') === 'true';
    const onlyAdmins = String(req.query.adminsOnly || '') === '1' || String(req.query.adminsOnly || '') === 'true';

    const where: any = {};
    if (onlyAdmins) {
      where.OR = [{ role: 'ADMIN' as any }, { role: 'SUPER_ADMIN' as any }];
    }
    if (onlyEnrolled) {
      where.twoFactorEnabled = true;
    }
    if (q) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
        twoFactorEnabled: true,
        twoFactorEnrolledAt: true,
        twoFactorWaivedUntil: true,
        twoFactorWaivedReason: true,
        twoFactorWaivedById: true,
        lastLoginAt: true
      },
      orderBy: [{ twoFactorEnabled: 'desc' }, { email: 'asc' }],
      take: Math.min(Number(req.query.limit) || 100, 200)
    });
    const controls = await getSystemControls();
    return res.json({
      success: true,
      data: {
        policyEnforced: controls.admin2FA,
        // keep legacy key for existing UI
        admins: users.map((a) => ({
          ...a,
          waived: isWaived(a)
        })),
        users: users.map((a) => ({
          ...a,
          waived: isWaived(a)
        }))
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Failed to list 2FA directory' });
  }
};

const createChallenge = async (
  userId: string,
  needsSetup: boolean,
  authSessionVersion: number,
  postMfaLoginApproval?: PasskeyLoginApprovalContext
) => {
  const challengeToken = crypto.randomBytes(24).toString('hex');
  await prisma.appSetting.upsert({
    where: { scope: `2fa_challenge_${challengeToken}` },
    create: {
      scope: `2fa_challenge_${challengeToken}`,
      data: {
        userId,
        authSessionVersion: authSessionVersion,
        exp: Date.now() + 10 * 60 * 1000,
        needsSetup,
        ...(postMfaLoginApproval ? { postMfaLoginApproval } : {})
      }
    },
    update: {
      data: {
        userId,
        authSessionVersion: authSessionVersion,
        exp: Date.now() + 10 * 60 * 1000,
        needsSetup,
        ...(postMfaLoginApproval ? { postMfaLoginApproval } : {})
      }
    }
  });
  return challengeToken;
};

/** Called from login after password OK — all enrolled users + admin policy enforcement */
export const evaluateAdmin2FAGate = async (user: {
  id: string;
  role: string;
  authSessionVersion: number;
  twoFactorEnabled?: boolean | null;
  twoFactorSecret?: string | null;
  twoFactorBackupCodes?: string[] | null;
  twoFactorWaivedUntil?: Date | null;
}, options?: { postMfaLoginApproval?: PasskeyLoginApprovalContext }): Promise<
  | { required: false }
  | { required: true; challengeToken: string }
> => {
  if (isWaived(user)) return { required: false };

  const mfaDecision = await getEffectiveMfaDecision(user);
  const userEnrolled = Boolean(user.twoFactorEnabled && user.twoFactorSecret);

  // Enrolled users always challenged at login (unless waived).
  if (userEnrolled) {
    return { required: true, challengeToken: await createChallenge(user.id, false, user.authSessionVersion, options?.postMfaLoginApproval) };
  }

  // Platform Admin 2FA policy: admins must enroll even if not yet enabled.
  if (mfaDecision.required) {
    return { required: true, challengeToken: await createChallenge(user.id, true, user.authSessionVersion, options?.postMfaLoginApproval) };
  }

  return { required: false };
};

export const verify2FALogin = async (req: Request, res: Response) => {
  try {
    const challengeToken = String(req.body?.challengeToken || req.body?.challenge_token || '').trim();
    const code = String(req.body?.token || req.body?.code || '').trim();
    if (!challengeToken || !code) {
      return res.status(400).json({ success: false, error: 'challengeToken and code required' });
    }
    const record = await prisma.appSetting.findUnique({ where: { scope: `2fa_challenge_${challengeToken}` } });
    const data = (record?.data || {}) as any;
    if (!record || !data.userId || Number(data.exp || 0) < Date.now() ||
      !Number.isSafeInteger(data.authSessionVersion)) {
      return res.status(400).json({ success: false, error: 'Challenge expired', code: 'CHALLENGE_EXPIRED' });
    }
    const user = await prisma.user.findUnique({
      where: { id: String(data.userId) },
      select: {
        id: true,
        authSessionVersion: true,
        email: true,
        role: true,
        name: true,
        isActive: true,
        kycStatus: true,
        isVerified: true,
        twoFactorSecret: true,
        twoFactorEnabled: true,
        twoFactorBackupCodes: true,
        twoFactorWaivedUntil: true,
        avatar: true,
        username: true
      }
    });
    if (!user || user.isActive === false || user.authSessionVersion !== data.authSessionVersion) {
      return res.status(403).json({ success: false, error: 'Account unavailable' });
    }
    if (data.needsSetup) {
      return res.status(403).json({
        success: false,
        error: 'Complete Google Authenticator setup before admin login',
        code: '2FA_SETUP_REQUIRED'
      });
    }
    const okTotp = user.twoFactorSecret && verifyTotp(user.twoFactorSecret, code);
    const hashed = hashBackupCode(code);
    const okBackup = !okTotp && (user.twoFactorBackupCodes || []).includes(hashed);
    if (!okTotp && !okBackup) {
      return res.status(400).json({ success: false, error: 'Invalid authenticator code', code: 'INVALID_TOTP' });
    }

    if (data.postMfaLoginApproval) {
      await prisma.$transaction(async (tx) => {
        const users = await tx.$queryRaw<Array<{
          id: string;
          authSessionVersion: number;
          isActive: boolean;
          twoFactorBackupCodes: string[];
        }>>`
          SELECT "id", "authSessionVersion", "isActive", "twoFactorBackupCodes"
          FROM "User" WHERE "id" = ${user.id} FOR UPDATE
        `;
        const current = users[0];
        if (!current?.isActive || current.authSessionVersion !== data.authSessionVersion) {
          throw new AuthSessionIssueError('Authentication context expired');
        }
        const claimed = await tx.appSetting.deleteMany({
          where: { scope: `2fa_challenge_${challengeToken}` }
        });
        if (claimed.count !== 1) throw new AuthSessionIssueError('2FA challenge already used');
        if (okBackup) {
          if (!current.twoFactorBackupCodes.includes(hashed)) {
            throw new AuthSessionIssueError('Backup code already used');
          }
          await tx.user.update({
            where: { id: user.id },
            data: { twoFactorBackupCodes: current.twoFactorBackupCodes.filter((value) => value !== hashed) } as any
          });
        }
      });

      const completed = await finishPasskeyLoginAfterMfa(
        { id: user.id, authSessionVersion: user.authSessionVersion },
        data.postMfaLoginApproval as PasskeyLoginApprovalContext
      );
      if (completed.requiresLoginApproval) {
        await prisma.authAuditLog.create({
          data: {
            userId: user.id,
            email: user.email,
            event: 'passkey_login_approval_requested',
            ip: data.postMfaLoginApproval.request?.ip || null,
            userAgent: data.postMfaLoginApproval.request?.userAgent || null
          }
        }).catch(() => undefined);
        return res.json({
          success: true,
          requiresLoginApproval: true,
          code: 'LOGIN_APPROVAL_REQUIRED',
          message: 'Approve this login from an existing trusted session.',
          loginApproval: completed.loginApproval,
          user: { id: user.id, email: user.email, role: user.role }
        });
      }
      res.cookie('Scrolith_token', completed.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });
      await prisma.authAuditLog.create({
        data: {
          userId: user.id,
          email: user.email,
          event: 'passkey_authenticated',
          ip: data.postMfaLoginApproval.request?.ip || null,
          userAgent: data.postMfaLoginApproval.request?.userAgent || null,
          meta: { mfaVerified: true }
        }
      }).catch(() => undefined);
      return res.json({
        success: true,
        token: completed.token,
        accessToken: completed.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: String(user.role || '').toLowerCase(),
          avatar: user.avatar,
          username: user.username,
          isActive: user.isActive,
          kycStatus: user.kycStatus,
          isVerified: user.isVerified,
          twoFactorEnabled: true
        }
      });
    }

    const token = await prisma.$transaction(async (tx) => {
      const users = await tx.$queryRaw<Array<{
        id: string;
        authSessionVersion: number;
        isActive: boolean;
        twoFactorBackupCodes: string[];
      }>>`
        SELECT "id", "authSessionVersion", "isActive", "twoFactorBackupCodes"
        FROM "User" WHERE "id" = ${user.id} FOR UPDATE
      `;
      const current = users[0];
      if (!current?.isActive || current.authSessionVersion !== data.authSessionVersion) {
        throw new AuthSessionIssueError('Authentication context expired');
      }
      const claimed = await tx.appSetting.deleteMany({
        where: { scope: `2fa_challenge_${challengeToken}` }
      });
      if (claimed.count !== 1) throw new AuthSessionIssueError('2FA challenge already used');
      if (okBackup) {
        if (!current.twoFactorBackupCodes.includes(hashed)) {
          throw new AuthSessionIssueError('Backup code already used');
        }
        await tx.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: current.twoFactorBackupCodes.filter((value) => value !== hashed) } as any
        });
      }
      return issueAuthSessionTokenInTransaction(tx, user.id, data.authSessionVersion);
    });
    res.cookie('Scrolith_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
    return res.json({
      success: true,
      token,
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: String(user.role || '').toLowerCase(),
        avatar: user.avatar,
        username: user.username,
        isActive: user.isActive,
        kycStatus: user.kycStatus,
        isVerified: user.isVerified,
        twoFactorEnabled: true
      }
    });
  } catch (e: any) {
    if (e instanceof AuthSessionIssueError) {
      return res.status(401).json({ success: false, error: 'Authentication challenge is no longer valid', code: 'AUTH_CONTEXT_EXPIRED' });
    }
    return res.status(500).json({ success: false, error: e?.message || '2FA verification failed' });
  }
};
