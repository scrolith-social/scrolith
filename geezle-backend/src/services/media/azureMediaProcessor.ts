import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadBlobByName, uploadBufferToBlob, deleteBlobByName } from '../storage/blobStorage';
import { scanBufferWithClamAv } from '../kyc/kyc.clamav.service';
import { generateImageVariants, type GeneratedVariant } from './mediaImageProcessor.service';
import { defaultFfprobeRunner, probeVideoFile } from './mediaVideoProbe.service';
import { defaultFfmpegRunner, generateVideoPosterAndThumb, cleanupVideoPosterTemps } from './mediaVideoPoster.service';
import type { ClaimedJob } from './azureMediaOutbox';

export class MediaScanRejected extends Error {}
export type GeneratedMedia = { variants: GeneratedVariant[]; width: number; height: number; duration?: number; digest: string };
export interface MediaProcessor {
  generate(claim: ClaimedJob): Promise<GeneratedMedia>;
  upload(key: string, variant: GeneratedVariant): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createAzureMediaProcessor(overrides: Partial<{
  download: typeof downloadBlobByName; upload: typeof uploadBufferToBlob;
  remove: typeof deleteBlobByName; scan: typeof scanBufferWithClamAv;
}> = {}): MediaProcessor {
  const io = { download: downloadBlobByName, upload: uploadBufferToBlob,
    remove: deleteBlobByName, scan: scanBufferWithClamAv, ...overrides };
  return {
  async generate({ file, job }) {
    const limit = job.kind === 'image_variants' ? 80 * 1024 * 1024 : 250 * 1024 * 1024;
    if (Number(file.size) <= 0 || Number(file.size) > limit) throw new MediaScanRejected('MEDIA_SIZE_REJECTED');
    const response = await io.download(file.storage_key);
    if (!response.readableStreamBody) throw new Error('SOURCE_UNAVAILABLE');
    const parts: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const part of response.readableStreamBody) {
        const data = Buffer.isBuffer(part) ? part : Buffer.from(part);
        bytes += data.length;
        if (bytes > limit) throw new MediaScanRejected('MEDIA_SIZE_REJECTED');
        parts.push(data);
      }
    } finally { response.readableStreamBody.destroy(); }
    if (bytes !== Number(file.size)) throw new Error('SOURCE_SIZE_CHANGED');
    const buffer = Buffer.concat(parts);
    const digest = createHash('sha256').update(buffer).digest('hex');
    const scan = await io.scan(buffer);
    if (scan.infected) throw new MediaScanRejected('SCAN_REJECTED');
    // Reuse the scanner implementation but refuse its mock/deferred/fail-open modes.
    if (!scan.clean || scan.unavailable || scan.rawStatus !== 'CLEAN' || scan.engine !== 'clamav') {
      throw new Error('SCANNER_UNAVAILABLE');
    }
    if (job.kind === 'image_variants') {
      const image = await generateImageVariants({ buffer });
      return { variants: image.variants, width: image.inspect.width, height: image.inspect.height, digest };
    }
    const dir = await mkdtemp(join(tmpdir(), 'scrolith-azure-media-'));
    let outputs: Awaited<ReturnType<typeof generateVideoPosterAndThumb>>;
    try {
      const path = join(dir, 'source.bin');
      await writeFile(path, buffer, { mode: 0o600 });
      const probe = await probeVideoFile(path, { runner: (args, options) =>
        defaultFfprobeRunner(['-protocol_whitelist', 'file,pipe', ...args], options) });
      if (!probe.ok) throw new Error('VIDEO_PROBE_FAILED');
      outputs = await generateVideoPosterAndThumb({ inputPath: path, metadata: probe.metadata,
        runner: (args, options) => defaultFfmpegRunner(['-protocol_whitelist', 'file,pipe', ...args], options) });
      if (!outputs.ok) throw new Error('VIDEO_POSTER_FAILED');
      return {
        variants: [outputs.outputs.poster, outputs.outputs.thumbnail],
        width: probe.metadata.width, height: probe.metadata.height,
        duration: probe.metadata.durationSeconds, digest
      };
    } finally {
      if (outputs?.ok) cleanupVideoPosterTemps(outputs.outputs);
      await rm(dir, { recursive: true, force: true });
    }
  },
  async upload(key, variant) {
    await io.upload({ buffer: variant.buffer, contentType: variant.mimeType, fileName: key });
  },
  remove: io.remove
  };
}

export const azureMediaProcessor = createAzureMediaProcessor();
