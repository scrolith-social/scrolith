import { Request, Response, NextFunction } from 'express';
import { resolveAuthSessionToken } from '../services/authSession.service';

export type UserRole = 'ADMIN' | 'ANALYST' | 'MODERATOR' | 'CLIENT' | 'FREELANCER' | 'EMPLOYER' | 'USER' | 'GUEST';

export interface AuthUser {
  id: string;
  role: UserRole;
  email?: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization as string | undefined;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

  const token = header.slice('Bearer '.length).trim();
  try {
    const auth = await resolveAuthSessionToken(token);
    if (!auth || !auth.user.isActive) return res.status(401).json({ success: false, error: { message: 'Invalid or revoked token' } });
    req.user = { id: auth.user.id, email: auth.user.email, role: auth.user.role as UserRole };
    return next();
  } catch {
    return res.status(503).json({ success: false, error: { message: 'Authentication temporarily unavailable' } });
  }
}

export default requireAuth;
