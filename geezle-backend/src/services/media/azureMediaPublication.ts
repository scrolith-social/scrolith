import prisma from '../../utils/prismaClient';
/** Persistent upload gate: disabling the transport does not publish an unscanned upload. */
export async function azureMediaPublicationAllowed(file: {
  id: string; mediaScanRequired?: boolean; processingVersion?: number;
}): Promise<boolean> {
  if (!file.mediaScanRequired) return true;
  const job = await prisma.azureMediaJob.findFirst({ where: {
    fileId: file.id, generation: file.processingVersion ?? 0, status: 'DONE', sourceSha256: { not: null }
  }, select: { id: true } });
  return Boolean(job);
}
