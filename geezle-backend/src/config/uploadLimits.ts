/** Per-request cap retained from the existing upload contract; Azure writes are disk-streamed. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
/** Azure upload routes reject above this per-process concurrency to bound disk and SDK buffers. */
export const MAX_CONCURRENT_AZURE_UPLOADS = 2;
