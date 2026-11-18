import { createRecordWithAzureUploadCleanup } from '../azureUploadPersistence';

describe('Azure upload persistence cleanup', () => {
  it('deletes each uploaded object once when the database record write fails', async () => {
    const deleteBlob = jest.fn().mockResolvedValue(undefined);
    const createRecord = jest.fn().mockRejectedValue(new Error('synthetic database write failure'));
    await expect(createRecordWithAzureUploadCleanup({
      createRecord,
      uploadedBlobNames: ['media/a', 'thumbnails/a', 'media/a'],
      deleteBlob
    })).rejects.toThrow('synthetic database write failure');
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(deleteBlob.mock.calls.map(([name]) => name)).toEqual(['media/a', 'thumbnails/a']);
  });

  it('preserves the database error when best-effort blob cleanup also fails', async () => {
    const onCleanupError = jest.fn();
    const createRecord = jest.fn().mockRejectedValue(new Error('synthetic database failure'));
    const deleteBlob = jest.fn().mockRejectedValue(new Error('synthetic cleanup failure'));
    await expect(createRecordWithAzureUploadCleanup({
      createRecord,
      uploadedBlobNames: ['media/a'],
      deleteBlob,
      onCleanupError
    })).rejects.toThrow('synthetic database failure');
    expect(onCleanupError).toHaveBeenCalledTimes(1);
  });
});
