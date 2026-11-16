import { resolveApiBaseForEnvironment, type ScrolithApiEnvironment } from './apiBasePolicy';

type OAuthApiUrlContext = {
  isNative: boolean;
  isDevelopment: boolean;
  environment?: ScrolithApiEnvironment;
};

type OAuthNavigationContext = OAuthApiUrlContext & {
  currentOrigin: string;
  apiBase: string;
};

const environmentFor = (context: OAuthApiUrlContext): ScrolithApiEnvironment =>
  context.environment || (context.isDevelopment ? 'development' : 'production');

/** Resolve only an explicitly allowed API target; there is no production fallback. */
export const resolveOAuthApiBase = (
  configuredBase: string | undefined,
  context: OAuthApiUrlContext
): string | null => {
  const environment = environmentFor(context);
  const apiBase = resolveApiBaseForEnvironment(configuredBase, environment, context.isNative);
  if (!apiBase) return null;
  return apiBase;
};

/** OAuth initiation may navigate only to the validated API origin and route. */
export const resolveOAuthNavigationUrl = (
  value: string,
  context: OAuthNavigationContext
): string | null => {
  const raw = String(value || '').trim();
  if (!raw || !context.apiBase) return null;

  let parsed: URL;
  let api: URL;
  try {
    api = new URL(context.apiBase, context.currentOrigin);
    parsed = new URL(raw, context.currentOrigin);
  } catch {
    return null;
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.origin !== api.origin ||
    !parsed.pathname.startsWith(`${api.pathname.replace(/\/$/, '')}/auth/oauth/`)
  ) return null;

  if (parsed.protocol === 'https:') return parsed.href;
  if (
    parsed.protocol === 'http:' &&
    environmentFor(context) === 'development' &&
    context.isDevelopment &&
    api.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1', '10.0.2.2'].includes(api.hostname.replace(/^\[|\]$/g, '').toLowerCase())
  ) return parsed.href;
  return null;
};
