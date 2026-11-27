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
  const followeeId = `profile-runtime-followee-${suffix}`;
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
        isActive: true,
        followOnboardingRequired: true
      }
    });
    await prisma.user.create({
      data: {
        id: followeeId,
        email: `${followeeId}@example.invalid`,
        role: 'FREELANCER',
        isActive: true
      }
    });
    await prisma.userFollow.create({ data: { followerId: userId, followeeId } });
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

  test('language preference save and follow onboarding completion persist and reload under the narrow runtime role', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const privileges: Array<{
      role_name: string;
      table_update: boolean;
      language_confirmed_update: boolean;
      language_updated_at_update: boolean;
      understood_languages_update: boolean;
      onboarding_required_update: boolean;
      onboarding_completed_at_update: boolean;
      updated_at_update: boolean;
      two_factor_secret_update: boolean;
    }> = await prisma.$queryRawUnsafe(`
      SELECT current_user AS role_name,
             has_table_privilege(current_user, 'public.\"User\"', 'UPDATE') AS table_update,
             has_column_privilege(current_user, 'public.\"User\"', 'languagePreferencesConfirmed', 'UPDATE') AS language_confirmed_update,
             has_column_privilege(current_user, 'public.\"User\"', 'languagePreferencesUpdatedAt', 'UPDATE') AS language_updated_at_update,
             has_column_privilege(current_user, 'public.\"User\"', 'understoodLanguages', 'UPDATE') AS understood_languages_update,
             has_column_privilege(current_user, 'public.\"User\"', 'followOnboardingRequired', 'UPDATE') AS onboarding_required_update,
             has_column_privilege(current_user, 'public.\"User\"', 'followOnboardingCompletedAt', 'UPDATE') AS onboarding_completed_at_update,
             has_column_privilege(current_user, 'public.\"User\"', 'updatedAt', 'UPDATE') AS updated_at_update,
             has_column_privilege(current_user, 'public.\"User\"', 'twoFactorSecret', 'UPDATE') AS two_factor_secret_update
    `);
    expect(privileges).toEqual([{
      role_name: 'scrolith_runtime',
      table_update: false,
      language_confirmed_update: true,
      language_updated_at_update: true,
      understood_languages_update: true,
      onboarding_required_update: true,
      onboarding_completed_at_update: true,
      updated_at_update: true,
      two_factor_secret_update: false
    }]);

    const before = await request(app).get('/api/auth/follow-onboarding').set(auth);
    expect(before.status).toBe(200);
    expect(before.body.data.onboarding).toMatchObject({ required: true, followedCount: 1, canContinue: true });

    const saved = await request(app)
      .put('/api/auth/me/language-preferences')
      .set(auth)
      .send({ understoodLanguages: ['en'], confirm: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      success: true,
      data: { understoodLanguages: ['en'], languagePreferencesConfirmed: true }
    });
    expect(saved.body.data.languagePreferencesUpdatedAt).toEqual(expect.any(String));

    const preferencesReload = await request(app).get('/api/auth/me/language-preferences').set(auth);
    expect(preferencesReload.status).toBe(200);
    expect(preferencesReload.body.data).toMatchObject({
      understoodLanguages: ['en'],
      languagePreferencesConfirmed: true,
      languagePreferencesUpdatedAt: saved.body.data.languagePreferencesUpdatedAt
    });

    const completed = await request(app).post('/api/auth/follow-onboarding/complete').set(auth).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.data.onboarding).toMatchObject({ required: false, followedCount: 1, canContinue: true });
    expect(completed.body.data.onboarding.completedAt).toEqual(expect.any(String));

    const onboardingReload = await request(app).get('/api/auth/follow-onboarding').set(auth);
    expect(onboardingReload.status).toBe(200);
    expect(onboardingReload.body.data.onboarding).toMatchObject({
      required: false,
      followedCount: 1,
      canContinue: true,
      completedAt: completed.body.data.onboarding.completedAt
    });

    await expect(prisma.$executeRawUnsafe(
      `UPDATE public.\"User\" SET \"twoFactorSecret\" = NULL WHERE \"id\" = $1`, userId
    )).rejects.toThrow(/permission denied/i);
  });
});
