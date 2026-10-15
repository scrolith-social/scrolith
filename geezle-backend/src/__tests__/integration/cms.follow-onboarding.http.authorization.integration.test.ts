import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { DEFAULT_FOLLOW_ONBOARDING_CONTENT } from '../../utils/followOnboardingContent';

type SyntheticUser = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
};

type SyntheticStaff = {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  role: {
    name: string;
    isActive: boolean;
    rolePermissions: Array<{ permission: { key: string } }>;
  };
};

const mockState = {
  users: new Map<string, SyntheticUser>(),
  staff: new Map<string, SyntheticStaff>(),
  setting: null as { scope: string; data: unknown } | null,
  auditEvents: [] as Array<Record<string, unknown>>,
  deniedDecisions: [] as Array<Record<string, unknown>>,
  securityAlerts: [] as Array<Record<string, unknown>>,
  eventNames: [] as string[]
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(async ({ where }: any) => mockState.users.get(String(where?.id)) || null)
  },
  staffUser: {
    findUnique: jest.fn(async ({ where }: any) => mockState.staff.get(String(where?.userId)) || null)
  },
  staffPermission: {
    upsert: jest.fn(async ({ where }: any) => ({ id: `permission-${String(where?.key || 'seed')}` })),
    findMany: jest.fn(async () => [
      { id: 'permission-cms-read', key: 'cms.read' },
      { id: 'permission-cms-manage', key: 'cms.manage' }
    ])
  },
  staffRole: {
    upsert: jest.fn(async () => ({ id: 'role-seed' }))
  },
  staffRolePermission: {
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(async () => ({ count: 0 }))
  },
  appSetting: {
    findUnique: jest.fn(async () => mockState.setting),
    upsert: jest.fn(async ({ create, update }: any) => {
      mockState.setting = mockState.setting
        ? { ...mockState.setting, data: update.data }
        : { scope: create.scope, data: create.data };
      return mockState.setting;
    })
  },
  adminAuditEvent: {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `audit-${mockState.auditEvents.length + 1}`, ...data };
      mockState.auditEvents.push(row);
      return row;
    })
  },
  permissionDecisionLog: {
    create: jest.fn(async ({ data }: any) => {
      mockState.deniedDecisions.push(data);
      return data;
    })
  },
  securityAlert: {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `alert-${mockState.securityAlerts.length + 1}`, ...data };
      mockState.securityAlerts.push(row);
      return row;
    })
  },
  $transaction: jest.fn(async (operation: any) => {
    if (typeof operation === 'function') return operation({ ...mockPrisma });
    return Promise.all(operation);
  })
};

jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: mockPrisma
}));

const JWT_SECRET = 'local_test_jwt_secret';
const CONTENT_SCOPE = 'cms_follow_onboarding';

let app: express.Express;

const tokenFor = (user: SyntheticUser) =>
  jwt.sign({ id: user.id }, String(process.env.JWT_SECRET || JWT_SECRET), { expiresIn: '5m' });

const seedUser = (user: SyntheticUser, staff?: SyntheticStaff) => {
  mockState.users.set(user.id, user);
  if (staff) mockState.staff.set(user.id, staff);
};

const staff = (
  roleName: string,
  permissionKeys: string[]
): SyntheticStaff => ({
  id: `staff-${roleName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
  status: 'ACTIVE',
  role: {
    name: roleName,
    isActive: true,
    rolePermissions: permissionKeys.map((key) => ({ permission: { key } }))
  }
});

const authorizationHeader = (user: SyntheticUser) => ({
  Authorization: `Bearer ${tokenFor(user)}`
});

describe('Follow Onboarding CMS HTTP authorization', () => {
  const previousEnv = { ...process.env };

  beforeAll(() => {
    // Load the real route and middleware chain only after the synthetic Prisma
    // adapter has been initialized by this test module.
    const cmsRoutes = require('../../routes/cms').default;
    const { adminMiddleware: realAdminMiddleware } = require('../../middleware/admin.middleware');
    app = express();
    app.use(express.json());
    app.use('/api/cms', cmsRoutes);
    app.set('io', { emit: jest.fn((event: string) => mockState.eventNames.push(event)) });
    app.set('communityIo', { emit: jest.fn((event: string) => mockState.eventNames.push(event)) });
    app.get('/test/admin-bypass', realAdminMiddleware, (_req, res) => res.status(204).end());
  });

  beforeEach(() => {
    mockState.users.clear();
    mockState.staff.clear();
    mockState.setting = null;
    mockState.auditEvents.length = 0;
    mockState.deniedDecisions.length = 0;
    mockState.securityAlerts.length = 0;
    mockState.eventNames.length = 0;
    process.env.NODE_ENV = 'test';
    process.env.APP_RUNTIME = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
    process.env.ALLOW_DEV_ADMIN_BYPASS = 'false';
    delete process.env.ALLOW_DEV_BYPASS_LOCAL_ONLY;
    delete process.env.CONTAINER_APP_NAME;
    delete process.env.CONTAINER_APP_REVISION;
    delete process.env.K_SERVICE;
  });

  afterAll(() => {
    process.env = { ...previousEnv };
  });

  test('unauthenticated administrative GET and PUT return 401', async () => {
    const body = { ...DEFAULT_FOLLOW_ONBOARDING_CONTENT };

    const getResponse = await request(app).get('/api/cms/admin/follow-onboarding/content');
    const putResponse = await request(app)
      .put('/api/cms/admin/follow-onboarding/content')
      .send(body);

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
  });

  test('ordinary users cannot modify content and denied PUT has no successful persistence side effects', async () => {
    const ordinaryUser: SyntheticUser = {
      id: 'ordinary-user',
      email: 'ordinary@example.invalid',
      role: 'USER',
      isActive: true
    };
    seedUser(ordinaryUser);

    const response = await request(app)
      .put('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(ordinaryUser))
      .send({ ...DEFAULT_FOLLOW_ONBOARDING_CONTENT });

    expect(response.status).toBe(403);
    expect(mockState.setting).toBeNull();
    expect(mockState.auditEvents.filter((event) => event.status === 'success')).toHaveLength(0);
    expect(mockState.eventNames).toEqual([]);
  });

  test('cms.read staff can read but cannot update', async () => {
    const reader: SyntheticUser = {
      id: 'cms-reader',
      email: 'reader@example.invalid',
      role: 'USER',
      isActive: true
    };
    seedUser(reader, staff('Content Manager', ['cms.read']));

    const getResponse = await request(app)
      .get('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(reader));
    const putResponse = await request(app)
      .put('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(reader))
      .send({ ...DEFAULT_FOLLOW_ONBOARDING_CONTENT });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.success).toBe(true);
    expect(putResponse.status).toBe(403);
    expect(mockState.setting).toBeNull();
    expect(mockState.auditEvents.filter((event) => event.status === 'success')).toHaveLength(0);
  });

  test('ADMIN and cms.manage staff retain intended GET/PUT access', async () => {
    const administrator: SyntheticUser = {
      id: 'platform-admin',
      email: 'admin@example.invalid',
      role: 'ADMIN',
      isActive: true
    };
    const manager: SyntheticUser = {
      id: 'cms-manager',
      email: 'manager@example.invalid',
      role: 'USER',
      isActive: true
    };
    seedUser(administrator);
    seedUser(manager, staff('Author/Editor/Writer', ['cms.read', 'cms.manage']));

    const adminGet = await request(app)
      .get('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(administrator));
    const adminPut = await request(app)
      .put('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(administrator))
      .send({ ...DEFAULT_FOLLOW_ONBOARDING_CONTENT });
    const managerPut = await request(app)
      .put('/api/cms/admin/follow-onboarding/content')
      .set(authorizationHeader(manager))
      .send({
        ...DEFAULT_FOLLOW_ONBOARDING_CONTENT,
        hero: { ...DEFAULT_FOLLOW_ONBOARDING_CONTENT.hero, title: 'Managed update' }
      });

    expect(adminGet.status).toBe(200);
    expect(adminPut.status).toBe(200);
    expect(managerPut.status).toBe(200);
    expect(mockState.setting?.scope).toBe(CONTENT_SCOPE);
    expect(mockState.auditEvents.filter((event) => event.status === 'success')).toHaveLength(2);
    expect(mockState.eventNames).toHaveLength(4);
  });

  test.each(['Finance Admin', 'staff_admin', 'not_admin'])(
    'role %s cannot acquire administrator privileges through substring matching',
    async (role) => {
      const user: SyntheticUser = {
        id: `role-${role.replace(/[^a-z0-9]+/gi, '-')}`,
        email: `${role.replace(/[^a-z0-9]+/gi, '-')}@example.invalid`,
        role,
        isActive: true
      };
      seedUser(user);

      const response = await request(app)
        .put('/api/cms/admin/follow-onboarding/content')
        .set(authorizationHeader(user))
        .send({ ...DEFAULT_FOLLOW_ONBOARDING_CONTENT });

      expect(response.status).toBe(403);
      expect(mockState.setting).toBeNull();
      expect(mockState.auditEvents.filter((event) => event.status === 'success')).toHaveLength(0);
      expect(mockState.eventNames).toEqual([]);
    }
  );

  test.each(['development', 'test'])('Azure-managed runtime rejects %s-mode auth and administrator bypasses', async (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.ALLOW_DEV_BYPASS_LOCAL_ONLY = 'true';
    process.env.CONTAINER_APP_NAME = 'synthetic-staging-app';
    process.env.ALLOW_DEV_ADMIN_BYPASS = 'true';

    const authResponse = await request(app)
      .get('/api/cms/admin/follow-onboarding/content');
    const adminBypassResponse = await request(app).get('/test/admin-bypass');

    expect(authResponse.status).toBe(401);
    expect(adminBypassResponse.status).toBe(403);
  });
});
