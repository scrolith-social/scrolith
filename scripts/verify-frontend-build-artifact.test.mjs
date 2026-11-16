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
});
