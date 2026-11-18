import { MAX_CONCURRENT_AZURE_UPLOADS, MAX_UPLOAD_BYTES } from '../uploadLimits';

describe('upload resource bounds', () => {
  it('retains the 500 MiB compatibility limit while bounding Azure upload concurrency', () => {
    expect(MAX_UPLOAD_BYTES).toBe(500 * 1024 * 1024);
    expect(MAX_CONCURRENT_AZURE_UPLOADS).toBe(2);
  });
});
