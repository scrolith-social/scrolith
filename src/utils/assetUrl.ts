import { getBackendOrigin } from './apiBase';

const localAssetHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2']);
const FILE_CONTENT_PATH = '/api/files/content/';

type AssetTransformFit = 'inside' | 'cover' | 'contain';

type AssetTransformOptions = {
  width?: number | null;
  height?: number | null;
  fit?: AssetTransformFit;
  quality?: number | null;
};

const isAssetPath = (value: string) => {
  const v = value.toLowerCase();
  return (
    v.startsWith('/uploads') ||
    v.startsWith('uploads/') ||
    v.includes('/uploads/') ||
    v.startsWith('/api/files/') ||
    v.startsWith('api/files/') ||
    v.includes('/api/files/') ||
    v.startsWith('/files/content/') ||
    v.startsWith('files/content/') ||
    v.includes('/files/content/')
  );
};

const recoverEncodedAbsoluteAssetUrl = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const markers = [
    '/api/files/content/',
    'api/files/content/',
    '/files/content/',
    'files/content/'
  ];

  for (const marker of markers) {
    const markerIndex = lower.indexOf(marker);
    if (markerIndex < 0) continue;
    const encodedStart = markerIndex + marker.length;
    const suffix = trimmed.slice(encodedStart);
    const queryIndex = suffix.search(/[?#]/);
    const encodedValue = (queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix).trim();
    if (!encodedValue) continue;

    try {
      const decoded = decodeURIComponent(encodedValue).trim();
      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const resolveBackendOrigin = () => {
  return String(getBackendOrigin() || '').trim().replace(/\/+$/, '');
};

/**
 * Hosts that return the SPA HTML shell for /api/* or /uploads/* paths.
 * Only these should be rewritten to the API origin.
 * Never treat api.*, cdn.*, media.*, or storage hosts as SPA hosts.
 */
const isSpaAssetHost = (hostname: string) => {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (localAssetHosts.has(host)) return true;
  if (host === 'scrolith.com' || host === 'www.scrolith.com') return true;
  // Historical frontend Cloud Run hosts that also serve the SPA shell.
  if (host.includes('scrolith-frontend') && host.endsWith('.run.app')) return true;
  return false;
};

/** Canonical API hosts whose file-content URLs must never be rewritten. */
const isCanonicalApiAssetHost = (hostname: string) => {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'api.scrolith.com') return true;
  if (host.endsWith('.api.scrolith.com')) return true;
  try {
    const backend = resolveBackendOrigin();
    if (backend) {
      const backendHost = new URL(backend).hostname.toLowerCase();
      if (backendHost && host === backendHost) return true;
    }
  } catch {
    // ignore
  }
  // Historical backend Cloud Run host — keep absolute content URLs as-is.
  if (host.includes('scrolith-backend') && host.endsWith('.run.app')) return true;
  return false;
};

/** True for relative uploads or absolute upload URLs from a known Scrolith API host. */
export const isCanonicalApiUploadUrl = (value: unknown) => {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (normalized.startsWith('/uploads/') || normalized.startsWith('uploads/')) return true;

  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.pathname.toLowerCase().startsWith('/uploads/') &&
      isCanonicalApiAssetHost(parsed.hostname);
  } catch {
    return false;
  }
};

/** Pre-signed / tokenized object URLs must never be rewritten (signatures are host-bound). */
const isSignedOrTokenizedUrl = (url: URL) => {
  for (const key of url.searchParams.keys()) {
    const k = String(key || '').toLowerCase();
    if (
      k.includes('signature') ||
      k.includes('x-amz-') ||
      k.startsWith('x-goog-') ||
      k.startsWith('x-oss-') ||
      k === 'token' ||
      k === 'sig' ||
      k === 'expires' ||
      k === 'expire' ||
      k === 'expiry' ||
      k === 'key-pair-id' ||
      k === 'policy' ||
      k === 'credential' ||
      k.includes('credential')
    ) {
      return true;
    }
  }
  return false;
};

const isLikelyBareFileId = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.toLowerCase().startsWith('disk:')) return true;
  if (
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith('/') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:')
  ) {
    return false;
  }
  if (/\s/.test(normalized)) return false;
  if (normalized.includes('://')) return false;
  // cuid / opaque ids
  if (/^[a-z0-9_-]{12,}$/i.test(normalized)) return true;
  // uuid
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return true;
  }
  return false;
};

export const resolveAssetUrl = (value?: string | null) => {
  if (!value) return value ?? '';
  const trimmed = String(value).trim();
  if (!trimmed) return trimmed;

  const recoveredAbsoluteUrl = recoverEncodedAbsoluteAssetUrl(trimmed);
  if (recoveredAbsoluteUrl && recoveredAbsoluteUrl !== trimmed) {
    return resolveAssetUrl(recoveredAbsoluteUrl);
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:')
  ) {
    return trimmed;
  }

  // disk: legacy local-file ids are served through the content API.
  if (lower.startsWith('disk:')) {
    const path = `/api/files/content/${encodeURIComponent(trimmed)}`;
    const origin = resolveBackendOrigin();
    return origin ? `${origin}${path}` : path;
  }

  let backendOrigin = resolveBackendOrigin();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    // Non-platform absolute URLs (CDN, GCS, external) — never rewrite.
    if (!isAssetPath(lower)) return trimmed;
    try {
      const url = new URL(trimmed);
      const hostname = url.hostname.toLowerCase();

      // Never rewrite signed URLs (signature is bound to host + path + query).
      if (isSignedOrTokenizedUrl(url)) return trimmed;

      // A direct release-candidate frontend may be built against an isolated
      // backend origin. Rewrite canonical API media links only in that case;
      // production remains unchanged because its backend origin is api.scrolith.com.
      if (isCanonicalApiAssetHost(hostname)) {
        const candidateOrigin = backendOrigin || '';
        if (candidateOrigin) {
          try {
            const candidateHost = new URL(candidateOrigin).hostname.toLowerCase();
            if (candidateHost && candidateHost !== hostname) {
              return `${candidateOrigin}${url.pathname}${url.search}${url.hash}`;
            }
          } catch {
            // Keep the original canonical URL when the configured origin is invalid.
          }
        }
        // A canonical production URL in API data must not bypass the configured
        // deployment target. Relative resolution fails closed in that environment.
        return `${url.pathname}${url.search}${url.hash}`;
      }

      // Only rewrite SPA hosts that would otherwise return HTML for /api or /uploads.
      if (!isSpaAssetHost(hostname)) return trimmed;

      return backendOrigin ? `${backendOrigin}${url.pathname}${url.search}${url.hash}` : `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return trimmed;
    }
  }

  if (isAssetPath(lower)) {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return backendOrigin ? `${backendOrigin}${path}` : path;
  }

  // Bare storage/file IDs (cuid/uuid/disk:) are commonly stored in cover/avatar fields.
  // Convert them to the public content endpoint instead of using the raw id as an <img src>.
  if (isLikelyBareFileId(trimmed)) {
    const path = `/api/files/content/${encodeURIComponent(trimmed)}`;
    return backendOrigin ? `${backendOrigin}${path}` : path;
  }

  return trimmed;
};

const normalizePositiveInt = (value?: number | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(4096, Math.round(parsed)));
};

export const resolveResponsiveAssetUrl = (
  value?: string | null,
  options: AssetTransformOptions = {}
) => {
  const resolved = resolveAssetUrl(value);
  if (!resolved) return resolved ?? '';

  const width = normalizePositiveInt(options.width);
  const height = normalizePositiveInt(options.height);
  if (!width && !height) return resolved;

  // Never attach transform params to signed URLs — they invalidate the signature.
  try {
    if (/^https?:\/\//i.test(resolved)) {
      const absolute = new URL(resolved);
      if (isSignedOrTokenizedUrl(absolute)) return resolved;
    }
  } catch {
    // ignore
  }

  const fit: AssetTransformFit =
    options.fit === 'cover' || options.fit === 'contain' ? options.fit : 'inside';
  const quality = normalizePositiveInt(options.quality);
  const isAbsolute = /^https?:\/\//i.test(resolved);
  const fallbackOrigin =
    getBackendOrigin() ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  // Server-side rendering without a configured backend origin should keep the
  // relative URL intact instead of inventing a loopback destination.
  if (!isAbsolute && !fallbackOrigin) return resolved;

  try {
    const url = isAbsolute ? new URL(resolved) : new URL(resolved, fallbackOrigin);
    if (!url.pathname.toLowerCase().includes(FILE_CONTENT_PATH)) {
      return resolved;
    }
    if (width) url.searchParams.set('w', String(width));
    if (height) url.searchParams.set('h', String(height));
    url.searchParams.set('fit', fit);
    if (quality) url.searchParams.set('q', String(Math.max(40, Math.min(90, quality))));
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return resolved;
  }
};

export const resolveOptimizedStaticImageUrl = (value?: string | null) => {
  const resolved = resolveAssetUrl(value);
  if (!resolved) return resolved ?? '';

  // Keep the built-in relative logo fallback on the small immutable asset too.
  // Auth pages commonly receive `/logo.png` from their default config before
  // the asynchronous branding payload is available.
  if (resolved === '/logo.png' || resolved === '/logo-64.png') {
    return '/logo-64.png';
  }

  // Keep legacy CMS brand settings on the small immutable logo asset. This is
  // intentionally limited to the platform logo path; uploaded media and
  // external assets must retain their original URLs.
  try {
    const url = new URL(resolved);
    const host = url.hostname.toLowerCase();
    if (
      (host === 'scrolith.com' || host === 'www.scrolith.com') &&
      (url.pathname === '/logo.png' || url.pathname === '/logo-64.png')
    ) {
      return '/logo-64.png';
    }
  } catch {
    // Keep non-URL values unchanged.
  }

  return resolved;
};
