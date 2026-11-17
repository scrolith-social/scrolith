import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

await import('./test-db-guard.mjs');

const email = String(process.env.SCROLITH_E2E_SIGNUP_EMAIL || '').trim().toLowerCase();
if (!/^scrolith-e2e-\d+-\d+-b@example\.invalid$/.test(email)) {
  throw new Error('Refusing to seed certification content for an unrecognized synthetic account.');
}
const authorEmail = email.replace(/-b@/, '-a@');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PRISMA_CONNECTION_LIMIT || 2),
  connectionTimeoutMillis: 10_000
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const [viewer, author] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: authorEmail }, select: { id: true } })
  ]);
  if (!viewer || !author) {
    throw new Error('Both synthetic certification accounts must exist before feed fixtures are seeded.');
  }

  const seedPost = async (postEmail, owner, label) => {
    const suffix = createHash('sha256').update(postEmail).digest('hex').slice(0, 28);
    const id = `cert-feed-${suffix}`;
    const existing = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
    if (existing && existing.authorId !== owner.id) {
      throw new Error('The deterministic certification fixture ID is already owned by another account.');
    }

    await prisma.communityPost.upsert({
      where: { id },
      update: {
        title: 'Certification feed fixture',
        content: `Synthetic ${label} post used to validate authenticated feed and post-card rendering.`,
        visibility: 'public',
        status: 'active'
      },
      create: {
        id,
        authorId: owner.id,
        title: 'Certification feed fixture',
        content: `Synthetic ${label} post used to validate authenticated feed and post-card rendering.`,
        visibility: 'public',
        status: 'active'
      }
    });
  };

  await Promise.all([
    seedPost(authorEmail, author, 'cross-account'),
    seedPost(email, viewer, 'viewer-account')
  ]);

  const scrollSuffix = createHash('sha256').update(authorEmail).digest('hex').slice(0, 28);
  const scrollId = `cert-scroll-${scrollSuffix}`;
  const existingScroll = await prisma.scrollVideo.findUnique({ where: { id: scrollId }, select: { authorId: true } });
  if (existingScroll && existingScroll.authorId !== author.id) {
    throw new Error('The deterministic certification scroll ID is already owned by another account.');
  }

  await prisma.scrollVideo.upsert({
    where: { id: scrollId },
    update: {
      fileId: `cert-scroll-placeholder-${scrollSuffix}`,
      title: 'Certification scroll fixture',
      description: 'Synthetic public item used to validate the authenticated interest survey.',
      visibility: 'public',
      status: 'active'
    },
    create: {
      id: scrollId,
      authorId: author.id,
      fileId: `cert-scroll-placeholder-${scrollSuffix}`,
      title: 'Certification scroll fixture',
      description: 'Synthetic public item used to validate the authenticated interest survey.',
      visibility: 'public',
      status: 'active'
    }
  });
  console.log('Synthetic cross-account feed and scroll fixtures are ready.');
} finally {
  await prisma.$disconnect();
  await pool.end();
}
