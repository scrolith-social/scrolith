import { EventEmitter } from 'events';

const mockTlsConnect = jest.fn();
jest.mock('tls', () => ({
  __esModule: true,
  default: { connect: mockTlsConnect },
  connect: mockTlsConnect
}));

import { pingClamAv, scanBufferWithClamAv } from '../kyc.clamav.service';

class SyntheticTlsSocket extends EventEmitter {
  setTimeout = jest.fn();
  destroy = jest.fn();
  writes: Buffer[] = [];

  write(value: Buffer | string) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.writes.push(data);

    if (data.toString('utf8') === 'zPING\0') {
      setImmediate(() => {
        this.emit('data', Buffer.from('PONG\0'));
        this.emit('end');
      });
      return true;
    }

    if (data.length === 4 && data.readUInt32BE(0) === 0) {
      setImmediate(() => {
        this.emit('data', Buffer.from('stream: OK\0'));
        this.emit('end');
      });
    }
    return true;
  }
}

describe('KYC ClamAV mutual TLS transport', () => {
  const originalEnv = { ...process.env };
  let socket: SyntheticTlsSocket;

  const configure = () => {
    process.env.NODE_ENV = 'production';
    process.env.CLAMAV_MODE = 'tcp_tls';
    process.env.CLAMAV_FAIL_OPEN = 'false';
    process.env.CLAMAV_HOST = 'scanner.internal.test';
    process.env.CLAMAV_PORT = '13310';
    process.env.CLAMAV_TLS_SERVER_NAME = 'scanner.internal.test';
    process.env.CLAMAV_TLS_CA_B64 = Buffer.from('synthetic-ca-pem').toString('base64');
    process.env.CLAMAV_TLS_CLIENT_CERT_B64 = Buffer.from('synthetic-client-certificate-pem').toString('base64');
    process.env.CLAMAV_TLS_CLIENT_KEY_B64 = Buffer.from('synthetic-client-key-pem').toString('base64');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    socket = new SyntheticTlsSocket();
    mockTlsConnect.mockImplementation(() => {
      setImmediate(() => socket.emit('secureConnect'));
      return socket;
    });
    configure();
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  test('uses hostname-verified TLS with a client certificate and scans the clamd protocol', async () => {
    const result = await scanBufferWithClamAv(Buffer.from('synthetic clean content'));

    expect(result).toMatchObject({ clean: true, infected: false, unavailable: false, rawStatus: 'CLEAN' });
    expect(mockTlsConnect).toHaveBeenCalledTimes(1);
    const options = mockTlsConnect.mock.calls[0][0];
    expect(options).toMatchObject({
      host: 'scanner.internal.test',
      port: 13310,
      servername: 'scanner.internal.test',
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    });
    expect(Buffer.isBuffer(options.ca)).toBe(true);
    expect(Buffer.isBuffer(options.cert)).toBe(true);
    expect(Buffer.isBuffer(options.key)).toBe(true);
    expect(socket.writes[0].toString('utf8')).toBe('zINSTREAM\0');
  });

  test('health ping uses the same mutually authenticated transport', async () => {
    await expect(pingClamAv(250)).resolves.toBe(true);
    expect(mockTlsConnect).toHaveBeenCalledTimes(1);
    expect(socket.writes[0].toString('utf8')).toBe('zPING\0');
  });

  test('production plain TCP refuses a remote scanner endpoint', async () => {
    process.env.CLAMAV_MODE = 'tcp';
    process.env.CLAMAV_HOST = 'scanner.internal.test';

    const result = await scanBufferWithClamAv(Buffer.from('synthetic content'));

    expect(result).toMatchObject({ clean: false, unavailable: true, rawStatus: 'UNAVAILABLE' });
    expect(mockTlsConnect).not.toHaveBeenCalled();
  });

  test('invalid TLS material fails closed and is never included in the result', async () => {
    process.env.CLAMAV_TLS_CLIENT_KEY_B64 = 'synthetic-plaintext-secret-marker';

    const result = await scanBufferWithClamAv(Buffer.from('synthetic content'));

    expect(result).toMatchObject({ clean: false, unavailable: true, rawStatus: 'UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('synthetic-plaintext-secret-marker');
    expect(mockTlsConnect).not.toHaveBeenCalled();
  });
});
