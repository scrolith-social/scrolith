import type { Express } from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient';
import { jwtSecret } from '../utils/security/requiredSecret';

const approved = process.env.SCROLITH_ROLE_HTTP_TEST_APPROVED === 'true';
const suite = approved ? describe : describe.skip;
const moneyMovementEnabled = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED === 'true';
// The actual production server imports the complete route graph; first-run
// ts-jest transformation can exceed the ordinary unit-test timeout.
jest.setTimeout(180_000);

const assertDisposableRuntimeTarget = () => {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL must explicitly target the disposable runtime role database');
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Runtime-role HTTP tests reject non-loopback database hosts');
  }
  if (!/(test|e2e)/i.test(parsed.pathname.split('/').filter(Boolean).at(-1) || '')) {
    throw new Error('Runtime-role HTTP tests require a disposable database name containing test or e2e');
  }
  if (parsed.username !== 'scrolith_runtime') {
    throw new Error('Runtime-role HTTP tests must connect with scrolith_runtime');
  }
};

if (approved) assertDisposableRuntimeTarget();

const tokenFor = (userId: string) => jwt.sign({ id: userId }, jwtSecret(), { expiresIn: '5m' });
const authenticatedAs = (userId: string) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

suite('financial-history routes under the runtime database role', () => {
  let app: Express;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const creatorUserId = `fin-history-creator-${suffix}`;
  const adminUserId = `fin-history-admin-${suffix}`;

  beforeAll(async () => {
    if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true' || process.env.ALLOW_DEV_ADMIN_BYPASS === 'true') {
      throw new Error('This actual-server integration must use JWT authentication, not the local development bypass');
    }
    app = (await import('../server')).default;
    await prisma.$connect();
    await prisma.user.create({ data: {
      id: creatorUserId,
      email: `${creatorUserId}@example.invalid`,
      role: 'FREELANCER'
    } });
    await prisma.user.create({ data: {
      id: adminUserId,
      email: `${adminUserId}@example.invalid`,
      role: 'ADMIN'
    } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('creator deletion archives paid ads, preserves payment evidence, and still deletes an unpaid draft', async () => {
    const draft = await request(app)
      .post('/api/community/ads/draft')
      .set(authenticatedAs(creatorUserId))
      .send({ title: `Retained paid ad ${suffix}`, body: 'synthetic', destinationUrl: 'https://example.invalid/retention', placement: 'feed', budget: 10, currency: 'USD' });
    expect(draft.status).toBe(200);
    const paidAdId = draft.body.data.id as string;

    // Seed a synthetic settled payment row directly: the checkout route can
    // contact a configured provider, which is outside this local role test.
    await prisma.adPayment.create({ data: {
      adId: paidAdId,
      transactionId: `synthetic-ad-payment-${suffix}`,
      amount: 10,
      currency: 'USD',
      status: 'completed'
    } });

    const deletion = await request(app)
      .delete(`/api/community/ads/${paidAdId}`)
      .set(authenticatedAs(creatorUserId));
    expect(deletion.status).toBe(200);
    expect(deletion.body.data).toMatchObject({ id: paidAdId, deleted: false, archived: true });
    const retainedAd = await prisma.communityAd.findUniqueOrThrow({ where: { id: paidAdId } });
    const retainedPayment = await prisma.adPayment.findFirstOrThrow({ where: { adId: paidAdId } });
    expect(retainedAd.status).toBe('ENDED');
    expect(retainedAd.archivedAt).toBeTruthy();
    expect(retainedAd.archiveReason).toBe('CREATOR_DELETE');
    expect(retainedPayment.transactionId).toBeTruthy();

    const unpaid = await request(app)
      .post('/api/community/ads/draft')
      .set(authenticatedAs(creatorUserId))
      .send({ title: `Unpaid disposable ad ${suffix}`, body: 'synthetic', destinationUrl: 'https://example.invalid/unpaid', placement: 'feed', budget: 10, currency: 'USD' });
    const unpaidId = unpaid.body.data.id as string;
    const removeUnpaid = await request(app)
      .delete(`/api/community/ads/${unpaidId}`)
      .set(authenticatedAs(creatorUserId));
    expect(removeUnpaid.status).toBe(200);
    expect(removeUnpaid.body.data).toMatchObject({ id: unpaidId, deleted: true, archived: false });
    expect(await prisma.communityAd.findUnique({ where: { id: unpaidId } })).toBeNull();
  });

  test('synthetic signed ad-payment webhook updates only permitted settlement fields', async () => {
    const draft = await request(app)
      .post('/api/community/ads/draft')
      .set(authenticatedAs(creatorUserId))
      .send({ title: `Webhook payment ad ${suffix}`, body: 'synthetic', destinationUrl: 'https://example.invalid/payment', placement: 'feed', budget: 10, currency: 'USD' });
    expect(draft.status).toBe(200);
    const adId = draft.body.data.id as string;
    const paymentIntentId = `pi_synthetic_${suffix}`;
    await prisma.adPayment.create({ data: {
      adId,
      transactionId: paymentIntentId,
      amount: 10,
      currency: 'USD',
      status: 'pending'
    } });

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret?.startsWith('whsec_local_synthetic_')) {
      throw new Error('HTTP role test requires its synthetic-only webhook signing secret');
    }
    const event = {
      id: `evt_synthetic_${suffix}`,
      object: 'event',
      api_version: '2023-10-16',
      created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: 1200,
        amount_received: 1200,
        currency: 'sgd',
        metadata: { adId }
      } },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'payment_intent.succeeded'
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = new Stripe('sk_test_scrolith_local_synthetic_only', {
      apiVersion: '2023-10-16' as any
    }).webhooks.generateTestHeaderString({
      payload: rawBody.toString('utf8'),
      secret,
      timestamp
    });
    const webhook = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(rawBody.toString('utf8'));
    if (!moneyMovementEnabled) {
      expect(webhook.status).toBe(503);
      expect(webhook.body).toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED' });
      expect(await prisma.adPayment.findFirstOrThrow({ where: { adId, transactionId: paymentIntentId } }))
        .toMatchObject({ amount: 10, currency: 'USD', status: 'pending' });
      expect(await prisma.communityAd.findUniqueOrThrow({ where: { id: adId } }))
        .toMatchObject({ status: 'DRAFT', paymentTransactionId: null });
      return;
    }
    if (webhook.status !== 200) throw new Error(`Synthetic payment webhook failed: ${webhook.text}`);
    expect(webhook.status).toBe(200);
    expect(await prisma.adPayment.findFirstOrThrow({ where: { adId, transactionId: paymentIntentId } }))
      .toMatchObject({ amount: 12, currency: 'SGD', status: 'completed' });
    expect(await prisma.communityAd.findUniqueOrThrow({ where: { id: adId } }))
      .toMatchObject({ status: 'SUBMITTED_FOR_REVIEW', paymentTransactionId: paymentIntentId });
  });

  test('a creator delete archives when a payment row already exists on a draft ad', async () => {
    const ad = await prisma.communityAd.create({ data: {
      creatorId: creatorUserId, title: `Concurrent payment ad ${suffix}`, body: 'synthetic',
      placement: 'feed', status: 'DRAFT', budget: 5, currency: 'USD'
    } });
    await prisma.adPayment.create({ data: { adId: ad.id, transactionId: `synthetic-${suffix}`, amount: 5, currency: 'USD', status: 'completed' } });

    const response = await request(app).delete(`/api/community/ads/${ad.id}`).set(authenticatedAs(creatorUserId));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: ad.id, deleted: false, archived: true });
    expect(await prisma.adPayment.count({ where: { adId: ad.id } })).toBe(1);
  });

  test('the mounted admin ads API can moderate a paid ad without deleting its payment history', async () => {
    const ad = await prisma.communityAd.create({ data: {
      creatorId: creatorUserId, title: `Admin retained ad ${suffix}`, body: 'synthetic',
      placement: 'feed', status: 'DRAFT', budget: 6, currency: 'USD'
    } });
    await prisma.adPayment.create({ data: { adId: ad.id, transactionId: `admin-synthetic-${suffix}`, amount: 6, currency: 'USD', status: 'completed' } });

    const adminDelete = await request(app)
      .delete(`/api/admin/community/ads/${ad.id}`)
      .set(authenticatedAs(adminUserId));
    expect(adminDelete.status).toBe(200);
    expect(adminDelete.body.data).toMatchObject({ id: ad.id, deleted: false, archived: true });
    expect(await prisma.communityAd.findUniqueOrThrow({ where: { id: ad.id } }))
      .toMatchObject({ status: 'ENDED', archiveReason: 'ADMIN_DELETE' });
    expect(await prisma.adPayment.count({ where: { adId: ad.id } })).toBe(1);

    const adminList = await request(app)
      .get('/api/community/admin/ads')
      .set(authenticatedAs(adminUserId));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.some((item: { id: string }) => item.id === ad.id)).toBe(true);

    const response = await request(app)
      .post(`/api/community/admin/ads/${ad.id}/reject`)
      .set(authenticatedAs(adminUserId))
      .send({ refund: false, notes: 'Synthetic moderation test' });
    expect(response.status).toBe(200);
    expect((await prisma.communityAd.findUniqueOrThrow({ where: { id: ad.id } })).status).toBe('REJECTED');
    expect(await prisma.adPayment.count({ where: { adId: ad.id } })).toBe(1);
  });

  test('unlike/re-like and post removal preserve Gcoin earning history', async () => {
    const post = await prisma.communityPost.create({ data: {
      authorId: creatorUserId, content: `Synthetic Gcoin retention post ${suffix}`
    } });
    const liked = await request(app).post(`/api/community/posts/${post.id}/like`).set(authenticatedAs(creatorUserId));
    expect(liked.status).toBe(200);
    const eventKey = `${post.id}:like:${creatorUserId}:${new Date().toISOString().slice(0, 10)}`;

    const unliked = await request(app).delete(`/api/community/posts/${post.id}/like`).set(authenticatedAs(creatorUserId));
    expect(unliked.status).toBe(200);
    let event = await prisma.gcoinEarningEvent.findUniqueOrThrow({ where: { eventKey } });
    expect(event).toMatchObject({ reactionActive: false, reversalCount: 1 });
    expect(event.reversedAt).toBeTruthy();

    const reliked = await request(app).post(`/api/community/posts/${post.id}/like`).set(authenticatedAs(creatorUserId));
    expect(reliked.status).toBe(200);
    event = await prisma.gcoinEarningEvent.findUniqueOrThrow({ where: { eventKey } });
    expect(event.reactionActive).toBe(true);
    expect(event.reversalCount).toBe(1);
    expect(event.reversedAt).toBeTruthy();
    expect(await prisma.gcoinEarningEvent.count({ where: { postId: post.id } })).toBe(1);

    const removed = await request(app).delete(`/api/community/posts/${post.id}`).set(authenticatedAs(creatorUserId));
    expect(removed.status).toBe(200);
    expect((await prisma.communityPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('deleted');
    expect(await prisma.gcoinEarningEvent.count({ where: { postId: post.id } })).toBe(1);
  });

  test('account deletion soft-deactivates the user and retains their Gcoin actor reference', async () => {
    const target = await prisma.user.create({ data: {
      id: `retained-account-${suffix}`, email: `retained-account-${suffix}@example.invalid`, role: 'CLIENT'
    } });
    const post = await prisma.communityPost.create({ data: {
      authorId: target.id, content: `Synthetic account event post ${suffix}`
    } });
    const eventKey = `retained-account-event-${suffix}`;
    await prisma.gcoinEarningEvent.create({ data: {
      postId: post.id, actorId: target.id, eventType: 'view', eventKey, credited: false
    } });

    const response = await request(app)
      .delete(`/api/admin/users/${target.id}`)
      .set(authenticatedAs(adminUserId));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ userId: target.id, isActive: false, remainsListed: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(false);
    expect((await prisma.gcoinEarningEvent.findUniqueOrThrow({ where: { eventKey } })).actorId).toBe(target.id);
  });

  test('Founding Partner admin routes preserve enabled flows and fail closed when money movement is disabled', async () => {
    const programsBefore = await prisma.foundingPartnerProgram.findMany();
    const programUpdate = await request(app)
      .post('/api/admin/founding-partners/program/status')
      .set(authenticatedAs(adminUserId))
      .send({ status: 'ACTIVE' });
    if (!moneyMovementEnabled) {
      expect(programUpdate.status).toBe(503);
      expect(programUpdate.body).toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED' });
      expect(await prisma.foundingPartnerProgram.findMany()).toEqual(programsBefore);
      return;
    }
    expect(programUpdate.status).toBe(200);

    const partnerUser = await prisma.user.create({ data: {
      id: `retained-partner-${suffix}`, email: `retained-partner-${suffix}@example.invalid`, role: 'CLIENT'
    } });
    const program = await prisma.foundingPartnerProgram.findUniqueOrThrow({ where: { programKey: 'founding-partners' } });
    const partner = await prisma.foundingPartner.create({ data: {
      programId: program.id, userId: partnerUser.id, fullName: 'Synthetic partner', country: 'XX', city: 'Test City',
      termsVersion: 'synthetic-v1', termsAcceptedAt: new Date()
    } });

    const deactivate = await request(app)
      .post(`/api/admin/founding-partners/partners/${partner.id}/deactivate`)
      .set(authenticatedAs(adminUserId))
      .send({ reason: 'runtime role integration test' });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.status).toBe('DEACTIVATED');
    const reactivate = await request(app)
      .post(`/api/admin/founding-partners/partners/${partner.id}/reactivate`)
      .set(authenticatedAs(adminUserId))
      .send({});
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.status).toBe('ACTIVE');

    const existingPeriods = await prisma.foundingPartnerProfitPeriod.findMany({
      where: { programId: program.id },
      select: { periodYear: true }
    });
    const occupiedYears = new Set(existingPeriods.map((period) => period.periodYear));
    const year = Array.from({ length: 181 }, (_, index) => 2200 - index)
      .find((candidate) => !occupiedYears.has(candidate));
    if (year === undefined) throw new Error('No unused synthetic founding-partner year is available');
    const period = await request(app)
      .post('/api/admin/founding-partners/profit-periods')
      .set(authenticatedAs(adminUserId))
      .send({ year, notes: 'synthetic period', sources: [{ sourceType: `test-${suffix}`, clearedAmount: 100, adjustments: 0, notes: 'synthetic source' }] });
    if (period.status !== 200) throw new Error(`Synthetic profit-period request failed: ${JSON.stringify(period.body)}`);
    expect(period.status).toBe(200);
    const periodId = period.body.data.id as string;

    const openUpdate = await request(app)
      .post('/api/admin/founding-partners/profit-periods')
      .set(authenticatedAs(adminUserId))
      .send({ year, notes: 'updated while open', sources: [{ sourceType: `test-${suffix}`, clearedAmount: 125, adjustments: 5, notes: 'updated source' }] });
    expect(openUpdate.status).toBe(200);
    const updatedSource = await prisma.foundingPartnerProfitSource.findUniqueOrThrow({
      where: { periodId_sourceType: { periodId, sourceType: `test-${suffix}` } }
    });
    expect(openUpdate.body.data.notes).toBe('updated while open');
    expect(updatedSource.clearedAmount.toString()).toBe('125');
    expect(updatedSource.adjustments.toString()).toBe('5');

    const close = await request(app)
      .post(`/api/admin/founding-partners/profit-periods/${periodId}/close`)
      .set(authenticatedAs(adminUserId))
      .send({});
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');

    const closedBefore = await prisma.foundingPartnerProfitPeriod.findUniqueOrThrow({
      where: { id: periodId }, include: { sources: true }
    });
    const closedUpdate = await request(app)
      .post('/api/admin/founding-partners/profit-periods')
      .set(authenticatedAs(adminUserId))
      .send({ year, notes: 'must not persist', sources: [{ sourceType: `test-${suffix}`, clearedAmount: 999, adjustments: 0, notes: 'must not persist' }] });
    expect(closedUpdate.status).toBe(400);
    expect(await prisma.foundingPartnerProfitPeriod.findUniqueOrThrow({
      where: { id: periodId }, include: { sources: true }
    })).toEqual(closedBefore);
  });

  test('concurrent close and open-period writes preserve enabled behavior and fail closed when disabled', async () => {
    const existingPeriods = await prisma.foundingPartnerProfitPeriod.findMany({
      select: { periodYear: true }
    });
    const occupiedYears = new Set(existingPeriods.map((period) => period.periodYear));
    const year = Array.from({ length: 181 }, (_, index) => 2200 - index)
      .find((candidate) => !occupiedYears.has(candidate));
    if (year === undefined) throw new Error('No unused synthetic founding-partner year is available');

    if (!moneyMovementEnabled) {
      const [create, close] = await Promise.all([
        request(app)
          .post('/api/admin/founding-partners/profit-periods')
          .set(authenticatedAs(adminUserId))
          .send({ year, notes: 'must remain blocked', sources: [{ sourceType: `blocked-${suffix}`, clearedAmount: 100, adjustments: 0, notes: 'synthetic' }] }),
        request(app)
          .post(`/api/admin/founding-partners/profit-periods/blocked-${suffix}/close`)
          .set(authenticatedAs(adminUserId))
          .send({})
      ]);
      for (const response of [create, close]) {
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED' });
      }
      expect(await prisma.foundingPartnerProfitPeriod.findMany({ where: { periodYear: year } })).toHaveLength(0);
      return;
    }

    const create = await request(app)
      .post('/api/admin/founding-partners/profit-periods')
      .set(authenticatedAs(adminUserId))
      .send({ year, notes: 'race baseline', sources: [{ sourceType: `race-${suffix}`, clearedAmount: 100, adjustments: 0, notes: 'baseline' }] });
    expect(create.status).toBe(200);
    const periodId = create.body.data.id as string;

    const [updateResponse, closeResponse] = await Promise.all([
      request(app)
        .post('/api/admin/founding-partners/profit-periods')
        .set(authenticatedAs(adminUserId))
        .send({ year, notes: 'race update', sources: [{ sourceType: `race-${suffix}`, clearedAmount: 150, adjustments: 10, notes: 'racing update' }] }),
      request(app)
        .post(`/api/admin/founding-partners/profit-periods/${periodId}/close`)
        .set(authenticatedAs(adminUserId))
        .send({})
    ]);

    expect(closeResponse.status).toBe(200);
    expect([200, 400]).toContain(updateResponse.status);
    const afterRace = await prisma.foundingPartnerProfitPeriod.findUniqueOrThrow({
      where: { id: periodId }, include: { sources: true }
    });
    expect(afterRace.status).toBe('CLOSED');
    const source = afterRace.sources.find((item) => item.sourceType === `race-${suffix}`);
    expect(source).toBeDefined();
    if (updateResponse.status === 200) {
      expect(afterRace.notes).toBe('race update');
      expect(source?.clearedAmount.toString()).toBe('150');
      expect(source?.adjustments.toString()).toBe('10');
      expect(afterRace.clearedProfit.toString()).toBe('160');
    } else {
      expect(afterRace.notes).toBe('race baseline');
      expect(source?.clearedAmount.toString()).toBe('100');
      expect(afterRace.clearedProfit.toString()).toBe('100');
    }

    const lateUpdate = await request(app)
      .post('/api/admin/founding-partners/profit-periods')
      .set(authenticatedAs(adminUserId))
      .send({ year, notes: 'late mutation', sources: [{ sourceType: `race-${suffix}`, clearedAmount: 500, adjustments: 0, notes: 'late mutation' }] });
    expect(lateUpdate.status).toBe(400);
    expect(await prisma.foundingPartnerProfitPeriod.findUniqueOrThrow({
      where: { id: periodId }, include: { sources: true }
    })).toEqual(afterRace);
  });

  test('actual server admin routes require JWT authentication and administrator authorization', async () => {
    const unauthenticated = await request(app).get('/api/admin/users');
    expect(unauthenticated.status).toBe(401);

    const regularUser = await request(app)
      .get('/api/admin/users')
      .set(authenticatedAs(creatorUserId));
    expect(regularUser.status).toBe(403);

    const administrator = await request(app)
      .get('/api/admin/users')
      .set(authenticatedAs(adminUserId));
    expect(administrator.status).toBe(200);

    const userCannotViewAds = await request(app)
      .get('/api/community/admin/ads')
      .set(authenticatedAs(creatorUserId));
    expect(userCannotViewAds.status).toBe(403);
    const administratorCanViewAds = await request(app)
      .get('/api/community/admin/ads')
      .set(authenticatedAs(adminUserId));
    expect(administratorCanViewAds.status).toBe(200);
  });
});

if (!approved) {
  test.skip('runtime-role HTTP integration requires explicit disposable-target approval', () => undefined);
}
