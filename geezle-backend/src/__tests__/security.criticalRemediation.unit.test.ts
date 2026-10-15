/**
 * Critical security remediation — focused adversarial + unit tests.
 * @jest-environment node
 */

import {
  isAuthoritativeAdminRole,
  isLocalOnlyDevBypassAllowed,
  isProductionRuntime,
  isTruthyEnv
} from '../utils/security/isProductionRuntime';
import { isAdminRole as isRbacAdminRole } from '../services/rbac.service';
import { isAdminRole as isSystemControlsAdminRole } from '../services/systemControls.service';
import fs from 'fs';
import path from 'path';

// These classifier tests must remain database-free. The imported service
// modules expose pure role helpers but also initialize the Prisma singleton.
jest.mock('../utils/prismaClient', () => ({}));

describe('isAuthoritativeAdminRole', () => {
  test('accepts real admin roles', () => {
    expect(isAuthoritativeAdminRole('ADMIN')).toBe(true);
    expect(isAuthoritativeAdminRole('SUPER_ADMIN')).toBe(true);
    expect(isAuthoritativeAdminRole('platform_admin')).toBe(true);
    expect(isAuthoritativeAdminRole('Owner')).toBe(true);
  });

  test('rejects non-admin and substring traps', () => {
    expect(isAuthoritativeAdminRole('FREELANCER')).toBe(false);
    expect(isAuthoritativeAdminRole('CLIENT')).toBe(false);
    expect(isAuthoritativeAdminRole('not_admin')).toBe(false);
    expect(isAuthoritativeAdminRole('Finance Admin')).toBe(false);
    expect(isAuthoritativeAdminRole('staff_admin')).toBe(false);
    expect(isAuthoritativeAdminRole('content_admin')).toBe(false);
    expect(isAuthoritativeAdminRole('')).toBe(false);
    expect(isAuthoritativeAdminRole(null)).toBe(false);
  });

  test('RBAC and system-controls classifiers use the same exact allowlist', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'platform_admin', 'Owner']) {
      expect(isRbacAdminRole(role)).toBe(true);
      expect(isSystemControlsAdminRole(role)).toBe(true);
    }
    for (const role of ['Finance Admin', 'administrator', 'not_admin', 'content_admin']) {
      expect(isRbacAdminRole(role)).toBe(false);
      expect(isSystemControlsAdminRole(role)).toBe(false);
    }
  });

  test('ignores client spoof strings that only contain admin as substring incorrectly', () => {
    // "administrator" contains admin as segment after normalize? administrator -> parts [administrator] - not includes admin
    expect(isAuthoritativeAdminRole('administrator')).toBe(false);
  });
});

describe('production runtime flags', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  test('isProductionRuntime true for NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.K_SERVICE;
    expect(isProductionRuntime()).toBe(true);
  });

  test('isTruthyEnv parses flags', () => {
    expect(isTruthyEnv('true')).toBe(true);
    expect(isTruthyEnv('1')).toBe(true);
    expect(isTruthyEnv('false')).toBe(false);
    expect(isTruthyEnv(undefined)).toBe(false);
  });

  test('development bypass requires an explicit local-only marker', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CONTAINER_APP_NAME;
    delete process.env.K_SERVICE;
    delete process.env.ALLOW_DEV_BYPASS_LOCAL_ONLY;
    expect(isLocalOnlyDevBypassAllowed()).toBe(false);

    process.env.ALLOW_DEV_BYPASS_LOCAL_ONLY = 'true';
    expect(isLocalOnlyDevBypassAllowed()).toBe(true);

    process.env.CONTAINER_APP_NAME = 'staging-app';
    expect(isLocalOnlyDevBypassAllowed()).toBe(false);
  });
});

describe('administrator middleware trust boundaries', () => {
  test('middleware delegates administrator classification to the exact allowlist', () => {
    const adminMiddleware = fs.readFileSync(
      path.join(__dirname, '../middleware/admin.middleware.ts'),
      'utf8'
    );
    const authMiddleware = fs.readFileSync(
      path.join(__dirname, '../middleware/auth.middleware.ts'),
      'utf8'
    );
    const systemControls = fs.readFileSync(
      path.join(__dirname, '../services/systemControls.service.ts'),
      'utf8'
    );

    expect(adminMiddleware).toMatch(/isAuthoritativeAdminRole/);
    expect(adminMiddleware).not.toMatch(/roleName\.includes\(['"]admin['"]\)/);
    expect(authMiddleware).toMatch(/isAuthoritativeAdminRole/);
    expect(authMiddleware).not.toMatch(/v\.includes\(['"]admin['"]\)/);
    expect(systemControls).not.toMatch(/r\.includes\(['"]ADMIN['"]\)/);
  });
});

describe('rate-limit skip logic (production)', () => {
  test('server source does not honor x-skip-ratelimit in production skip path', () => {
    const serverPath = path.join(__dirname, '../server.ts');
    const text = fs.readFileSync(serverPath, 'utf8');
    // Must not return true solely because of client headers
    expect(text).toMatch(/Client-supplied bypass headers are IGNORED/);
    expect(text).not.toMatch(
      /if \(req\.headers\['x-dev-role'\] \|\| req\.headers\['x-skip-ratelimit'\]\) return true/
    );
  });
});

describe('Socket.IO admin trust', () => {
  test('server does not use query.role for isAdmin', () => {
    const serverPath = path.join(__dirname, '../server.ts');
    const text = fs.readFileSync(serverPath, 'utf8');
    expect(text).not.toMatch(/roleHint\.includes\('admin'\)/);
    expect(text).toMatch(/never query\.role/i);
  });

  test('community namespace requires authenticated principal', () => {
    const serverPath = path.join(__dirname, '../server.ts');
    const text = fs.readFileSync(serverPath, 'utf8');
    expect(text).toMatch(/if \(!user\)/);
    expect(text).toMatch(/next\(new Error\('unauthorized'\)\)/);
  });
});

describe('2FA fail-closed', () => {
  test('login does not fail open on 2FA gate errors', () => {
    const authPath = path.join(__dirname, '../controllers/auth.controller.ts');
    const text = fs.readFileSync(authPath, 'utf8');
    expect(text).not.toMatch(/2FA gate failed open/);
    expect(text).toMatch(/2FA_GATE_UNAVAILABLE/);
    expect(text).toMatch(/security\.2fa_gate_failed_closed/);
  });
});

describe('auth routes rate limits', () => {
  test('login and register use dedicated limiters', () => {
    const routesPath = path.join(__dirname, '../routes/auth.routes.ts');
    const text = fs.readFileSync(routesPath, 'utf8');
    expect(text).toMatch(/loginRateLimiter/);
    expect(text).toMatch(/registerRateLimiter/);
    expect(text).toMatch(/admin2faVerifyRateLimiter/);
  });
});

describe('runtime image safety', () => {
  test('deploy backend Dockerfile uses node dist/server.js', () => {
    const dockerPath = path.join(__dirname, '../../../deploy/docker/backend.Dockerfile');
    const text = fs.readFileSync(dockerPath, 'utf8');
    expect(text).toMatch(/node.*dist\/server\.js/);
    expect(text).not.toMatch(/migrate:apply/);
  });

  test('storyfix runtime Dockerfile uses node dist/server.js', () => {
    const dockerPath = path.join(__dirname, '../../Dockerfile.storyfix.runtime');
    const text = fs.readFileSync(dockerPath, 'utf8');
    expect(text).toMatch(/node.*dist\/server\.js/);
    expect(text).not.toMatch(/migrate:apply/);
  });
});

describe('gitignore secret hygiene', () => {
  test('gitignore covers env backups', () => {
    const gi = fs.readFileSync(path.join(__dirname, '../../.gitignore'), 'utf8');
    expect(gi).toMatch(/\.env\.\*/);
    expect(gi).toMatch(/\*\.backup/);
    expect(gi).toMatch(/localbackup/);
  });
});
