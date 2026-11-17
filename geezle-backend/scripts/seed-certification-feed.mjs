import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

await import('./test-db-guard.mjs');

const email = String(process.env.SCROLITH_E2E_SIGNUP_EMAIL || '').trim().toLowerCase();
if (!/^scrolith-e2e-\d+-\d+-b@example\.invalid$/.test(email)) {
  throw new Error('Refusing to seed certification content for an unrecognized synthetic account.');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PRISMA_CONNECTION_LIMIT || 2),
  connectionTimeoutMillis: 10_000
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error('The synthetic certification account must exist before feed fixtures are seeded.');

  const suffix = createHash('sha256').update(email).digest('hex').slice(0, 28);
  const id = `cert-feed-${suffix}`;
  const existing = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
  if (existing && existing.authorId !== user.id) {
    throw new Error('The deterministic certification fixture ID is already owned by another account.');
  }

  await prisma.communityPost.upsert({
    where: { id },
    update: {
      title: 'Certification feed fixture',
      content: 'Synthetic post used to validate authenticated feed and post-card rendering.',
      visibility: 'public',
      status: 'active'
    },
    create: {
      id,
      authorId: user.id,
      title: 'Certification feed fixture',
      content: 'Synthetic post used to validate authenticated feed and post-card rendering.',
      visibility: 'public',
      status: 'active'
    }
  });
  console.log('Synthetic certification feed fixture is ready.');
} finally {
  await prisma.$disconnect();
  await pool.end();
}
