import prisma from '../utils/prismaClient';

export type CommunityAdRemovalReason = 'CREATOR_DELETE' | 'ADMIN_DELETE';

const archiveData = (ad: { targeting: unknown }, actorId: string | null, reason: CommunityAdRemovalReason, now: Date) => {
  const existing = ad.targeting && typeof ad.targeting === 'object' && !Array.isArray(ad.targeting)
    ? ad.targeting as Record<string, unknown>
    : {};
  const targeting = {
    ...existing,
    archived: true,
    archivedAt: now.toISOString(),
    archivedById: actorId,
    archiveReason: reason,
    ...(reason === 'CREATOR_DELETE' ? { userDeleted: true, userDeletedAt: now.toISOString(), userDeletedBy: actorId } : { adminDeleted: true, adminDeletedAt: now.toISOString(), adminDeletedBy: actorId })
  };

  return {
    status: 'ENDED' as const,
    archivedAt: now,
    archivedById: actorId,
    archiveReason: reason,
    targeting: targeting as any
  };
};

/**
 * Hard-delete an unpaid ad, but retain a paid ad and its payment evidence as an
 * ended archive. The restrictive AdPayment FK is the final race-safe guard: if
 * a payment is inserted after the count, the delete fails and this method
 * re-reads and archives the ad instead.
 */
export async function removeCommunityAdPreservingPayments(
  adId: string,
  actorId: string | null,
  reason: CommunityAdRemovalReason
): Promise<{ archived: boolean }> {
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const ad = await tx.communityAd.findUnique({ where: { id: adId }, select: { id: true, targeting: true } });
      if (!ad) throw new Error('Ad not found');
      const paymentCount = await tx.adPayment.count({ where: { adId } });
      if (paymentCount > 0) {
        await tx.communityAd.update({ where: { id: adId }, data: archiveData(ad, actorId, reason, now) });
        return { archived: true };
      }

      await tx.communityAd.delete({ where: { id: adId } });
      return { archived: false };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const hasPaymentHistory = await prisma.adPayment.count({ where: { adId } }).catch(() => 0);
    if (!hasPaymentHistory) throw error;

    const ad = await prisma.communityAd.findUnique({ where: { id: adId }, select: { id: true, targeting: true } });
    if (!ad) throw error;
    await prisma.communityAd.update({ where: { id: adId }, data: archiveData(ad, actorId, reason, new Date()) });
    return { archived: true };
  }
}

export async function archiveCommunityAd(
  adId: string,
  actorId: string | null,
  reason: CommunityAdRemovalReason
) {
  const ad = await prisma.communityAd.findUnique({ where: { id: adId }, select: { id: true, targeting: true } });
  if (!ad) throw new Error('Ad not found');
  return prisma.communityAd.update({
    where: { id: adId },
    data: archiveData(ad, actorId, reason, new Date())
  });
}
