import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { inspectFrontendArtifact } from './verify-frontend-build-artifact.mjs';

const roots = [];
async function createFixture(contents) {
  const root = await mkdtemp(join(tmpdir(), 'scrolith-dist-check-'));
  roots.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(root, 'assets', 'app.js'), contents);
  return root;
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test('accepts a bundle with the expected inert API host and no known secret markers', async () => {
  const root = await createFixture('const api = "https://backend.invalid/api";');
  const result = await inspectFrontendArtifact(root, 'backend.invalid');
  assert.equal(result.expectedApiHostFound, true);
  assert.deepEqual(result.findings, []);
  assert.ok(result.hosts.includes('backend.invalid'));
});

test('reports secret marker categories without returning matching values', async () => {
  const syntheticMarker = 'sk_test_' + 'A'.repeat(24);
  const root = await createFixture(`const accidental = "${syntheticMarker}";`);
  const result = await inspectFrontendArtifact(root, 'backend.invalid');
  assert.equal(result.findings[0]?.category, 'stripe-secret');
  assert.equal(JSON.stringify(result).includes(syntheticMarker), false);
});

test('rejects an artifact that does not contain the configured API host', async () => {
  const root = await createFixture('const api = "/api";');
  const result = await inspectFrontendArtifact(root, 'backend.invalid');
  assert.equal(result.expectedApiHostFound, false);
});

test('detects a forbidden production API host in an inert CI bundle', async () => {
  const root = await createFixture('const api = "https://api.scrolith.com/api";');
  const result = await inspectFrontendArtifact(root, 'backend.invalid', ['api.scrolith.com']);
  assert.deepEqual(result.forbiddenApiHostsFound, ['api.scrolith.com']);
  assert.deepEqual(result.forbiddenApiHostFiles['api.scrolith.com'], ['assets/app.js']);
});

test('detects a forbidden production API preconnect in the generated HTML shell', async () => {
  const root = await createFixture('const api = "https://backend.invalid/api";');
  await writeFile(join(root, 'index.html'), '<link rel="preconnect" href="https://api.scrolith.com">');
  const result = await inspectFrontendArtifact(root, 'backend.invalid', ['api.scrolith.com']);
  assert.deepEqual(result.forbiddenApiHostsFound, ['api.scrolith.com']);
  assert.deepEqual(result.forbiddenApiHostFiles['api.scrolith.com'], ['index.html']);
});

test('allows only the exact inert localhost fallback in router and vendor chunks', async () => {
  const root = await createFixture('const api = "https://backend.invalid/api";');
  await writeFile(join(root, 'assets', 'router-a1.js'), 'const base = new URL("http://localhost");');
  await writeFile(join(root, 'assets', 'vendor-b2.js'), 'const origin = "http://localhost";');
  const result = await inspectFrontendArtifact(root, 'backend.invalid', ['localhost', '127.0.0.1', '::1']);

  assert.equal(result.forbiddenApiHostsFound.includes('localhost'), false);
  assert.deepEqual(result.inertLoopbackFallbacks, [
    { host: 'localhost', file: 'assets/router-a1.js' },
    { host: 'localhost', file: 'assets/vendor-b2.js' }
  ]);
});

test('does not allow loopback endpoints in app chunks or broaden the inert fallback exception', async () => {
  const root = await createFixture('const api = "http://localhost/api";');
  await writeFile(join(root, 'assets', 'router-a1.js'), 'const endpoint = "http://localhost:3000/api";');
  const result = await inspectFrontendArtifact(root, 'backend.invalid', ['localhost', '127.0.0.1', '::1']);

  assert.deepEqual(result.forbiddenApiHostsFound, ['localhost']);
  assert.deepEqual(result.forbiddenApiHostFiles.localhost, ['assets/app.js', 'assets/router-a1.js']);
  assert.deepEqual(result.inertLoopbackFallbacks, []);
});
