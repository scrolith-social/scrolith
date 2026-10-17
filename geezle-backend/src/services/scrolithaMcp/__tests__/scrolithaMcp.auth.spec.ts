import {
  McpAuthError,
  createMcpJwtVerifier,
  createMcpJwtVerifierFromEnv,
  validateMcpClaims
} from '../scrolithaMcp.auth';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

describe('Scrolitha MCP claim validation', () => {
  const expected = {
    issuer: 'https://identity.example.test',
    audience: 'scrolitha-mcp',
    resource: 'https://api.example.test/mcp'
  };

  test('accepts a subject with the explicit read scope and resource', () => {
    const principal = validateMcpClaims(
      {
        sub: 'user-1',
        iss: expected.issuer,
        aud: expected.audience,
        exp: Math.floor(Date.now() / 1000) + 300,
        scope: 'openid scrolith:read',
        resource: expected.resource
      } as any,
      expected
    );
    expect(principal.subject).toBe('user-1');
    expect(principal.scopes.has('scrolith:read')).toBe(true);
  });

  test('rejects a missing read scope', () => {
    expect(() =>
      validateMcpClaims(
        {
          sub: 'user-1',
          iss: expected.issuer,
          aud: expected.audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          scope: 'openid',
          resource: expected.resource
        } as any,
        expected
      )
    ).toThrow(McpAuthError);
  });

  test('rejects a resource intended for a different MCP endpoint', () => {
    expect(() =>
      validateMcpClaims(
        {
          sub: 'user-1',
          iss: expected.issuer,
          aud: expected.audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          scope: 'scrolith:read',
          resource: 'https://other.example.test/mcp'
        } as any,
        expected
      )
    ).toThrow(McpAuthError);
  });

  test('rejects a token without a stable subject', () => {
    expect(() =>
      validateMcpClaims(
        {
          iss: expected.issuer,
          aud: expected.audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          scope: 'scrolith:read',
          resource: expected.resource
        } as any,
        expected
      )
    ).toThrow(McpAuthError);
  });

  test.each([
    ['issuer', { iss: 'https://other.example.test' }],
    ['audience', { aud: 'another-resource' }],
    ['future not-before', { nbf: Math.floor(Date.now() / 1000) + 300 }]
  ])('rejects an invalid %s claim', (_label, override) => {
    expect(() => validateMcpClaims({
      sub: 'user-1',
      iss: expected.issuer,
      aud: expected.audience,
      exp: Math.floor(Date.now() / 1000) + 600,
      scope: 'scrolith:read',
      resource: expected.resource,
      ...override
    } as any, expected)).toThrow(McpAuthError);
  });

  test('rejects expired tokens', () => {
    expect(() => validateMcpClaims({
      sub: 'user-1',
      iss: expected.issuer,
      aud: expected.audience,
      exp: Math.floor(Date.now() / 1000) - 1,
      scope: 'scrolith:read',
      resource: expected.resource
    } as any, expected)).toThrow(McpAuthError);
  });

  test('rejects malformed bearer headers before attempting JWKS access', async () => {
    const verifier = createMcpJwtVerifier({
      issuer: expected.issuer,
      audience: expected.audience,
      jwksUrl: 'https://identity.example.test/.well-known/jwks.json'
    });
    await expect(verifier({ headers: { authorization: 'Basic not-a-bearer' } } as any))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects a token with an invalid signature using a synthetic local JWKS', async () => {
    const [{ publicKey }, { privateKey: signingKey }] = await Promise.all([
      generateKeyPair('RS256'),
      generateKeyPair('RS256')
    ]);
    const publicJwk = await exportJWK(publicKey);
    const verifier = createMcpJwtVerifier({
      issuer: expected.issuer,
      audience: expected.audience,
      jwksUrl: 'https://identity.example.test/.well-known/jwks.json',
      resource: expected.resource
    }, createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'synthetic-key' }] }));
    const token = await new SignJWT({ scope: 'scrolith:read', resource: expected.resource })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' })
      .setSubject('user-1')
      .setIssuer(expected.issuer)
      .setAudience(expected.audience)
      .setExpirationTime('5m')
      .sign(signingKey);

    await expect(verifier({ headers: { authorization: `Bearer ${token}` } } as any))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects insecure or unsupported OAuth configuration', () => {
    expect(() => createMcpJwtVerifierFromEnv({
      MCP_OAUTH_ISSUER: 'http://identity.example.test',
      MCP_OAUTH_AUDIENCE: expected.audience,
      MCP_OAUTH_JWKS_URL: 'https://identity.example.test/jwks'
    })).toThrow(/HTTPS/);

    expect(() => createMcpJwtVerifierFromEnv({
      MCP_OAUTH_ISSUER: expected.issuer,
      MCP_OAUTH_AUDIENCE: expected.audience,
      MCP_OAUTH_JWKS_URL: 'https://identity.example.test/jwks',
      MCP_OAUTH_ALGORITHMS: 'none'
    })).toThrow(/algorithms/);
  });
});
