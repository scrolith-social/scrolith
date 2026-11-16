import { UserRole } from '../types';

export const USER_ROLES: Record<'GUEST' | 'FREELANCER' | 'EMPLOYER' | 'ADMIN' | 'MODERATOR', UserRole> = {
  GUEST: UserRole.GUEST,
  FREELANCER: UserRole.FREELANCER,
  EMPLOYER: UserRole.EMPLOYER,
  ADMIN: UserRole.ADMIN,
  MODERATOR: UserRole.MODERATOR
};
