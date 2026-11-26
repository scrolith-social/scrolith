export type ScrolithApiEnvironment = 'development' | 'staging' | 'production' | 'ci' | 'invalid';

const PRODUCTION_API_HOST = 'api.scrolith.com';
// Restrict staging to the reviewed Scrolith staging Container Apps app and
// environment. The shared Azure suffix alone is not an environment boundary.
const STAGING_API_HOST = /^ca-scrolith-staging-api---[a-z0-9-]+\.yellowmushroom-b8714740\.southeastasia\.azurecontainerapps\.io$/;
// PR #179's isolated private KYC candidate is a separate Container Apps
// environment. Keep its staging exception pinned to the exact app hostname.
const PRIVATE_KYC_CANDIDATE_API_HOST = 'ca-kyc-pr179-api-cand.greenstone-a48e47cf.southeastasia.azurecontainerapps.io';

const isLoopback = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '10.0.2.2';
};

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
};

const hasApiPath = (pathname: string) => pathname.replace(/\/+$/, '').endsWith('/api');

/**
 * Resolve a browser API URL without crossing deployment environments.
 * Invalid or absent configuration returns null; callers must fail closed.
 */
export const resolveApiBaseForEnvironment = (
  configuredBase: string | undefined,
  environment: ScrolithApiEnvironment,
  isNative = false
): string | null => {
  const raw = String(configuredBase || '').trim();
  if (!raw) return environment === 'development' && !isNative ? '/api' : null;

  if (raw.startsWith('/')) {
    return environment === 'development' && !isNative && /^\/api\/?$/.test(raw) ? '/api' : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.port && parsed.port !== '443' && parsed.protocol === 'https:'
  ) return null;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const path = parsed.pathname.replace(/\/+$/, '') || '';
  if (path && path !== '/api') return null;

  switch (environment) {
    case 'development': {
      if (host === PRODUCTION_API_HOST) return null;
      if (parsed.protocol === 'http:' && !(isLoopback(host) || isPrivateIpv4(host))) return null;
      break;
    }
    case 'staging':
      if (
        parsed.protocol !== 'https:' ||
        !(STAGING_API_HOST.test(host) || host === PRIVATE_KYC_CANDIDATE_API_HOST)
      ) return null;
      break;
    case 'production':
      if (parsed.protocol !== 'https:' || host !== PRODUCTION_API_HOST) return null;
      break;
    case 'ci':
      if (host !== 'backend.invalid' && !host.endsWith('.invalid') && !(parsed.protocol === 'http:' && isLoopback(host))) {
        return null;
      }
      break;
    case 'invalid':
      return null;
    default:
      return null;
  }

  const normalizedPath = hasApiPath(path) ? path : `${path}/api`;
  return `${parsed.origin}${normalizedPath}`;
};

/** Native HTTP bridges require an absolute base; relative paths are not safe there. */
export const resolveNativeApiBase = (
  configuredBase: string | undefined,
  environment: ScrolithApiEnvironment
): string | null => {
  const base = resolveApiBaseForEnvironment(configuredBase, environment, true);
  return base && /^https?:\/\//i.test(base) ? base : null;
};
