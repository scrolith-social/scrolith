import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

await import('./test-db-guard.mjs');

const email = String(process.env.SCROLITH_E2E_SIGNUP_EMAIL || '').trim().toLowerCase();
if (!/^scrolith-e2e-\d+-\d+(?:-(?:desktop-chrome|pixel-7|iphone-15|mobile-390))?-b@example\.invalid$/.test(email)) {
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
    const content = label === 'cross-account'
      ? `SCROLITH_CI_LONG_CONTENT_FIXTURE — Synthetic authenticated cross-account feed post. ${'This paragraph deliberately exercises realistic long-form post layout, wrapping, translation text bounds, and responsive action controls. '.repeat(12)}`
      : 'Synthetic viewer-account post used to validate authenticated feed rendering.';
    const existing = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
    if (existing && existing.authorId !== owner.id) {
      throw new Error('The deterministic certification fixture ID is already owned by another account.');
    }

    await prisma.communityPost.upsert({
      where: { id },
      update: {
        title: 'Certification feed fixture',
        content,
        visibility: 'public',
        status: 'active'
      },
      create: {
        id,
        authorId: owner.id,
        title: 'Certification feed fixture',
        content,
        visibility: 'public',
        status: 'active'
      }
    });
  };

  await Promise.all([
    seedPost(authorEmail, author, 'cross-account'),
    seedPost(email, viewer, 'viewer-account')
  ]);

  console.log('Synthetic cross-account feed fixtures are ready.');
} finally {
  await prisma.$disconnect();
  await pool.end();
}
