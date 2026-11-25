import type { Express } from 'express';
import request from 'supertest';
import prisma from '../utils/prismaClient';
import { issueAuthSessionToken } from '../services/authSession.service';

const approved = process.env.SCROLITH_ROLE_HTTP_TEST_APPROVED === 'true';
const suite = approved ? describe : describe.skip;
jest.setTimeout(180_000);

const assertDisposableRuntimeTarget = () => {
  let parsed: URL;
  try {
    parsed = new URL(String(process.env.DATABASE_URL || ''));
  } catch {
    throw new Error('Profile runtime-role HTTP test requires an explicit disposable loopback DATABASE_URL.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = parsed.pathname.split('/').filter(Boolean).at(-1) || '';
  if (!['localhost', '127.0.0.1', '::1'].includes(host) ||
      !/(test|e2e)/i.test(database) ||
      parsed.username !== 'scrolith_runtime' ||
      Number(parsed.port) !== Number(process.env.TEST_DB_PORT || 0) ||
      process.env.TEST_DB_PROJECT !== 'local-only' ||
      process.env.DISABLE_BACKGROUND_WORKERS !== 'true' ||
      process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    throw new Error('Profile runtime-role HTTP test refuses an unmarked or non-runtime database target.');
  }
};

if (approved) assertDisposableRuntimeTarget();

suite('authenticated profile save through the production server and runtime role', () => {
  let app: Express;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = `profile-runtime-${suffix}`;
  let token = '';

  beforeAll(async () => {
    if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
      throw new Error('This integration must use a durable JWT session, not the development auth bypass.');
    }
    app = (await import('../server')).default;
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        role: 'FREELANCER',
        isActive: true
      }
    });
    token = await issueAuthSessionToken(userId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('GET creates/reloads a profile and PUT persists editable fields with HTTP success', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const firstRead = await request(app).get('/api/profile/me').set(auth);
    expect(firstRead.status).toBe(200);
    expect(firstRead.body.success).toBe(true);
    expect(firstRead.body.data.user_id).toBe(userId);

    const update = await request(app)
      .put('/api/profile/me')
      .set(auth)
      .send({
        title: 'Synthetic profile permission regression',
        bio: 'Disposable PostgreSQL runtime-role integration fixture',
        skills: ['synthetic-profile-test']
      });
    expect(update.status).toBe(200);
    expect(update.body.success).toBe(true);
    expect(update.body.data).toMatchObject({
      title: 'Synthetic profile permission regression',
      bio: 'Disposable PostgreSQL runtime-role integration fixture',
      skills: ['synthetic-profile-test']
    });

    const reloaded = await request(app).get('/api/profile/me').set(auth);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.success).toBe(true);
    expect(reloaded.body.data).toMatchObject({
      user_id: userId,
      title: 'Synthetic profile permission regression',
      bio: 'Disposable PostgreSQL runtime-role integration fixture',
      skills: ['synthetic-profile-test']
    });
  });
});
