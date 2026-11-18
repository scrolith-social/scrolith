// C:\Projects\Scrolith-backend\src\middleware\auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prismaClient';
import { Role } from '@prisma/client';
import { resolveAuthSessionToken } from '../services/authSession.service';
import { setSafeObjectValue } from '../utils/security/safeObjectKey';
import {
  isAuthoritativeAdminRole,
  isLocalOnlyDevBypassAllowed
} from '../utils/security/isProductionRuntime';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        authSessionId?: string;
        authSessionVersion?: number;
      };
    }
  }
}

const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const jar: Record<string, string> = {};
  if (!cookieHeader) return jar;
  cookieHeader.split(';').forEach((part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) return;
    const key = rawKey.trim();
    const value = rest.join('=').trim();
    if (!key) return;
    try {
      setSafeObjectValue(jar, key, decodeURIComponent(value));
    } catch {
      setSafeObjectValue(jar, key, value);
    }
  });
  return jar;
};

const resolveAuthorizationHeader = (req: Request) => {
  let authHeader = req.headers.authorization as string | undefined;
  if (!authHeader) {
    const cookies = parseCookies(req.headers.cookie as string | undefined);
    const cookieToken = cookies['Scrolith_token'] || cookies['token'];
    if (cookieToken) {
      authHeader = `Bearer ${cookieToken}`;
    }
  }
  return authHeader;
};

const sendAuthFailure = (res: Response, status: number, error: string) => {
  res.status(status).json({ success: false, error });
};

const resolveAuthenticatedUser = async (req: Request) => {
  const authHeader = resolveAuthorizationHeader(req);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, status: 401, error: 'No token provided', missingToken: true } as const;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return { user: null, status: 401, error: 'Invalid token', missingToken: false } as const;
  try {
    const auth = await resolveAuthSessionToken(token);
    if (!auth) return { user: null, status: 401, error: 'Invalid or revoked token', missingToken: false } as const;
    if (auth.user.isActive === false) {
      return { user: null, status: 403, error: 'Account is deactivated', missingToken: false } as const;
    }

    const staff = await prisma.staffUser.findUnique({
      where: { userId: auth.user.id },
      include: { role: { select: { name: true, isActive: true } } }
    });
    if (staff) {
      if (staff.status !== 'ACTIVE') {
        return { user: null, status: 403, error: 'Staff account is not active', missingToken: false } as const;
      }
      if (!staff.role?.isActive) {
        return { user: null, status: 403, error: 'Assigned staff role is inactive', missingToken: false } as const;
      }
    }

    return {
      user: {
        id: auth.user.id,
        email: auth.user.email,
        role: auth.user.role,
        authSessionId: auth.sessionId,
        authSessionVersion: auth.sessionVersion
      } as Express.Request['user'],
      status: 200,
      error: null,
      missingToken: false
    } as const;
  } catch {
    return { user: null, status: 503, error: 'Authentication temporarily unavailable', missingToken: false } as const;
  }
};

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const resolved = await resolveAuthenticatedUser(req);
    if (resolved.user) {
      req.user = resolved.user;
      next();
      return;
    }

    if (resolved.status === 503) {
      sendAuthFailure(res, 503, resolved.error);
      return;
    }

    // Optional dev bypass (explicit local-only opt-in); managed runtimes always fail closed.
    if (resolved.missingToken && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
      if (!isLocalOnlyDevBypassAllowed()) {
        console.error('[auth] ALLOW_DEV_AUTH_BYPASS rejected outside an explicitly marked local runtime');
        sendAuthFailure(res, 401, 'Authentication failed');
        return;
      }
      const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
      const explicitDevRole =
        (req.headers['x-dev-role'] as string | undefined) ||
        (req.query.role as string | undefined);
      const roleHint =
        explicitDevRole ||
        (fullPath.startsWith('/api/proposals/me') || fullPath.startsWith('/proposals/me') ? 'freelancer' :
          fullPath.startsWith('/api/proposals') || fullPath.startsWith('/proposals') ? 'client' :
          fullPath.startsWith('/api/freelancer') || fullPath.startsWith('/freelancer') ? 'freelancer' :
          fullPath.startsWith('/api/client') || fullPath.startsWith('/client') ? 'client' :
          fullPath.startsWith('/api/admin') || fullPath.startsWith('/admin') ? 'admin' : undefined);

      if (!explicitDevRole) {
        sendAuthFailure(res, resolved.status || 401, resolved.error || 'Authentication failed');
        return;
      }

      const normalizeRole = (value?: string) => {
        const v = (value || '').toString().toLowerCase();
        if (isAuthoritativeAdminRole(v)) return 'ADMIN';
        if (v.includes('freelancer') || v.includes('seller')) return 'FREELANCER';
        if (v.includes('client') || v.includes('employer') || v.includes('buyer')) return 'CLIENT';
        return 'FREELANCER';
      };

      const devUser: { id: string; email: string; role: Role } = {
        id: 'dev-user-id-123',
        email: 'dev@example.com',
        role: normalizeRole(roleHint)
      };
      try {
        await prisma.user.upsert({
          where: { id: devUser.id },
          update: { email: devUser.email, role: devUser.role, isActive: true },
          create: {
            id: devUser.id,
            email: devUser.email,
            role: devUser.role,
            isActive: true,
            isVerified: true
          }
        });
      } catch (error) {
        console.warn('Dev user upsert failed:', error);
      }

      req.user = devUser as unknown as Express.Request['user'];
      next();
      return;
    }

    // No token provided
    sendAuthFailure(res, resolved.status || 401, resolved.error || 'Authentication failed');
    return;
    
    /*
    // Production code (commented out for now):
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as unknown as { id?: string; role?: string; exp?: number; iat?: number };
      
      // Check if user exists and is active
      const prismaClient = getPrisma();
      if (!prismaClient) {
        return res.status(500).json({ error: 'Database connection unavailable' });
      }
      
      const user = await prismaClient.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, role: true, isActive: true }
      });
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      if (!user.isActive) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }
      
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role
      };
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    */
  } catch {
    console.error('[auth.middleware] Authentication store unavailable');
    sendAuthFailure(res, 503, 'Authentication temporarily unavailable');
    return;
  }
};

export const optionalAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const resolved = await resolveAuthenticatedUser(req);
    if (resolved.user) {
      req.user = resolved.user;
    }
  } catch {
    // Optional identity is omitted when the shared session store is unavailable.
  }
  next();
};
