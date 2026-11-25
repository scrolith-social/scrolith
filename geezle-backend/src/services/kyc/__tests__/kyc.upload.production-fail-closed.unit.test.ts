jest.mock('../../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    kYCDocument: {
      create: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('../kyc.clamav.service', () => ({
  scanBufferWithClamAv: jest.fn()
}));

jest.mock('../kyc.audit.service', () => ({
  createKycCorrelationId: () => 'synthetic-correlation',
  writeKycAuditEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../kyc.storage.service', () => ({
  uploadKycObject: jest.fn().mockResolvedValue({
    objectKey: 'kyc/quarantine/synthetic-object',
    sha256: 'a'.repeat(64)
  }),
  promoteKycObject: jest.fn(),
  moveToRejectedNamespace: jest.fn(),
  sha256Hex: jest.fn().mockReturnValue('b'.repeat(64))
}));

import prisma from '../../../utils/prismaClient';
import { scanBufferWithClamAv } from '../kyc.clamav.service';
import { promoteKycObject } from '../kyc.storage.service';
import { processKycSecureUpload } from '../kyc.upload.service';

describe('production KYC upload scanner outage policy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.CLAMAV_MODE = 'fail_open';
    process.env.KYC_CLAMAV_FAIL_OPEN = 'true';
    (prisma.kYCDocument.create as jest.Mock).mockResolvedValue({
      id: 'synthetic-kyc-document',
      status: 'pending'
    });
    (prisma.kYCDocument.update as jest.Mock).mockResolvedValue({
      id: 'synthetic-kyc-document',
      status: 'pending'
    });
    (scanBufferWithClamAv as jest.Mock).mockResolvedValue({
      clean: false,
      infected: false,
      unavailable: true,
      engine: 'clamav',
      rawStatus: 'UNAVAILABLE'
    });
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  test('does not promote or accept a quarantined file when scanner is unavailable', async () => {
    const harmlessPdfFixture = Buffer.from('%PDF-1.4\nsynthetic test fixture\n%%EOF\n');

    await expect(
      processKycSecureUpload({
        userId: 'synthetic-user',
        documentType: 'identity-document',
        buffer: harmlessPdfFixture,
        claimedMime: 'application/pdf',
        originalName: 'synthetic.pdf'
      })
    ).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE', status: 503 });

    expect(prisma.kYCDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quarantineStatus: 'SCAN_FAILED',
          scanStatus: 'SCAN_FAILED'
        })
      })
    );
    expect(promoteKycObject).not.toHaveBeenCalled();
  });
});
