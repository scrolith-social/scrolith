const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Require a deliberately selected local HTTP(S) target for certification tools. */
export function requireLoopbackTestUrl(value, variableName = 'CERT_BASE_URL') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${variableName} must be explicitly set to a loopback HTTP(S) URL.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid loopback HTTP(S) URL.`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${variableName} must use localhost, 127.0.0.1, or ::1 without credentials, query, or fragment.`);
  }

  return url.toString();
}
