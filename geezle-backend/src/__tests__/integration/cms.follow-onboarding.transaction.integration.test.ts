import prisma, { disconnectPrisma } from '../../utils/prismaClient';
import {
  DEFAULT_FOLLOW_ONBOARDING_CONTENT,
  FollowOnboardingContent
} from '../../utils/followOnboardingContent';
import { saveFollowOnboardingContent } from '../../controllers/cms.follow-onboarding.controller';

const CONTENT_SCOPE = 'cms_follow_onboarding';
const AUDIT_ACTION = 'follow_onboarding.content.update';

const assertDisposableLocalTarget = () => {
  const rawUrl = String(process.env.DATABASE_URL || '').trim();
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\/+/, '').toLowerCase();
  if (!['127.0.0.1', 'localhost'].includes(host) || database !== 'scrolith_test') {
    throw new Error(`Refusing CMS integration test against non-disposable database target: ${host}/${database}`);
  }
  if (String(process.env.TEST_DB_KIND || '').trim() !== 'local-disposable') {
    throw new Error('CMS integration test requires TEST_DB_KIND=local-disposable');
  }
}

const response = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const request = (events: string[]) => ({
  headers: {},
  app: {
    get: (key: string) => ({ emit: () => events.push(key) })
  },
  body: DEFAULT_FOLLOW_ONBOARDING_CONTENT
});
const save = async (body: FollowOnboardingContent, events: string[]) => {
  const res = response();
  await saveFollowOnboardingContent({ ...request(events), body } as any, res);
  return res;
};

describe('Follow Onboarding CMS transaction integration', () => {
  beforeAll(async () => {
    assertDisposableLocalTarget();
    await prisma.$connect();
    await prisma.appSetting.deleteMany({ where: { scope: CONTENT_SCOPE } });
    await prisma.adminAuditEvent.deleteMany({ where: { entityId: CONTENT_SCOPE, actionKey: AUDIT_ACTION } });
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_follow_onboarding_audit ON "AdminAuditEvent"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_follow_onboarding_audit()');
    await prisma.appSetting.deleteMany({ where: { scope: CONTENT_SCOPE } });
    await prisma.adminAuditEvent.deleteMany({ where: { entityId: CONTENT_SCOPE, actionKey: AUDIT_ACTION } });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('commits content and durable audit together before emitting notifications', async () => {
    const events: string[] = [];
    const content = {
      ...DEFAULT_FOLLOW_ONBOARDING_CONTENT,
      hero: { ...DEFAULT_FOLLOW_ONBOARDING_CONTENT.hero, title: 'Disposable transaction success' }
    };

    const res = await save(content, events);
    const setting = await prisma.appSetting.findUnique({ where: { scope: CONTENT_SCOPE } });
    const audit = await prisma.adminAuditEvent.findFirst({
      where: { entityId: CONTENT_SCOPE, actionKey: AUDIT_ACTION },
      orderBy: { createdAt: 'desc' }
    });

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ hero: content.hero }) });
    expect(setting?.data).toEqual(expect.objectContaining({ hero: content.hero }));
    expect(audit).toEqual(expect.objectContaining({ entityId: CONTENT_SCOPE, actionKey: AUDIT_ACTION, status: 'success' }));
    expect(events).toEqual(['io', 'communityIo']);
  });

  it('rolls back content and emits nothing when audit persistence fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_follow_onboarding_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic audit failure';
      END;
      $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_follow_onboarding_audit
      BEFORE INSERT ON "AdminAuditEvent"
      FOR EACH ROW EXECUTE FUNCTION test_fail_follow_onboarding_audit();
    `);

    const events: string[] = [];
    const res = await save({
      ...DEFAULT_FOLLOW_ONBOARDING_CONTENT,
      hero: { ...DEFAULT_FOLLOW_ONBOARDING_CONTENT.hero, title: 'Disposable transaction rollback' }
    }, events);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to save onboarding content' });
    expect(await prisma.appSetting.findUnique({ where: { scope: CONTENT_SCOPE } })).toBeNull();
    expect(await prisma.adminAuditEvent.count({ where: { entityId: CONTENT_SCOPE, actionKey: AUDIT_ACTION } })).toBe(0);
    expect(events).toEqual([]);
  });
});
