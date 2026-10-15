const mockExtractRequestAuditMeta = jest.fn();
const mockWriteAdminAuditEvent = jest.fn();
const mockCreateApprovalObservation = jest.fn();

jest.mock('../../utils/prismaClient', () => ({ __esModule: true, default: {} }));
jest.mock('../adminAudit.service', () => ({
  extractRequestAuditMeta: (...args: unknown[]) => mockExtractRequestAuditMeta(...args),
  writeAdminAuditEvent: (...args: unknown[]) => mockWriteAdminAuditEvent(...args)
}));
jest.mock('../approvalPolicy.service', () => ({
  createApprovalObservation: (...args: unknown[]) => mockCreateApprovalObservation(...args)
}));

import { recordGovernedAdminAction } from '../enterpriseGovernance.service';

describe('enterprise governance transaction scoping', () => {
  const transaction = { name: 'transaction-client' } as any;
  const request = { headers: {}, user: { id: 'user-1', role: 'ADMIN' } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractRequestAuditMeta.mockResolvedValue({
      actorUserId: 'user-1',
      actorStaffId: 'staff-1',
      actorRole: 'ADMIN',
      ipAddress: null,
      userAgent: null
    });
    mockWriteAdminAuditEvent.mockResolvedValue({ id: 'audit-1' });
    mockCreateApprovalObservation.mockResolvedValue({ id: 'approval-1' });
  });

  it('passes transaction-scoped audit writes and metadata resolution options', async () => {
    await recordGovernedAdminAction(request, {
      moduleKey: 'cms',
      actionKey: 'content.update',
      entityType: 'app_setting'
    }, transaction, { resolveStaffProfile: false });

    expect(mockExtractRequestAuditMeta).toHaveBeenCalledWith(request, { resolveStaffProfile: false });
    expect(mockWriteAdminAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actionKey: 'content.update' }), transaction);
    expect(mockCreateApprovalObservation).not.toHaveBeenCalled();
  });

  it('uses the same transaction client for approval observations', async () => {
    await recordGovernedAdminAction(request, {
      moduleKey: 'cms',
      actionKey: 'content.update',
      entityType: 'app_setting',
      approvalActionKey: 'content.update.review',
      approvalTitle: 'Review content update'
    }, transaction, { resolveStaffProfile: false });

    expect(mockCreateApprovalObservation).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: 'content.update.review',
      metadata: expect.objectContaining({ auditEventId: 'audit-1' })
    }), transaction);
  });
});
