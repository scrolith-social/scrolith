const mockContainer = { getBlockBlobClient: jest.fn() };
const mockBlockBlob = {
  url: 'https://scrolithtest.blob.core.windows.net/uploads/media/photo.png',
  uploadData: jest.fn().mockResolvedValue(undefined),
  uploadStream: jest.fn().mockResolvedValue(undefined)
};
const mockServiceConstructor = jest.fn();
const mockFromConnectionString = jest.fn();
const mockManagedIdentity = jest.fn((clientId?: string) => ({ kind: 'managed', clientId }));
const mockDefaultCredential = jest.fn(() => ({ kind: 'default' }));

const installAzureMocks = () => {
  jest.doMock('@azure/identity', () => ({
    ManagedIdentityCredential: mockManagedIdentity,
    DefaultAzureCredential: mockDefaultCredential
  }));
  jest.doMock('@azure/storage-blob', () => ({
    BlobServiceClient: class {
      constructor(url: string, credential: unknown) {
        mockServiceConstructor(url, credential);
      }
      static fromConnectionString(connectionString: string) {
        mockFromConnectionString(connectionString);
        return { getContainerClient: () => mockContainer };
      }
      getContainerClient() { return mockContainer; }
    }
  }));
};

describe('Azure Blob authentication and bounded uploads', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockContainer.getBlockBlobClient.mockImplementation((name: string) => ({
      ...mockBlockBlob,
      url: `https://scrolithtest.blob.core.windows.net/uploads/${name.split('/').map(encodeURIComponent).join('/')}`
    }));
    process.env.NODE_ENV = 'production';
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://scrolithtest.blob.core.windows.net';
    process.env.AZURE_STORAGE_CONTAINER = 'uploads';
    process.env.AZURE_STORAGE_AUTH_MODE = 'managed_identity';
    process.env.AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID = 'synthetic-uami-client-id';
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    installAzureMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses a managed identity in production and emits path-encoded storage URLs', () => {
    const storage = require('../blobStorage');
    expect(storage.isAzureBlobConfigured()).toBe(true);
    expect(storage.getBlobUrl('media/a b/image.png')).toBe(
      'https://scrolithtest.blob.core.windows.net/uploads/media/a%20b/image.png'
    );
    expect(mockManagedIdentity).toHaveBeenCalledWith('synthetic-uami-client-id');
    expect(mockDefaultCredential).not.toHaveBeenCalled();
    expect(mockFromConnectionString).not.toHaveBeenCalled();
  });

  it('rejects production connection-string configuration without exposing its value', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    const storage = require('../blobStorage');
    expect(storage.isAzureBlobConfigured()).toBe(false);
    expect(() => storage.getBlobUrl('media/a.png')).toThrow(/managed identity authentication/);
    expect(mockFromConnectionString).not.toHaveBeenCalled();
  });

  it('allows a connection string only in non-production local/test configuration', () => {
    process.env.NODE_ENV = 'test';
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    delete process.env.AZURE_STORAGE_ACCOUNT_URL;
    const storage = require('../blobStorage');
    expect(storage.isAzureBlobConfigured()).toBe(true);
    storage.getBlobUrl('media/local.png');
    expect(mockFromConnectionString).toHaveBeenCalledTimes(1);
    expect(mockManagedIdentity).not.toHaveBeenCalled();
  });

  it('stores internal blob references and streams with bounded block concurrency', async () => {
    const storage = require('../blobStorage');
    const { Readable } = require('stream');
    expect(storage.createBlobReference('thumbnails/video thumb.jpg')).toBe(
      'azure-blob://thumbnails%2Fvideo%20thumb.jpg'
    );
    expect(storage.extractBlobNameFromUrl('azure-blob://thumbnails%2Fvideo%20thumb.jpg')).toBe(
      'thumbnails/video thumb.jpg'
    );
    await storage.uploadStreamToBlob({
      stream: Readable.from(['synthetic']),
      contentType: 'application/octet-stream',
      fileName: 'media/stream.bin'
    });
    expect(mockBlockBlob.uploadStream).toHaveBeenCalledWith(
      expect.anything(),
      8 * 1024 * 1024,
      2,
      { blobHTTPHeaders: { blobContentType: 'application/octet-stream' } }
    );
  });
});
