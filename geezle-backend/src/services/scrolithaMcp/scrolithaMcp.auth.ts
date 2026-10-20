import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { Request } from 'express';

const SUPPORTED_MCP_ALGORITHMS = ['RS256', 'ES256'] as const;
type SupportedMcpAlgorithm = (typeof SUPPORTED_MCP_ALGORITHMS)[number];
const MAX_SUBJECT_LENGTH = 256;

export type McpPrincipal = {
  subject: string;
  scopes: ReadonlySet<string>;
  issuer?: string;
};

export class McpAuthError extends Error {
  readonly statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 401) {
    super(message);
    this.name = 'McpAuthError';
    this.statusCode = statusCode;
  }
}

export type McpTokenVerifier = (request: Request) => Promise<McpPrincipal>;
export type McpJwtKeySet = Parameters<typeof jwtVerify>[1];

const parseBearerToken = (request: Request) => {
  const authorization = String(request.headers.authorization || '');
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) throw new McpAuthError('Bearer authentication required');
  return match[1];
};

const parseScopes = (payload: JWTPayload) => {
  const raw = typeof payload.scope === 'string' ? payload.scope : '';
  return new Set(raw.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
};

const requireHttpsUrl = (value: string, label: string) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials`);
  return parsed;
};

export const validateMcpClaims = (
  payload: JWTPayload,
  expected: { issuer: string; audience: string; resource?: string; requiredScope?: string }
): McpPrincipal => {
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > MAX_SUBJECT_LENGTH) {
    throw new McpAuthError('Authenticated subject is required');
  }

  if (payload.iss !== expected.issuer) throw new McpAuthError('Token issuer is invalid');
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(expected.audience)) throw new McpAuthError('Token audience is invalid');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new McpAuthError('Token is expired or has no expiry');
  }
  if (typeof payload.nbf === 'number' && (!Number.isFinite(payload.nbf) || payload.nbf > now)) {
    throw new McpAuthError('Token is not active');
  }

  const scopes = parseScopes(payload);
  const requiredScope = expected.requiredScope || 'scrolith:read';
  if (!scopes.has(requiredScope)) {
    throw new McpAuthError('Required scope is missing', 403);
  }

  if (expected.resource) {
    const resource = typeof (payload as JWTPayload & { resource?: unknown }).resource === 'string'
      ? (payload as JWTPayload & { resource?: string }).resource
      : '';
    if (resource !== expected.resource) throw new McpAuthError('Token resource is invalid', 403);
  }

  return { subject: payload.sub, scopes, issuer: typeof payload.iss === 'string' ? payload.iss : undefined };
};

export const createMcpJwtVerifier = (config: {
  issuer: string;
  audience: string;
  jwksUrl: string;
  resource?: string;
  requiredScope?: string;
  algorithms?: readonly SupportedMcpAlgorithm[];
}, keySet?: McpJwtKeySet): McpTokenVerifier => {
  requireHttpsUrl(config.issuer, 'MCP OAuth issuer');
  if (!config.audience.trim()) throw new Error('MCP OAuth audience is required');
  if (config.resource) requireHttpsUrl(config.resource, 'MCP resource URI');
  const jwksUrl = requireHttpsUrl(config.jwksUrl, 'MCP JWKS URL');
  const algorithms = config.algorithms?.length ? [...config.algorithms] : [...SUPPORTED_MCP_ALGORITHMS];
  const jwks = keySet || createRemoteJWKSet(jwksUrl);

  return async (request) => {
    const token = parseBearerToken(request);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms
      });
      return validateMcpClaims(payload, config);
    } catch (error) {
      if (error instanceof McpAuthError) throw error;
      throw new McpAuthError('Token verification failed');
    }
  };
};

export const createMcpJwtVerifierFromEnv = (env: NodeJS.ProcessEnv = process.env): McpTokenVerifier => {
  const issuer = String(env.MCP_OAUTH_ISSUER || '').trim();
  const audience = String(env.MCP_OAUTH_AUDIENCE || '').trim();
  const jwksUrl = String(env.MCP_OAUTH_JWKS_URL || '').trim();
  const resource = String(env.MCP_RESOURCE_URI || '').trim() || undefined;

  if (!issuer || !audience || !jwksUrl) {
    throw new Error('MCP OAuth issuer, audience, and JWKS URL are required');
  }
  requireHttpsUrl(issuer, 'MCP OAuth issuer');
  const parsed = requireHttpsUrl(jwksUrl, 'MCP JWKS URL');
  if (resource) requireHttpsUrl(resource, 'MCP resource URI');

  const configuredAlgorithms = String(env.MCP_OAUTH_ALGORITHMS || 'RS256,ES256')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    configuredAlgorithms.length === 0 ||
    configuredAlgorithms.some((algorithm) => !(SUPPORTED_MCP_ALGORITHMS as readonly string[]).includes(algorithm))
  ) {
    throw new Error('MCP OAuth algorithms must be an explicit subset of RS256,ES256');
  }

  return createMcpJwtVerifier({
    issuer,
    audience,
    jwksUrl: parsed.toString(),
    resource,
    requiredScope: String(env.MCP_REQUIRED_READ_SCOPE || 'scrolith:read').trim(),
    algorithms: configuredAlgorithms as SupportedMcpAlgorithm[]
  });
};
