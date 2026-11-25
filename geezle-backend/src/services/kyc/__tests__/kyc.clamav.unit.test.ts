import { scanBufferWithClamAv } from '../kyc.clamav.service';

describe('kyc.clamav', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('mock_clean returns clean', async () => {
    process.env.CLAMAV_MODE = 'mock_clean';
    const result = await scanBufferWithClamAv(Buffer.from('hello'));
    expect(result.clean).toBe(true);
    expect(result.infected).toBe(false);
    expect(result.unavailable).toBe(false);
  });

  test('mock_infected returns infected', async () => {
    process.env.CLAMAV_MODE = 'mock_infected';
    const result = await scanBufferWithClamAv(Buffer.from('eicar'));
    expect(result.clean).toBe(false);
    expect(result.infected).toBe(true);
  });

  test('disabled fails closed', async () => {
    process.env.CLAMAV_MODE = 'disabled';
    const result = await scanBufferWithClamAv(Buffer.from('x'));
    expect(result.clean).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  test.each([
    ['mock_clean', 'false'],
    ['mock_infected', 'false'],
    ['fail_open', 'true'],
    ['defer', 'true'],
    ['tcp', 'true'],
    ['', 'false']
  ])('production rejects unsafe scanner mode %s with fail-open=%s', async (mode, failOpen) => {
    process.env.NODE_ENV = 'production';
    process.env.CLAMAV_MODE = mode;
    process.env.KYC_CLAMAV_FAIL_OPEN = failOpen;
    const result = await scanBufferWithClamAv(Buffer.from('synthetic fixture'));
    expect(result.clean).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.rawStatus).toBe('UNAVAILABLE');
  });

  test('production permits only explicit TCP mode with fail-open false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLAMAV_MODE = 'tcp';
    process.env.KYC_CLAMAV_FAIL_OPEN = 'false';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1';
    process.env.CLAMAV_RETRIES = '0';
    process.env.CLAMAV_TIMEOUT_MS = '25';
    const result = await scanBufferWithClamAv(Buffer.from('synthetic fixture'));
    expect(result.clean).toBe(false);
    expect(result.unavailable).toBe(true);
  });
});
