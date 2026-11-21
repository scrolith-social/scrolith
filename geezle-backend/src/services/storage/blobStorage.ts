import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { PassThrough, Readable } from 'stream';

const DEFAULT_CONTAINER = 'uploads';
const BLOB_REFERENCE_PREFIX = 'azure-blob://';
const AZURE_UPLOAD_BLOCK_BYTES = 8 * 1024 * 1024;
const AZURE_UPLOAD_MAX_CONCURRENCY = 2;

let cachedContainerClient: ContainerClient | null = null;
let cachedConfigurationKey = '';

export const __resetAzureBlobCachesForTests = () => {
  cachedContainerClient = null;
  cachedConfigurationKey = '';
};

const normalizeBlobName = (value: string) => value.replace(/^\/+/, '');

const getConfig = () => ({
  connectionString: String(process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim(),
  accountUrl: String(process.env.AZURE_STORAGE_ACCOUNT_URL || '').trim().replace(/\/$/, ''),
  containerName: String(process.env.AZURE_STORAGE_CONTAINER || DEFAULT_CONTAINER).trim(),
  clientId: String(process.env.AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID || '').trim(),
  authMode: String(process.env.AZURE_STORAGE_AUTH_MODE || '').trim().toLowerCase(),
  baseUrl: String(process.env.AZURE_BLOB_BASE_URL || '').trim().replace(/\/$/, '')
});

const isProduction = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

export const isAzureBlobConfigured = () => {
  const config = getConfig();
  if (!config.containerName) return false;
  if (isProduction()) {
    return Boolean(
      config.accountUrl &&
        config.authMode === 'managed_identity' &&
        !config.connectionString &&
        /^https:\/\/[a-z0-9-]+\.blob\.core\.windows\.net$/i.test(config.accountUrl)
    );
  }
  return Boolean(config.connectionString || config.accountUrl);
};

const getContainerClient = () => {
  const config = getConfig();
  const production = isProduction();
  let service: BlobServiceClient;
  let configurationKey: string;

  if (production) {
    if (
      !config.accountUrl ||
      config.authMode !== 'managed_identity' ||
      config.connectionString ||
      !/^https:\/\/[a-z0-9-]+\.blob\.core\.windows\.net$/i.test(config.accountUrl)
    ) {
      throw new Error('Production Azure Blob storage requires an account URL and managed identity authentication');
    }
    configurationKey = `managed:${config.accountUrl}:${config.containerName}:${config.clientId}`;
  } else if (config.connectionString) {
    configurationKey = `local-connection:${config.connectionString}:${config.containerName}`;
  } else if (config.accountUrl) {
    configurationKey = `local-default-credential:${config.accountUrl}:${config.containerName}`;
  } else {
    throw new Error('Azure Blob storage requires AZURE_STORAGE_ACCOUNT_URL');
  }

  if (cachedContainerClient && cachedConfigurationKey === configurationKey) return cachedContainerClient;
  if (production) {
    service = new BlobServiceClient(
      config.accountUrl,
      new ManagedIdentityCredential(config.clientId || undefined)
    );
  } else if (config.connectionString) {
    // Connection strings remain available only for explicitly local/test use.
    service = BlobServiceClient.fromConnectionString(config.connectionString);
  } else {
    // Developer CLI/workstation identity; production always uses ManagedIdentityCredential above.
    service = new BlobServiceClient(config.accountUrl, new DefaultAzureCredential());
  }
  cachedContainerClient = service.getContainerClient(config.containerName);
  cachedConfigurationKey = configurationKey;
  return cachedContainerClient;
};

export const getBlobUrl = (blobName: string) => {
  const config = getConfig();
  const normalized = normalizeBlobName(blobName);
  const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
  if (config.baseUrl) return `${config.baseUrl}/${encodedPath}`;
  return getContainerClient().getBlockBlobClient(normalized).url;
};

/** Internal database-only reference; never expose this URI as a browser URL. */
export const createBlobReference = (blobName: string) =>
  `${BLOB_REFERENCE_PREFIX}${encodeURIComponent(normalizeBlobName(blobName))}`;

export const extractBlobNameFromUrl = (urlValue: string) => {
  const config = getConfig();
  const raw = String(urlValue || '').trim();
  if (!raw) return null;
  if (raw.startsWith(BLOB_REFERENCE_PREFIX)) {
    try {
      return normalizeBlobName(decodeURIComponent(raw.slice(BLOB_REFERENCE_PREFIX.length)));
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/^\/+/, '');
    const prefix = `${config.containerName}/`;
    if (path.startsWith(prefix)) return decodeURIComponent(path.slice(prefix.length));
    return null;
  } catch {
    return null;
  }
};

export async function uploadBufferToBlob(params: {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}) {
  const container = getContainerClient();
  const blobName = normalizeBlobName(params.fileName);
  await container.getBlockBlobClient(blobName).uploadData(params.buffer, {
    blobHTTPHeaders: { blobContentType: params.contentType || 'application/octet-stream' }
  });
  return getBlobUrl(blobName);
}

export async function uploadStreamToBlob(params: {
  stream: NodeJS.ReadableStream;
  contentType: string;
  fileName: string;
}) {
  const container = getContainerClient();
  const blobName = normalizeBlobName(params.fileName);
  const readable = params.stream as Readable;
  if (typeof readable.pipe !== 'function') throw new Error('Azure Blob upload requires a readable stream');
  await container.getBlockBlobClient(blobName).uploadStream(
    readable,
    AZURE_UPLOAD_BLOCK_BYTES,
    AZURE_UPLOAD_MAX_CONCURRENCY,
    { blobHTTPHeaders: { blobContentType: params.contentType || 'application/octet-stream' } }
  );
  return { blobName, url: getBlobUrl(blobName) };
}

export async function deleteBlobByName(blobName?: string | null) {
  if (!blobName) return;
  const container = getContainerClient();
  const normalized = normalizeBlobName(blobName);
  await container.deleteBlob(normalized, { deleteSnapshots: 'include' });
}

export async function blobExistsByName(blobName: string) {
  const container = getContainerClient();
  const normalized = normalizeBlobName(blobName);
  return container.getBlobClient(normalized).exists();
}

export async function getBlobPropertiesByName(blobName: string) {
  const container = getContainerClient();
  const normalized = normalizeBlobName(blobName);
  return container.getBlobClient(normalized).getProperties();
}

export async function downloadBlobByName(blobName: string) {
  const container = getContainerClient();
  const normalized = normalizeBlobName(blobName);
  return container.getBlobClient(normalized).download();
}

/** Create a bounded Azure Blob stream for an inclusive byte range. */
export const createBlobReadStreamByRange = (blobName: string, start: number, end: number) => {
  const output = new PassThrough();
  const normalized = normalizeBlobName(blobName);
  const count = Math.max(0, end - start + 1);

  void getContainerClient()
    .getBlobClient(normalized)
    .download(start, count)
    .then((response) => {
      const stream = response.readableStreamBody;
      if (!stream) {
        output.end();
        return;
      }
      stream.on('error', (error) => output.destroy(error as Error));
      stream.pipe(output);
    })
    .catch((error) => output.destroy(error as Error));

  return output;
};

export async function downloadBlobBufferByName(blobName: string) {
  return getContainerClient().getBlobClient(normalizeBlobName(blobName)).downloadToBuffer();
}

/** List blob names under a prefix (capped). Used for identity-photo recovery. */
export async function listBlobNamesByPrefix(prefix: string, max = 20): Promise<string[]> {
  const out: string[] = [];
  for await (const item of getContainerClient().listBlobsFlat({ prefix: normalizeBlobName(prefix) })) {
    if (!item?.name) continue;
    out.push(item.name);
    if (out.length >= max) break;
  }
  return out;
}
