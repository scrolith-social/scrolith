#!/usr/bin/env node
/**
 * Generate Playwright storage state for Phase 21.1.6 certification.
 *
 * Prefers API login (no browser CORS), then injects token into the CERT_BASE_URL origin.
 *
 * Usage:
 *   set CERT_EMAIL=...
 *   set CERT_PASSWORD=...
 *   set CERT_BASE_URL=http://127.0.0.1:5173
 *   set CERT_API_BASE=http://127.0.0.1:5000/api
 *   node scripts/phase2116-generate-storage-state.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireLoopbackTestUrl } from './certificationTarget.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const baseURL = requireLoopbackTestUrl(process.env.CERT_BASE_URL, 'CERT_BASE_URL').replace(/\/$/, '');
const apiBase = requireLoopbackTestUrl(process.env.CERT_API_BASE, 'CERT_API_BASE').replace(/\/$/, '');
const email = process.env.CERT_EMAIL || process.env.SCROLITH_CERT_EMAIL || '';
const password = process.env.CERT_PASSWORD || process.env.SCROLITH_CERT_PASSWORD || '';
const out = resolve(
  process.env.CERT_STORAGE_STATE || join(tmpdir(), 'scrolith-certification', 'storage-state.json')
);
const relativeOutput = relative(root, out);
if (relativeOutput === '' || (!isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))) {
  throw new Error('CERT_STORAGE_STATE must resolve outside the source repository.');
}

if (!email || !password) {
  console.error('CERT_EMAIL and CERT_PASSWORD are required');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });

const loginViaApi = async () => {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`API login failed with HTTP status ${res.status}.`);
  }
  const token = body.token || body.accessToken || body?.data?.token || body?.data?.accessToken;
  if (!token) throw new Error('API login succeeded without returning an access token.');
  return { token, user: body.user || body.data?.user || { email }, forcePasswordReset: body.forcePasswordReset };
};

const { token, user } = await loginViaApi();
console.log('Synthetic local API login succeeded.');

const browser = await chromium.launch({ headless: process.env.CERT_HEADED === '1' ? false : true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  // Seed token before any app script runs
  await context.addInitScript(
    ({ token: t, user: u }) => {
      try {
        localStorage.setItem('token', t);
        localStorage.setItem('accessToken', t);
        localStorage.setItem('user', JSON.stringify(u || {}));
      } catch {
        /* ignore */
      }
    },
    { token, user }
  );

  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2500);

  // Re-assert storage after navigation
  await page.evaluate(
    ({ token: t, user: u }) => {
      localStorage.setItem('token', t);
      localStorage.setItem('accessToken', t);
      localStorage.setItem('user', JSON.stringify(u || {}));
    },
    { token, user }
  );

  // Probe authenticated API call via page (subject to CORS)
  const probe = await page.evaluate(async (api) => {
    try {
      const t = localStorage.getItem('token');
      const res = await fetch(`${api}/auth/me`, {
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }
      });
      return { status: res.status, ok: res.ok, corsOk: true };
    } catch (e) {
      return { status: 0, ok: false, corsOk: false, error: String(e?.message || e) };
    }
  }, apiBase);

  console.log('Browser API probe /auth/me:', JSON.stringify(probe));

  if (!probe.corsOk || !probe.ok) {
    throw new Error(`Local authenticated API probe failed with status ${probe.status}; storage state was not written.`);
  }
  await context.storageState({ path: out });
  console.log('Verified local authentication state saved outside the source repository.');
} catch (error) {
  console.error('Failed to generate storage state:', error?.message || error);
  process.exit(1);
} finally {
  await browser.close();
}
