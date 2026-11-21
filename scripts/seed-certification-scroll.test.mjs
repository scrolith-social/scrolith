import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pickInterestSurveyCandidateIds } from '../src/components/recommendation/ContentInterestSurvey.tsx';
import { pickCertificationInterestSurveyCandidateIds } from './certificationInterestSurvey.mjs';
import { readStorageStateTokenFromFile } from './certificationStorageState.mjs';

test('reads a token only from the requested Playwright origin', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scrolith-cert-state-'));
  const path = join(directory, 'state.json');
  try {
    writeFileSync(path, JSON.stringify({
      origins: [
        { origin: 'http://127.0.0.1:9999', localStorage: [{ name: 'token', value: 'wrong-origin' }] },
        { origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'accessToken', value: 'synthetic-access-token' }] }
      ]
    }));
    assert.equal(readStorageStateTokenFromFile(path, 'http://127.0.0.1:5173'), 'synthetic-access-token');
    assert.throws(() => readStorageStateTokenFromFile(path, 'http://localhost:5173'), {
      message: 'storage_state_missing_origin_token'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unreadable or malformed auth state without echoing file contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'scrolith-cert-state-'));
  const path = join(directory, 'state.json');
  try {
    writeFileSync(path, 'synthetic-secret-looking-token');
    assert.throws(() => readStorageStateTokenFromFile(path, 'http://127.0.0.1:5173'), {
      message: 'storage_state_unreadable'
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selects stable cross-account survey candidates and excludes own and signaled items', () => {
  const items = [
    { id: 'own-scroll', authorId: 'viewer-1' },
    { id: 'already-signaled', authorId: 'owner-1', initialSignal: 'INTERESTED' },
    { id: 'candidate-a', authorId: 'owner-1' },
    { id: 'candidate-b', authorId: 'owner-2', initialSignal: null },
    { id: '', authorId: 'owner-3' }
  ];
  const selected = pickCertificationInterestSurveyCandidateIds(items, 'viewer-1', 'scroll', 4);
  assert.deepEqual(selected, pickCertificationInterestSurveyCandidateIds(items, 'viewer-1', 'scroll', 4));
  assert.equal(selected.length, 2);
  assert.ok(selected.includes('candidate-a'));
  assert.ok(selected.includes('candidate-b'));
  assert.ok(!selected.includes('own-scroll'));
  assert.ok(!selected.includes('already-signaled'));
  assert.deepEqual(
    selected,
    pickInterestSurveyCandidateIds(items, 'viewer-1', 'scroll', 4),
    'fixture eligibility and ordering must match the production Scroll survey policy'
  );
});

test('candidate selection requires a viewer and honors the bounded result count', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `scroll-${index}`, authorId: `author-${index}` }));
  assert.deepEqual(pickCertificationInterestSurveyCandidateIds(items, '', 'scroll', 4), []);
  assert.equal(pickCertificationInterestSurveyCandidateIds(items, 'viewer-1', 'scroll', 99).length, 12);
});
