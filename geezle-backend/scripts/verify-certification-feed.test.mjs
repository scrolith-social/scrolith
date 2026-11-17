import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countFeedItems,
  parseLoopbackHttpUrl,
  readStorageStateToken,
  verifyCertificationFeed
} from './verify-certification-feed.mjs';

test('certification preflight accepts only loopback HTTP targets', () => {
  assert.equal(parseLoopbackHttpUrl('http://localhost:5173').hostname, 'localhost');
  assert.equal(parseLoopbackHttpUrl('http://127.0.0.1:5000/api').hostname, '127.0.0.1');
  assert.equal(parseLoopbackHttpUrl('http://[::1]:5000/api').hostname, '[::1]');
  assert.throws(() => parseLoopbackHttpUrl('https://localhost'), /non_loopback_url/);
  assert.throws(() => parseLoopbackHttpUrl('http://example.invalid'), /non_loopback_url/);
  assert.throws(() => parseLoopbackHttpUrl('http://user:pass@127.0.0.1'), /non_loopback_url/);
});

test('storage-state token lookup requires the exact browser origin and never uses another origin', () => {
  const state = {
    origins: [
      { origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'token', value: 'synthetic-token' }] }
    ]
  };
  assert.equal(readStorageStateToken(state, 'http://127.0.0.1:5173'), 'synthetic-token');
  assert.throws(() => readStorageStateToken(state, 'http://localhost:5173'), /storage_origin_missing/);
  assert.throws(() => readStorageStateToken({ origins: [] }, 'http://127.0.0.1:5173'), /storage_origin_missing/);
});

test('feed item counter accepts the documented nested and direct response shapes', () => {
  assert.equal(countFeedItems({ data: { items: [{ type: 'post' }, { type: 'post' }] } }), 2);
  assert.equal(countFeedItems({ items: [{ type: 'post' }] }), 1);
  assert.equal(countFeedItems({ data: { results: [] } }), null);
});

test('preflight checks auth and seeded feed without logging or returning credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url).pathname, authorization: options.headers.Authorization });
    if (url.endsWith('/auth/me')) return { status: 200 };
    return { status: 200, json: async () => ({ success: true, data: { items: [{ type: 'post' }] } }) };
  };
  const result = await verifyCertificationFeed({
    baseUrl: 'http://127.0.0.1:5173',
    apiBase: 'http://127.0.0.1:5000/api',
    storageStatePath: 'unused-by-test',
    readStorageState: () => ({
      origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'token', value: 'synthetic-token' }] }]
    }),
    fetchImpl
  });
  assert.deepEqual(result, { authStatus: 200, feedStatus: 200, itemCount: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.authorization === 'Bearer synthetic-token'));
});

test('preflight fails closed when authentication, feed status, or seeded items are missing', async () => {
  const statePath = 'unused-by-test';
  const storage = {
    origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'token', value: 'synthetic-token' }] }]
  };
  const resultFor = (statuses, body) => verifyCertificationFeed({
    baseUrl: 'http://127.0.0.1:5173',
    apiBase: 'http://127.0.0.1:5000/api',
    storageStatePath: statePath,
    readStorageState: () => storage,
    fetchImpl: async (url) => {
      const status = url.endsWith('/auth/me') ? statuses[0] : statuses[1];
      return { status, json: async () => body };
    },
  });
  await assert.rejects(resultFor([401, 200], {}), /auth_status_401/);
  await assert.rejects(resultFor([200, 503], {}), /feed_status_503/);
  await assert.rejects(resultFor([200, 200], { success: true, data: { items: [] } }), /feed_fixture_missing/);
});
