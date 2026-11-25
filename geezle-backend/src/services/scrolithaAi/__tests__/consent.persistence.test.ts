jest.mock('../../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    aIConsent: { findUnique: jest.fn() }
  }
}));

import prisma from '../../../utils/prismaClient';
import { getAIConsent, updateAIConsent } from '../consent';

const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  aIConsent: { findUnique: jest.Mock };
};

describe('AI consent persistence', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test('commits consent and its audit event in one serializable transaction before returning success', async () => {
    const userId = 'consent-persisted-test-user';
    const auditRows: Array<Record<string, unknown>> = [];
    let persistedConsent: Record<string, unknown> | null = null;
    mockPrisma.aIConsent.findUnique.mockImplementation(async () => persistedConsent);
    mockPrisma.$transaction.mockImplementation(async (work, options) => {
      expect(options).toMatchObject({ isolationLevel: 'Serializable' });
      return work({
        aIConsent: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(async ({ create }) => {
            persistedConsent = { ...create, updatedAt: new Date('2026-11-24T00:00:00.000Z') };
            return persistedConsent;
          })
        },
        aIAuditLog: {
          create: jest.fn(async ({ data }) => { auditRows.push(data); return data; })
        }
      });
    });

    const saved = await updateAIConsent(userId, {
      aiFeaturesEnabled: true,
      aiSuggestionsAllowed: true,
      externalProviderProcessingAllowed: false
    });

    expect(saved).toMatchObject({
      aiFeaturesEnabled: true,
      aiSuggestionsAllowed: true,
      externalProviderProcessingAllowed: false
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'consent.updated',
      actorUserId: userId,
      targetUserId: userId
    });
    expect(await getAIConsent(userId)).toMatchObject({ aiFeaturesEnabled: true });

    persistedConsent = { ...persistedConsent, aiFeaturesEnabled: false };
    expect(await getAIConsent(userId)).toMatchObject({ aiFeaturesEnabled: false });

    mockPrisma.aIConsent.findUnique.mockRejectedValue(new Error('database unavailable'));
    expect(await getAIConsent(userId)).toMatchObject({ aiFeaturesEnabled: false });
  });

  test('does not cache or report consent when the database transaction fails', async () => {
    const userId = 'consent-write-failure-test-user';
    mockPrisma.$transaction.mockRejectedValue(new Error('sensitive database detail must not escape'));
    mockPrisma.aIConsent.findUnique.mockResolvedValue(null);

    await expect(updateAIConsent(userId, { aiFeaturesEnabled: true }))
      .rejects.toThrow('AI consent could not be saved; please retry.');

    expect(await getAIConsent(userId)).toMatchObject({ aiFeaturesEnabled: false });
  });

  test('rolls back the consent update if its audit record cannot be written', async () => {
    const userId = 'consent-audit-failure-test-user';
    let committed: Record<string, unknown> | null = null;
    mockPrisma.aIConsent.findUnique.mockImplementation(async () => committed);
    mockPrisma.$transaction.mockImplementation(async (work) => {
      let pending: Record<string, unknown> | null = null;
      const result = await work({
        aIConsent: {
          findUnique: jest.fn(async () => committed),
          upsert: jest.fn(async ({ create }) => {
            pending = { ...create, updatedAt: new Date('2026-11-24T00:00:00.000Z') };
            return pending;
          })
        },
        aIAuditLog: {
          create: jest.fn().mockRejectedValue(new Error('audit unavailable'))
        }
      });
      committed = pending;
      return result;
    });

    await expect(updateAIConsent(userId, { aiFeaturesEnabled: true }))
      .rejects.toThrow('AI consent could not be saved; please retry.');

    expect(committed).toBeNull();
    expect(await getAIConsent(userId)).toMatchObject({ aiFeaturesEnabled: false });
  });
});
