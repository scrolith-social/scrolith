const mockBlobRead = jest.fn();
const mockBlobProperties = jest.fn();

jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    file: { findUnique: jest.fn(), findFirst: jest.fn() },
    azureMediaJob: { findFirst: jest.fn() },
    fileUsage: { count: jest.fn(), findMany: jest.fn() },
    marketplaceListingMedia: { count: jest.fn() },
    communityBusinessPage: { count: jest.fn() },
    user: { count: jest.fn(), findFirst: jest.fn() },
    profile: { count: jest.fn() },
    directMessage: { findFirst: jest.fn() }
  }
}));

jest.mock('../../services/storage/blobStorage', () => ({
  createBlobReadStreamByRange: mockBlobRead,
  createBlobReference: jest.fn(),
  downloadBlobByName: jest.fn(),
  deleteBlobByName: jest.fn(),
  extractBlobNameFromUrl: jest.fn(),
  getBlobPropertiesByName: mockBlobProperties,
  isAzureBlobConfigured: jest.fn(() => true),
  uploadBufferToBlob: jest.fn()
}));

import prisma from '../../utils/prismaClient';
import { serveFileContent } from '../filesController';

describe('Azure private Blob file authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: 'private-file-test-id',
      ownerId: 'owner-test-id',
      filename: 'private-document.pdf',
      originalName: 'private-document.pdf',
      mimeType: 'application/pdf',
      visibility: 'PRIVATE',
      storageKey: 'private/private-document.pdf',
      storageProvider: 'azure_blob',
      thumbnailUrl: null,
      size: 12,
      url: '/api/files/content/private-file-test-id'
    });
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.profile.count as jest.Mock).mockResolvedValue(0);
    (prisma.communityBusinessPage.count as jest.Mock).mockResolvedValue(0);
    (prisma.fileUsage.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.fileUsage.count as jest.Mock).mockResolvedValue(0);
    (prisma.marketplaceListingMedia.count as jest.Mock).mockResolvedValue(0);
  });

  it('denies an unauthenticated request before reading the private Blob', async () => {
    const req = {
      params: { id: 'private-file-test-id' },
      query: {},
      headers: {},
      method: 'GET'
    } as any;
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      end: jest.fn()
    } as any;

    await serveFileContent(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'You do not have access to this file'
    });
    expect(mockBlobProperties).not.toHaveBeenCalled();
    expect(mockBlobRead).not.toHaveBeenCalled();
  });
  it('blocks an authorized owner from reading an unscanned Azure upload', async () => {
    (prisma.file.findUnique as jest.Mock).mockResolvedValue({
      id:'quarantined-file',ownerId:'owner-test-id',filename:'synthetic.png',originalName:'synthetic.png',
      mimeType:'image/png',visibility:'PRIVATE',storageProvider:'azure_blob',storageKey:'private/synthetic.png',
      size:12,url:'/api/files/content/quarantined-file',mediaScanRequired:true,processingVersion:0
    });
    (prisma.azureMediaJob.findFirst as jest.Mock).mockResolvedValue(null);
    const req={ params:{id:'quarantined-file'},query:{},headers:{},method:'GET',user:{id:'owner-test-id',role:'user'} } as any;
    const res={headersSent:false,status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis(),setHeader:jest.fn(),end:jest.fn()} as any;
    await serveFileContent(req,res);
    expect(prisma.file.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ mediaScanRequired: true, processingVersion: true }) }));
    expect(res.status).toHaveBeenCalledWith(423);
    expect(mockBlobRead).not.toHaveBeenCalled(); expect(mockBlobProperties).not.toHaveBeenCalled();
  });

});
