const mockPrisma = {
  user: { findUnique: jest.fn() },
  job: { findMany: jest.fn(), findFirst: jest.fn() },
  gig: { findMany: jest.fn(), findFirst: jest.fn() }
};

jest.mock('../../../utils/prismaClient', () => ({
  __esModule: true,
  default: mockPrisma
}));

import { prismaMcpDataSource } from '../scrolithaMcp.data';

describe('Scrolitha MCP Prisma data boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('binds profile reads to the verified subject and excludes authentication secrets', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'account-a',
      email: 'a@example.test',
      name: 'Account A',
      role: 'USER',
      isActive: true,
      profile: null
    });

    await expect(prismaMcpDataSource.getMyProfile('account-a')).resolves.toEqual(expect.objectContaining({
      id: 'account-a'
    }));

    const query = mockPrisma.user.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'account-a' });
    expect(query.select).not.toHaveProperty('passwordHash');
    expect(query.select).not.toHaveProperty('refreshToken');
    expect(query.select).not.toHaveProperty('twoFactorSecret');
    expect(query.select).not.toHaveProperty('role');
    expect(await prismaMcpDataSource.getMyProfile('account-a')).not.toHaveProperty('role');
  });

  test('keeps independently authenticated profile reads bound to their own subjects', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'account-a',
        email: 'a@example.test',
        name: 'Account A',
        isActive: true,
        profile: null
      })
      .mockResolvedValueOnce({
        id: 'account-b',
        email: 'b@example.test',
        name: 'Account B',
        isActive: true,
        profile: null
      });

    const accountA = await prismaMcpDataSource.getMyProfile('account-a');
    const accountB = await prismaMcpDataSource.getMyProfile('account-b');

    expect(mockPrisma.user.findUnique.mock.calls.map(([query]) => query.where)).toEqual([
      { id: 'account-a' },
      { id: 'account-b' }
    ]);
    expect(accountA).toEqual(expect.objectContaining({ id: 'account-a', email: 'a@example.test' }));
    expect(accountB).toEqual(expect.objectContaining({ id: 'account-b', email: 'b@example.test' }));
    expect(accountA).not.toEqual(expect.objectContaining({ id: 'account-b', email: 'b@example.test' }));
    expect(accountB).not.toEqual(expect.objectContaining({ id: 'account-a', email: 'a@example.test' }));
  });

  test('does not expose inactive profiles', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'inactive-account',
      email: 'inactive@example.test',
      name: 'Inactive',
      role: 'USER',
      isActive: false,
      profile: null
    });

    await expect(prismaMcpDataSource.getMyProfile('inactive-account')).resolves.toBeNull();
  });

  test('searches only active, visible, public, approved jobs', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);
    await prismaMcpDataSource.searchJobs('account-a', { limit: 10, offset: 0 });

    const query = mockPrisma.job.findMany.mock.calls[0][0];
    expect(query.where).toEqual(expect.objectContaining({
      status: 'ACTIVE',
      isActive: true,
      isVisible: true,
      visibility: 'PUBLIC',
      adminStatus: 'APPROVED'
    }));
    expect(query.select.client.select).toEqual({ id: true, name: true, avatar: true });
  });

  test('applies the same public/approved boundary to job details', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);
    await expect(prismaMcpDataSource.getJobDetails('account-a', 'job-b')).resolves.toBeNull();

    const query = mockPrisma.job.findFirst.mock.calls[0][0];
    expect(query.where).toEqual(expect.objectContaining({
      id: 'job-b',
      status: 'ACTIVE',
      isActive: true,
      isVisible: true,
      visibility: 'PUBLIC',
      adminStatus: 'APPROVED'
    }));
  });

  test('searches only active, approved gigs and returns bounded media', async () => {
    mockPrisma.gig.findMany.mockResolvedValue([]);
    await prismaMcpDataSource.searchGigs('account-a', { limit: 10, offset: 0 });

    const query = mockPrisma.gig.findMany.mock.calls[0][0];
    expect(query.where).toEqual(expect.objectContaining({
      status: 'ACTIVE',
      isActive: true,
      adminStatus: 'APPROVED'
    }));
    expect(query.select.user.select).toEqual({ id: true, name: true, avatar: true });
  });
});
