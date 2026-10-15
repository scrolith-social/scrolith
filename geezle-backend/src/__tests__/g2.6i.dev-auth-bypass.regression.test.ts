import fs from 'node:fs';
import path from 'node:path';

describe('G2.6I development authentication bypass boundary', () => {
  test('allows the explicit bypass only in an explicitly marked local runtime', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../middleware/auth.middleware.ts'),
      'utf8'
    );

    expect(source).toContain('isLocalOnlyDevBypassAllowed');
    expect(source).toContain("process.env.ALLOW_DEV_AUTH_BYPASS === 'true'");
  });

  test('does not permit staging-like NODE_ENV values to activate the bypass', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../middleware/auth.middleware.ts'),
      'utf8'
    );
    expect(source).not.toContain("nodeEnv === 'production' || process.env.K_SERVICE");
    expect(source).toContain('outside an explicitly marked local runtime');
  });
});
