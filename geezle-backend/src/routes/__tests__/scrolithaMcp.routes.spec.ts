import express from 'express';
import request from 'supertest';
import { createScrolithaMcpRouter } from '../scrolithaMcp.routes';
import { McpAuthError } from '../../services/scrolithaMcp/scrolithaMcp.auth';

describe('Scrolitha MCP HTTP boundary', () => {
  test('is unavailable unless MCP_ENABLED is explicitly enabled', async () => {
    const app = express();
    app.use('/mcp', createScrolithaMcpRouter({ enabled: false, allowedHosts: ['*'] }));
    const response = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(response.status).toBe(404);
  });

  test('rejects unauthenticated requests before constructing a data query', async () => {
    const app = express();
    const dataSource = {
      getMyProfile: jest.fn(),
      searchJobs: jest.fn(),
      getJobDetails: jest.fn(),
      searchGigs: jest.fn(),
      getGigDetails: jest.fn()
    };
    app.use('/mcp', createScrolithaMcpRouter({
      enabled: true,
      dataSource,
      verifier: async () => {
        throw new McpAuthError('Bearer authentication required');
      }
    }));
    const response = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
    expect(dataSource.getMyProfile).not.toHaveBeenCalled();
  });

  test('rejects unsupported methods before authentication', async () => {
    const app = express();
    app.use('/mcp', createScrolithaMcpRouter({
      enabled: true,
      verifier: async () => {
        throw new Error('must not be called');
      },
      dataSource: {
        getMyProfile: jest.fn(),
        searchJobs: jest.fn(),
        getJobDetails: jest.fn(),
        searchGigs: jest.fn(),
        getGigDetails: jest.fn()
      }
    }));
    const response = await request(app).put('/mcp').send({});
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET, POST, DELETE');
  });

  test('completes a local authenticated MCP initialization without a database call', async () => {
    const app = express();
    app.use('/mcp', createScrolithaMcpRouter({
      enabled: true,
      verifier: async () => ({ subject: 'synthetic-user-1', scopes: new Set(['scrolith:read']) }),
      dataSource: {
        getMyProfile: jest.fn(),
        searchJobs: jest.fn(),
        getJobDetails: jest.fn(),
        searchGigs: jest.fn(),
        getGigDetails: jest.fn()
      }
    }));
    const response = await request(app)
      .post('/mcp')
      .set('Host', 'localhost')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'synthetic-local-client', version: '0.1.0' }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.result.serverInfo.name).toBe('scrolitha-readonly');
    expect(response.body.result.capabilities.tools).toBeDefined();
  });

  test('requires HTTPS before invoking authentication in production mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousResource = process.env.MCP_RESOURCE_URI;
    process.env.NODE_ENV = 'production';
    process.env.MCP_RESOURCE_URI = 'https://mcp.example.test/mcp';
    try {
      const verifier = jest.fn(async () => ({ subject: 'synthetic-user-1', scopes: new Set(['scrolith:read']) }));
      const app = express();
      app.use('/mcp', createScrolithaMcpRouter({
        enabled: true,
        allowedHosts: ['mcp.example.test'],
        verifier,
        dataSource: {
          getMyProfile: jest.fn(),
          searchJobs: jest.fn(),
          getJobDetails: jest.fn(),
          searchGigs: jest.fn(),
          getGigDetails: jest.fn()
        }
      }));
      const response = await request(app)
        .post('/mcp')
        .set('Host', 'mcp.example.test')
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(response.status).toBe(400);
      expect(verifier).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousResource === undefined) delete process.env.MCP_RESOURCE_URI;
      else process.env.MCP_RESOURCE_URI = previousResource;
    }
  });

  test('treats a managed runtime as production-like even when NODE_ENV is test', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousKService = process.env.K_SERVICE;
    const previousResource = process.env.MCP_RESOURCE_URI;
    process.env.NODE_ENV = 'test';
    process.env.K_SERVICE = 'synthetic-cloud-run';
    delete process.env.MCP_RESOURCE_URI;
    try {
      expect(() => createScrolithaMcpRouter({
        enabled: true,
        allowedHosts: ['mcp.example.test'],
        verifier: async () => ({ subject: 'synthetic-user-1', scopes: new Set(['scrolith:read']) }),
        dataSource: {
          getMyProfile: jest.fn(),
          searchJobs: jest.fn(),
          getJobDetails: jest.fn(),
          searchGigs: jest.fn(),
          getGigDetails: jest.fn()
        }
      })).toThrow(/MCP_RESOURCE_URI/);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousKService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = previousKService;
      if (previousResource === undefined) delete process.env.MCP_RESOURCE_URI;
      else process.env.MCP_RESOURCE_URI = previousResource;
    }
  });

  test('requires HTTPS in a managed runtime even when NODE_ENV is test', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousKService = process.env.K_SERVICE;
    const previousResource = process.env.MCP_RESOURCE_URI;
    process.env.NODE_ENV = 'test';
    process.env.K_SERVICE = 'synthetic-cloud-run';
    process.env.MCP_RESOURCE_URI = 'https://mcp.example.test/mcp';
    try {
      const verifier = jest.fn(async () => ({ subject: 'synthetic-user-1', scopes: new Set(['scrolith:read']) }));
      const app = express();
      app.use('/mcp', createScrolithaMcpRouter({
        enabled: true,
        allowedHosts: ['mcp.example.test'],
        verifier,
        dataSource: {
          getMyProfile: jest.fn(),
          searchJobs: jest.fn(),
          getJobDetails: jest.fn(),
          searchGigs: jest.fn(),
          getGigDetails: jest.fn()
        }
      }));
      const response = await request(app)
        .post('/mcp')
        .set('Host', 'mcp.example.test')
        .set('Authorization', 'Bearer synthetic-token')
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(response.status).toBe(400);
      expect(verifier).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousKService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = previousKService;
      if (previousResource === undefined) delete process.env.MCP_RESOURCE_URI;
      else process.env.MCP_RESOURCE_URI = previousResource;
    }
  });

  test('serves protected-resource metadata without exposing credentials', async () => {
    const previousResource = process.env.MCP_RESOURCE_URI;
    const previousIssuer = process.env.MCP_OAUTH_ISSUER;
    const previousAuthorizationServer = process.env.MCP_OAUTH_AUTHORIZATION_SERVER;
    process.env.MCP_RESOURCE_URI = 'https://mcp.example.test/mcp';
    process.env.MCP_OAUTH_ISSUER = 'https://identity.example.test';
    process.env.MCP_OAUTH_AUTHORIZATION_SERVER = 'https://identity.example.test';
    try {
      const app = express();
      app.use('/mcp', createScrolithaMcpRouter({
        enabled: true,
        verifier: async () => ({ subject: 'synthetic-user-1', scopes: new Set(['scrolith:read']) }),
        dataSource: {
          getMyProfile: jest.fn(),
          searchJobs: jest.fn(),
          getJobDetails: jest.fn(),
          searchGigs: jest.fn(),
          getGigDetails: jest.fn()
        }
      }));
      const response = await request(app).get('/mcp/.well-known/oauth-protected-resource');
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://identity.example.test'],
        scopes_supported: ['scrolith:read'],
        bearer_methods_supported: ['header']
      }));
      expect(JSON.stringify(response.body)).not.toMatch(/secret|token|password/i);
    } finally {
      if (previousResource === undefined) delete process.env.MCP_RESOURCE_URI;
      else process.env.MCP_RESOURCE_URI = previousResource;
      if (previousIssuer === undefined) delete process.env.MCP_OAUTH_ISSUER;
      else process.env.MCP_OAUTH_ISSUER = previousIssuer;
      if (previousAuthorizationServer === undefined) delete process.env.MCP_OAUTH_AUTHORIZATION_SERVER;
      else process.env.MCP_OAUTH_AUTHORIZATION_SERVER = previousAuthorizationServer;
    }
  });
});
