import assert from 'node:assert/strict';
import test from 'node:test';
import { requireLoopbackTestUrl } from './certificationTarget.mjs';

test('accepts explicitly configured loopback origins', () => {
  assert.equal(requireLoopbackTestUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(requireLoopbackTestUrl('http://127.0.0.1:5173/app/'), 'http://127.0.0.1:5173/app/');
  assert.equal(requireLoopbackTestUrl('http://[::1]:5173'), 'http://[::1]:5173/');
});

test('rejects absent, malformed, and non-loopback targets without echoing input', () => {
  for (const target of [
    undefined,
    '',
    'not-a-url',
    'https://scrolith.com',
    'https://api.scrolith.com',
    'http://localhost.example.invalid',
    'file:///tmp/app',
    'http://user:password@localhost:5173',
    'http://localhost:5173/?token=synthetic',
    'http://localhost:5173/#fragment'
  ]) {
    assert.throws(() => requireLoopbackTestUrl(target), (error) => {
      assert.equal(error.message.includes('synthetic'), false);
      assert.equal(error.message.includes('password'), false);
      return true;
    });
  }
});

test('uses the requested variable name in safe configuration errors', () => {
  assert.throws(
    () => requireLoopbackTestUrl(undefined, 'CERT_API_BASE'),
    /CERT_API_BASE must be explicitly set/
  );
});
