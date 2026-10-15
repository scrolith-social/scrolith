/**
 * Production runtime detection for security fail-closed behavior.
 * Ambiguous environments are treated as production-like when NODE_ENV is production
 * or Cloud Run service env is present.
 */
export const isProductionRuntime = (): boolean => {
  const nodeEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (nodeEnv === 'production') return true;
  // Cloud and managed-container runtimes are never eligible for local bypasses,
  // even if an incorrectly configured deployment reports development/test.
  if (
    process.env.K_SERVICE ||
    process.env.CONTAINER_APP_NAME ||
    process.env.CONTAINER_APP_REVISION ||
    process.env.WEBSITE_SITE_NAME ||
    process.env.WEBSITE_INSTANCE_ID ||
    process.env.AZURE_CONTAINER_APPS_ENVIRONMENT_ID
  ) {
    return true;
  }
  return false;
};

export const isTruthyEnv = (raw: string | undefined | null): boolean =>
  ['1', 'true', 'yes', 'on'].includes(String(raw || '').trim().toLowerCase());

/** Roles that may join administrative realtime rooms (from DB, never client). */
export const isAuthoritativeAdminRole = (role: unknown): boolean => {
  const r = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!r) return false;
  // Exact allowlist only — never substring matching (blocks not_admin, etc.)
  const allowed = new Set([
    'admin',
    'superadmin',
    'super_admin',
    'platform_admin',
    'platformadmin',
    'owner'
  ]);
  return allowed.has(r);
};

/**
 * Development authentication/admin bypasses are permitted only for an
 * explicitly marked local test runtime. The marker is intentionally separate
 * from NODE_ENV so a staging deployment cannot enable a bypass by setting a
 * familiar development value.
 */
export const isLocalOnlyDevBypassAllowed = (): boolean => {
  const nodeEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  return (
    ['development', 'test'].includes(nodeEnv) &&
    isTruthyEnv(process.env.ALLOW_DEV_BYPASS_LOCAL_ONLY) &&
    !isProductionRuntime()
  );
};
