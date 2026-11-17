import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const parseLoopbackHttpUrl = (value) => {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('invalid_url');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(hostname) || url.username || url.password) {
    throw new Error('non_loopback_url');
  }
  return url;
};

export const readStorageStateToken = (storageState, expectedOrigin) => {
  if (!storageState || !Array.isArray(storageState.origins)) throw new Error('invalid_storage_state');
  const origin = storageState.origins.find((entry) => entry?.origin === expectedOrigin);
  if (!origin || !Array.isArray(origin.localStorage)) throw new Error('storage_origin_missing');
  const tokenEntry = origin.localStorage.find((entry) => ['token', 'accessToken'].includes(entry?.name));
  const token = typeof tokenEntry?.value === 'string' ? tokenEntry.value.trim() : '';
  if (!token) throw new Error('storage_token_missing');
  return token;
};

export const countFeedItems = (body) => {
  const items = Array.isArray(body?.data?.items) ? body.data.items : body?.items;
  return Array.isArray(items) ? items.length : null;
};

const requireEnv = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
};

export async function verifyCertificationFeed({
  baseUrl,
  apiBase,
  storageStatePath,
  readStorageState = (path) => JSON.parse(readFileSync(path, 'utf8')),
  fetchImpl = fetch
}) {
  const appUrl = parseLoopbackHttpUrl(baseUrl);
  const apiUrl = parseLoopbackHttpUrl(apiBase);
  if (appUrl.search || appUrl.hash || apiUrl.search || apiUrl.hash || !apiUrl.pathname.replace(/\/$/, '').endsWith('/api')) {
    throw new Error('unexpected_url_path');
  }

  let storageState;
  try {
    storageState = readStorageState(storageStatePath);
  } catch {
    throw new Error('storage_state_unreadable');
  }
  const token = readStorageStateToken(storageState, appUrl.origin);
  const endpoint = apiUrl.toString().replace(/\/+$/, '');
  const requestOptions = {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000)
  };

  let authResponse;
  try {
    authResponse = await fetchImpl(`${endpoint}/auth/me`, requestOptions);
  } catch {
    throw new Error('auth_request_failed');
  }
  if (authResponse.status !== 200) throw new Error(`auth_status_${authResponse.status}`);

  let feedResponse;
  try {
    feedResponse = await fetchImpl(
      `${endpoint}/discovery/v2/member-feed?surface=member_home&mode=for_you&limit=12`,
      requestOptions
    );
  } catch {
    throw new Error('feed_request_failed');
  }
  if (feedResponse.status !== 200) throw new Error(`feed_status_${feedResponse.status}`);

  let body;
  try {
    body = await feedResponse.json();
  } catch {
    throw new Error('feed_invalid_json');
  }
  const itemCount = countFeedItems(body);
  if (itemCount === null) throw new Error('feed_items_missing');
  if (itemCount < 1) throw new Error('feed_fixture_missing');

  return { authStatus: authResponse.status, feedStatus: feedResponse.status, itemCount };
}

async function main() {
  const result = await verifyCertificationFeed({
    baseUrl: requireEnv('CERT_BASE_URL'),
    apiBase: requireEnv('CERT_API_BASE'),
    storageStatePath: resolve(requireEnv('CERT_STORAGE_STATE'))
  });
  // Deliberately emit only status/count metadata; never print the token, user,
  // response body, credentials, or complete URLs.
  console.log(`Certification feed preflight passed: auth=${result.authStatus}, feed=${result.feedStatus}, items=${result.itemCount}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    const code = String(error?.message || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
    console.error(`Certification feed preflight failed: ${code}`);
    process.exitCode = 1;
  });
}
