const mockFind = jest.fn();
jest.mock('../../../utils/prismaClient', () => ({ __esModule: true, default: { azureMediaJob: { findFirst: mockFind } } }));
import { azureMediaPublicationAllowed } from '../azureMediaPublication';
describe('persistent Azure scan/publication gate', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it('preserves legacy files without an Azure scan requirement', async () => {
    expect(await azureMediaPublicationAllowed({ id: 'legacy' })).toBe(true);
    expect(mockFind).not.toHaveBeenCalled();
  });
  it('requires a committed scanned job of the exact generation even when transport is disabled', async () => {
    const previous = process.env.MEDIA_PROCESSING_MODE; process.env.MEDIA_PROCESSING_MODE = 'disabled';
    try {
      mockFind.mockResolvedValue(null);
      expect(await azureMediaPublicationAllowed({ id: 'quarantined', mediaScanRequired: true, processingVersion: 2 })).toBe(false);
      expect(mockFind).toHaveBeenCalledWith({ where: { fileId: 'quarantined', generation: 2, status: 'DONE', sourceSha256: { not: null } }, select: { id: true } });
      mockFind.mockResolvedValue({ id: 'scanned' });
      expect(await azureMediaPublicationAllowed({ id: 'quarantined', mediaScanRequired: true, processingVersion: 2 })).toBe(true);
    } finally { if(previous===undefined) delete process.env.MEDIA_PROCESSING_MODE; else process.env.MEDIA_PROCESSING_MODE=previous; }
  });
  it('fails closed on a database read failure', async () => {
    mockFind.mockRejectedValue(new Error('synthetic unavailable'));
    await expect(azureMediaPublicationAllowed({ id:'quarantined',mediaScanRequired:true })).rejects.toThrow('synthetic unavailable');
  });
});
