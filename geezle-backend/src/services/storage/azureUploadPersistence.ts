export async function createRecordWithAzureUploadCleanup<T>(params: {
  createRecord: () => Promise<T>;
  uploadedBlobNames: string[];
  deleteBlob: (blobName: string) => Promise<void>;
  onCleanupError?: (error: unknown) => void;
}): Promise<T> {
  try {
    return await params.createRecord();
  } catch (writeError) {
    for (const blobName of new Set(params.uploadedBlobNames.filter(Boolean))) {
      try {
        await params.deleteBlob(blobName);
      } catch (cleanupError) {
        params.onCleanupError?.(cleanupError);
      }
    }
    throw writeError;
  }
}
