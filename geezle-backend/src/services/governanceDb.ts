import prisma from '../utils/prismaClient';

/**
 * The smallest Prisma surface needed by governed audit writes.
 * A transaction client satisfies this shape, which prevents the governance
 * services from silently falling back to the process-wide Prisma client.
 */
export type GovernanceDb = Pick<typeof prisma, 'adminAuditEvent' | 'approvalPolicy' | 'approvalRequest'>;
