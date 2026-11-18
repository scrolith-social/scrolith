import { resolveApiBaseForEnvironment, type ScrolithApiEnvironment } from './apiBasePolicy';

const normalizeBase = (value: string) => value.replace(/\/+$/, '');
const ensureApiSuffix = (value: string) => value.endsWith('/api') ? value : `${value}/api`;

export type ApiBaseEnvironment = {
  VITE_API_URL?: string;
  VITE_API_BASE_URL?: string;
  VITE_BACKEND_URL?: string;
};

export const resolveConfiguredApiBase = ({
  VITE_API_URL,
  VITE_API_BASE_URL,
  VITE_BACKEND_URL
}: ApiBaseEnvironment) => {
  const configuredBase = VITE_API_URL || VITE_API_BASE_URL || VITE_BACKEND_URL || '';
  return configuredBase ? ensureApiSuffix(normalizeBase(String(configuredBase))) : '';
};

const parseBool = (value: unknown, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

/** Static env access is necessary for Vite compile-time replacement. */
export const vite = {
  get PROD() { try { return Boolean(import.meta.env.PROD); } catch { return false; } },
  get DEV() { try { return Boolean(import.meta.env.DEV); } catch { return false; } },
  get VITE_API_URL() { try { return import.meta.env.VITE_API_URL as string | undefined; } catch { return undefined; } },
  get VITE_API_BASE_URL() { try { return import.meta.env.VITE_API_BASE_URL as string | undefined; } catch { return undefined; } },
  get VITE_BACKEND_URL() { try { return import.meta.env.VITE_BACKEND_URL as string | undefined; } catch { return undefined; } },
  get VITE_SCROLITH_ENV() { try { return import.meta.env.VITE_SCROLITH_ENV as string | undefined; } catch { return undefined; } },
  get VITE_MOBILE_API_URL() { try { return import.meta.env.VITE_MOBILE_API_URL as string | undefined; } catch { return undefined; } },
  get VITE_MOBILE_API_BASE_URL() { try { return import.meta.env.VITE_MOBILE_API_BASE_URL as string | undefined; } catch { return undefined; } },
  get VITE_FORCE_MOBILE_API_OVERRIDE() { try { return import.meta.env.VITE_FORCE_MOBILE_API_OVERRIDE as string | undefined; } catch { return undefined; } },
  get VITE_API_TIMEOUT_MS() { try { return import.meta.env.VITE_API_TIMEOUT_MS as string | undefined; } catch { return undefined; } }
};

export const getScrolithApiEnvironment = (): ScrolithApiEnvironment => {
  const configured = String(vite.VITE_SCROLITH_ENV || '').trim().toLowerCase();
  if (configured) {
    if (configured === 'development' || configured === 'staging' || configured === 'production' || configured === 'ci') {
      return configured;
    }
    return 'invalid';
  }
  return vite.DEV ? 'development' : vite.PROD ? 'production' : 'ci';
};

const getConfiguredApiBase = () => resolveConfiguredApiBase({
  VITE_API_URL: vite.VITE_API_URL,
  VITE_API_BASE_URL: vite.VITE_API_BASE_URL,
  VITE_BACKEND_URL: vite.VITE_BACKEND_URL
});

const getMobileApiBase = () => String(vite.VITE_MOBILE_API_URL || vite.VITE_MOBILE_API_BASE_URL || '').trim();

const getCapacitorRuntime = () => {
  if (typeof window === 'undefined') return null;
  try { return (window as any)?.Capacitor || null; } catch { return null; }
};

const isRuntimeNativePlatform = () => {
  const runtime = getCapacitorRuntime();
  try { return Boolean(runtime && typeof runtime.isNativePlatform === 'function' && runtime.isNativePlatform()); }
  catch { return false; }
};

const isCapacitorRuntime = () => {
  if (typeof window === 'undefined') return false;
  try {
    const protocol = String(window.location?.protocol || '').toLowerCase();
    const host = String(window.location?.hostname || '').toLowerCase();
    if (vite.PROD && protocol === 'https:' && host === 'localhost') return true;
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') return true;
  } catch {
    // Do not infer a network target from an unavailable browser runtime.
  }
  return isRuntimeNativePlatform();
};

export const getApiBaseUrl = () => {
  const native = isRuntimeNativePlatform() || isCapacitorRuntime();
  const environment = getScrolithApiEnvironment();
  if (native && (environment !== 'production' || parseBool(vite.VITE_FORCE_MOBILE_API_OVERRIDE, false))) {
    const mobile = getMobileApiBase();
    if (mobile) {
      const resolvedMobile = resolveApiBaseForEnvironment(mobile, environment, true);
      if (resolvedMobile) return resolvedMobile;
    }
  }

  const resolved = resolveApiBaseForEnvironment(getConfiguredApiBase(), environment, native);
  if (resolved) return resolved;

  // Same-origin web fallback stays in the current environment; native remains empty.
  return environment === 'development' && !native ? '/api' : native ? '' : '/api';
};

export const getBackendOrigin = () => {
  const base = getApiBaseUrl();
  if (!base || base.startsWith('/')) return '';
  try { return new URL(base).origin; } catch { return ''; }
};
