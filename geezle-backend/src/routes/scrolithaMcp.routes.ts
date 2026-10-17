import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createMcpJwtVerifierFromEnv,
  McpAuthError,
  type McpTokenVerifier
} from '../services/scrolithaMcp/scrolithaMcp.auth';
import { isProductionRuntime } from '../utils/security/isProductionRuntime';
import type { McpDataSource } from '../services/scrolithaMcp/scrolithaMcp.types';
import { createScrolithaMcpServer } from '../services/scrolithaMcp/scrolithaMcp.server';

export type ScrolithaMcpRouterOptions = {
  enabled?: boolean;
  verifier?: McpTokenVerifier;
  dataSource?: McpDataSource;
  allowedHosts?: string[];
};

const truthy = (value: unknown) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const normalizeAllowedHosts = (values: string[]) => [...new Set(values.map((value) => {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('*') || raw.includes('://')) {
    throw new Error('MCP_ALLOWED_HOSTS must contain exact host values, not URLs or wildcards');
  }
  const parsed = new URL(`http://${raw}`);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('MCP_ALLOWED_HOSTS must contain host and optional port only');
  }
  return parsed.host.toLowerCase();
}))];

const positiveInteger = (value: unknown, fallback: number, max: number) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const isSecureRequest = (request: Request) => {
  if (request.secure) return true;
  return truthy(process.env.MCP_TRUST_PROXY) && request.headers['x-forwarded-proto'] === 'https';
};

const isProductionLikeRuntime = () =>
  isProductionRuntime() || Boolean(String(process.env.K_SERVICE || '').trim());

const createTransport = (allowedHosts: string[]) =>
  new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts,
    enableDnsRebindingProtection: allowedHosts.length > 0
  });

const resourceMetadataUrl = (resourceUri: string, configured: string) => {
  const value = configured.trim();
  if (value) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('MCP resource metadata URL must use HTTPS');
    return parsed.toString();
  }
  if (!resourceUri) return '';
  const resource = new URL(resourceUri);
  resource.pathname = '/.well-known/oauth-protected-resource';
  resource.search = '';
  resource.hash = '';
  return resource.toString();
};

const setBearerChallenge = (response: Response, metadataUrl: string, scope: string) => {
  const parts = [`realm="scrolitha-mcp"`, `scope="${scope.replace(/"/g, '')}"`];
  if (metadataUrl) parts.push(`resource_metadata="${metadataUrl.replace(/"/g, '')}"`);
  response.setHeader('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
};

export const createScrolithaMcpRouter = (options: ScrolithaMcpRouterOptions = {}) => {
  const router = express.Router();
  const enabled = options.enabled ?? truthy(process.env.MCP_ENABLED);
  const configuredAllowedHosts = options.allowedHosts || String(process.env.MCP_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedHosts = enabled ? normalizeAllowedHosts(configuredAllowedHosts) : [];
  const resourceUri = enabled ? String(process.env.MCP_RESOURCE_URI || '').trim() : '';
  const requiredScope = String(process.env.MCP_REQUIRED_READ_SCOPE || 'scrolith:read').trim();
  const metadataUrl = enabled
    ? resourceMetadataUrl(resourceUri, String(process.env.MCP_RESOURCE_METADATA_URL || ''))
    : '';
  const verifier = options.verifier || (enabled ? createMcpJwtVerifierFromEnv() : undefined);
  const dataSource: McpDataSource | undefined =
    options.dataSource || (enabled
      ? (require('../services/scrolithaMcp/scrolithaMcp.data').prismaMcpDataSource as McpDataSource)
      : undefined);

  if (enabled && isProductionLikeRuntime() && allowedHosts.length === 0) {
    throw new Error('MCP_ALLOWED_HOSTS must be configured before enabling MCP in production');
  }
  if (enabled && isProductionLikeRuntime() && !resourceUri) {
    throw new Error('MCP_RESOURCE_URI must be configured before enabling MCP in production');
  }

  router.get('/.well-known/oauth-protected-resource', (_request, response) => {
    if (!enabled) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    if (!resourceUri || !metadataUrl || !process.env.MCP_OAUTH_ISSUER) {
      response.status(503).json({ error: 'MCP OAuth metadata is unavailable' });
      return;
    }
    response.json({
      resource: resourceUri,
      authorization_servers: [String(process.env.MCP_OAUTH_AUTHORIZATION_SERVER || process.env.MCP_OAUTH_ISSUER)],
      scopes_supported: [requiredScope],
      bearer_methods_supported: ['header']
    });
  });

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: positiveInteger(process.env.MCP_RATE_LIMIT_PER_MINUTE, 30, 300),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'MCP rate limit exceeded' }
  });
  router.use(limiter);
  router.use(express.json({ limit: '1mb', strict: true }));

  router.all('*', async (request: Request, response: Response) => {
    if (!enabled) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, DELETE');
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (isProductionLikeRuntime() && !isSecureRequest(request)) {
      response.status(400).json({ error: 'HTTPS is required' });
      return;
    }
    if (!verifier) {
      response.status(503).json({ error: 'MCP authentication is unavailable' });
      return;
    }
    if (!dataSource) {
      response.status(503).json({ error: 'MCP data source is unavailable' });
      return;
    }

    let principal;
    try {
      principal = await verifier(request);
    } catch (error) {
      const status = error instanceof McpAuthError ? error.statusCode : 401;
      if (status === 401) setBearerChallenge(response, metadataUrl, requiredScope);
      response.status(status).json({ error: status === 403 ? 'MCP access denied' : 'MCP authentication failed' });
      return;
    }

    const server = createScrolithaMcpServer({ principal, dataSource });
    const transport = createTransport(allowedHosts);
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: 'MCP request failed' });
      else console.error('[mcp] request failed after response started', String((error as Error)?.name || 'Error'));
    } finally {
      await server.close().catch(() => undefined);
    }
  });

  return router;
};

export default createScrolithaMcpRouter;
