import express from 'express';
import request from 'supertest';
import { MemoryStore } from 'express-rate-limit';
import {
  createIdentifierRateLimiter,
  identifierHash
} from '../authRateLimit.middleware';
import { getTrustedClientIp } from '../../utils/security/clientIdentity';

describe('identifier-based authentication rate limits', () => {
  const buildApp = (max: number) => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.post(
      '/login',
      createIdentifierRateLimiter({
        prefix: 'test:auth:identifier:',
        windowMs: 60_000,
        max,
        store: new MemoryStore(),
        getIdentifier: (req) => String(req.body?.email || '')
      }),
      (_req, res) => res.status(200).json({ success: true })
    );
    return app;
  };

  test('limits the same identifier across different effective IPs', async () => {
    const app = buildApp(2);

    await request(app)
      .post('/login')
      .set('X-Forwarded-For', 'client-a')
      .send({ email: 'synthetic@example.invalid' })
      .expect(200);
    await request(app)
      .post('/login')
      .set('X-Forwarded-For', 'client-b')
      .send({ email: 'synthetic@example.invalid' })
      .expect(200);
    await request(app)
      .post('/login')
      .set('X-Forwarded-For', 'client-c')
      .send({ email: 'synthetic@example.invalid' })
      .expect(429);
  });

  test('does not use spoofed forwarded prefixes as the identifier key', async () => {
    const app = buildApp(1);

    await request(app)
      .post('/login')
      .set('X-Forwarded-For', 'spoofed-a, canonical-client')
      .send({ email: 'same@example.invalid' })
      .expect(200);
    await request(app)
      .post('/login')
      .set('X-Forwarded-For', 'spoofed-b, canonical-client')
      .send({ email: 'same@example.invalid' })
      .expect(429);
  });

  test('hashes identifiers without retaining the raw value', () => {
    const hash = identifierHash('same@example.invalid');
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(hash).not.toContain('same');
    expect(hash).not.toContain('@');
  });

  test('uses Express trusted semantics instead of parsing forwarded headers', () => {
    const req = {
      ip: 'resolved-by-express',
      socket: { remoteAddress: 'proxy-address' },
      headers: { 'x-forwarded-for': 'spoofed-prefix, resolved-by-express' }
    } as any;
    expect(getTrustedClientIp(req)).toBe('resolved-by-express');
  });

  test('does not trust arbitrary IPv4 clients through a short IPv4-mapped IPv6 subnet', async () => {
    const app = express();
    app.set('trust proxy', '::ffff:10.0.0.0/8');
    app.get('/client-ip', (req, res) => res.json({ ip: req.ip }));

    const spoofedIp = '198.51.100.23';
    const response = await request(app)
      .get('/client-ip')
      .set('X-Forwarded-For', spoofedIp)
      .expect(200);

    expect(response.body.ip).not.toBe(spoofedIp);
  });
});
