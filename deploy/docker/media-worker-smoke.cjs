const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { accessSync, constants, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const sharp = require('sharp');
const { probeVideoFile } = require('./dist/services/media/mediaVideoProbe.service');
const { generateVideoPosterAndThumb, cleanupVideoPosterTemps } = require('./dist/services/media/mediaVideoPoster.service');
const { generateImageVariants } = require('./dist/services/media/mediaImageProcessor.service');

async function main() {
  assert.notEqual(process.getuid(), 0);
  assert.throws(() => accessSync(process.cwd(), constants.W_OK));
  accessSync('uploads', constants.W_OK);
  for (const tool of ['/sbin/apk', '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/yarn', '/usr/bin/gcc']) {
    assert.throws(() => accessSync(tool, constants.X_OK));
  }

  const dir = mkdtempSync(join(tmpdir(), 'scrolith-synthetic-media-'));
  let outputs;
  try {
    const video = join(dir, 'sample.mp4');
    execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ], { timeout: 20_000 });
    const probe = await probeVideoFile(video);
    assert.equal(probe.ok, true);
    assert.equal(probe.metadata.width, 640);
    assert.equal(probe.metadata.height, 360);
    const poster = await generateVideoPosterAndThumb({ inputPath: video, metadata: probe.metadata });
    assert.equal(poster.ok, true);
    outputs = poster.outputs;
    assert.equal(outputs.poster.mimeType, 'image/webp');
    assert.equal(outputs.thumbnail.mimeType, 'image/webp');
    assert.equal((await sharp(outputs.thumbnail.buffer).metadata()).width, 320);

    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#128063' }
    }).png().toBuffer();
    const image = await generateImageVariants({ buffer: png });
    assert.equal(image.inspect.width, 640);
    assert(image.variants.some((variant) => variant.mimeType === 'image/webp'));
    console.log('Non-root, runtime permissions, H.264 metadata, WebP poster/thumbnail, and Sharp image variants passed.');
  } finally {
    cleanupVideoPosterTemps(outputs);
    rmSync(dir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
