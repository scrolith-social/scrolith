import prisma from '../utils/prismaClient';

export interface GigRemovalResult {
  retainedForOrderHistory: boolean;
}

const isForeignKeyConflict = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2003');

/**
 * Remove a gig from the active catalog without detaching historical orders.
 * A restrictive FK is the final concurrency guard if an order is created after
 * the initial count but before the delete statement.
 */
export async function removeGigPreservingOrderHistory(id: string): Promise<GigRemovalResult> {
  const linkedOrders = await prisma.order.count({ where: { gigId: id } });
  if (linkedOrders > 0) {
    await prisma.gig.update({
      where: { id },
      data: { isActive: false, status: 'PAUSED' }
    });
    return { retainedForOrderHistory: true };
  }

  try {
    await prisma.gig.delete({ where: { id } });
    return { retainedForOrderHistory: false };
  } catch (error) {
    if (!isForeignKeyConflict(error)) throw error;

    // An order may have committed between count and delete. Re-check only this
    // known relation; unrelated constraint failures must remain visible.
    const orderCommittedDuringDelete = await prisma.order.count({ where: { gigId: id } });
    if (orderCommittedDuringDelete === 0) throw error;

    await prisma.gig.update({
      where: { id },
      data: { isActive: false, status: 'PAUSED' }
    });
    return { retainedForOrderHistory: true };
  }
}
