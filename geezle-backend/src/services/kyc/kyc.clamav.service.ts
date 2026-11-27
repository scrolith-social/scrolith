/**
 * ClamAV client — talks to an isolated clamd process/service over TCP.
 * GPLv2 ClamAV is NOT linked into this application binary.
 */
import net from 'net';
import tls from 'tls';
import {
  KYC_CLAMAV_RETRIES,
  KYC_CLAMAV_TIMEOUT_MS
} from './kyc.constants';

export type ClamAvScanResult = {
  clean: boolean;
  infected: boolean;
  unavailable: boolean;
  signature?: string | null;
  engine: string;
  definitionVersion?: string | null;
  rawStatus: 'CLEAN' | 'INFECTED' | 'UNAVAILABLE' | 'ERROR';
};

const trim = (value: unknown) => String(value || '').trim();
const isFailOpenFlagSet = () =>
  trim(process.env.KYC_CLAMAV_FAIL_OPEN || process.env.CLAMAV_FAIL_OPEN).toLowerCase() === 'true';

const resolveMode = () => {
  const mode = trim(process.env.CLAMAV_MODE || process.env.KYC_CLAMAV_MODE).toLowerCase();

  // Production accepts only an explicitly configured TCP scanner. Test modes,
  // disabled mode, and fail-open/deferred modes must never make production
  // uploads appear clean when the scanner is unavailable.
  if (process.env.NODE_ENV === 'production') {
    if (isFailOpenFlagSet()) return 'disabled';
    if (mode === 'tcp_tls') return 'tcp_tls';
    // Plain clamd TCP is permitted only for a same-replica loopback sidecar.
    // Remote scanners must use the mutually authenticated TLS bridge.
    if (mode === 'tcp' && ['127.0.0.1', '::1', 'localhost'].includes(resolveHost())) return 'tcp';
    return 'disabled';
  }

  // mock_clean / mock_infected are reserved for isolated tests.
  if (
    mode === 'mock_clean' ||
    mode === 'mock_infected' ||
    mode === 'disabled' ||
    mode === 'tcp_tls' ||
    mode === 'fail_open' ||
    mode === 'defer'
  ) {
    return mode;
  }
  // Local non-production opt-in retained for existing development workflows.
  if (isFailOpenFlagSet()) {
    return 'fail_open';
  }
  return 'tcp';
};

const resolveHost = () => trim(process.env.CLAMAV_HOST || process.env.KYC_CLAMAV_HOST) || '127.0.0.1';
const resolvePort = () => {
  const port = Number(process.env.CLAMAV_PORT || process.env.KYC_CLAMAV_PORT || 3310);
  return Number.isFinite(port) && port > 0 ? port : 3310;
};

const decodeTlsMaterial = (name: string): Buffer => {
  const value = trim(process.env[name]);
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('scanner TLS configuration is unavailable');
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.toString('base64') !== value) {
    throw new Error('scanner TLS configuration is unavailable');
  }
  return decoded;
};

const createScannerSocket = (mode: string, host: string, port: number): net.Socket | tls.TLSSocket => {
  if (mode !== 'tcp_tls') return new net.Socket();
  const servername = trim(process.env.CLAMAV_TLS_SERVER_NAME) || host;
  if (!servername || net.isIP(servername)) throw new Error('scanner TLS server name is invalid');
  return tls.connect({
    host,
    port,
    ca: decodeTlsMaterial('CLAMAV_TLS_CA_B64'),
    cert: decodeTlsMaterial('CLAMAV_TLS_CLIENT_CERT_B64'),
    key: decodeTlsMaterial('CLAMAV_TLS_CLIENT_KEY_B64'),
    servername,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  });
};

const connectScannerSocket = (
  socket: net.Socket | tls.TLSSocket,
  mode: string,
  host: string,
  port: number,
  onConnected: () => void
) => {
  if (mode === 'tcp_tls') socket.once('secureConnect', onConnected);
  else socket.connect(port, host, onConnected);
};

const unavailableResult = (rawStatus: 'UNAVAILABLE' | 'ERROR' = 'UNAVAILABLE'): ClamAvScanResult => ({
  clean: false,
  infected: false,
  unavailable: true,
  engine: 'clamav',
  rawStatus,
  signature: null
});

/** Lightweight health check for orchestration. It never marks a missing scanner healthy. */
export const pingClamAv = (timeoutMs = 1000): Promise<boolean> =>
  new Promise((resolve) => {
    const mode = resolveMode();
    if (mode !== 'tcp' && mode !== 'tcp_tls') {
      resolve(false);
      return;
    }

    const host = resolveHost();
    const port = resolvePort();
    let socket: net.Socket | tls.TLSSocket;
    try {
      socket = createScannerSocket(mode, host, port);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    let response = '';
    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(healthy);
    };

    socket.setTimeout(Math.max(1, timeoutMs));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('\0')) {
        finish(response.replace(/\0/g, '').trim() === 'PONG');
      } else if (response.length > 32) {
        finish(false);
      }
    });
    socket.on('end', () => finish(response.replace(/\0/g, '').trim() === 'PONG'));
    connectScannerSocket(socket, mode, host, port, () => socket.write('zPING\0'));
  });

const scanViaInstream = (buffer: Buffer, host: string, port: number, timeoutMs: number): Promise<ClamAvScanResult> =>
  new Promise((resolve) => {
    let settled = false;
    let response = '';

    const finish = (result: ClamAvScanResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    let socket: net.Socket | tls.TLSSocket;
    const mode = resolveMode();
    try {
      socket = createScannerSocket(mode, host, port);
    } catch {
      finish(unavailableResult());
      return;
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      finish({
        clean: false,
        infected: false,
        unavailable: true,
        engine: 'clamav',
        rawStatus: 'UNAVAILABLE',
        signature: null
      });
    });

    socket.on('error', () => {
      finish({
        clean: false,
        infected: false,
        unavailable: true,
        engine: 'clamav',
        rawStatus: 'UNAVAILABLE',
        signature: null
      });
    });

    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
    });

    socket.on('end', () => {
      const normalized = response.replace(/\0/g, '').trim();
      if (/OK$/i.test(normalized) || /: OK/i.test(normalized)) {
        finish({
          clean: true,
          infected: false,
          unavailable: false,
          engine: 'clamav',
          rawStatus: 'CLEAN',
          signature: null
        });
        return;
      }
      const infectedMatch = normalized.match(/FOUND/i);
      if (infectedMatch) {
        const signature = normalized.replace(/.*:\s*/, '').replace(/\s*FOUND.*/i, '').trim() || 'UNKNOWN';
        finish({
          clean: false,
          infected: true,
          unavailable: false,
          engine: 'clamav',
          rawStatus: 'INFECTED',
          // Do not log full signature strings with path data; keep short code only.
          signature: signature.slice(0, 80)
        });
        return;
      }
      finish(unavailableResult('ERROR'));
    });

    connectScannerSocket(socket, mode, host, port, () => {
      // clamd INSTREAM protocol
      socket.write('zINSTREAM\0');
      const chunkSize = 2048;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const slice = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    });
  });

/**
 * Scan buffer with ClamAV. Fail-closed: unavailable/error => not clean.
 * Never logs file content.
 */
export const scanBufferWithClamAv = async (buffer: Buffer): Promise<ClamAvScanResult> => {
  const mode = resolveMode();
  if (mode === 'mock_clean') {
    return {
      clean: true,
      infected: false,
      unavailable: false,
      engine: 'clamav-mock',
      definitionVersion: 'mock-1',
      rawStatus: 'CLEAN'
    };
  }
  if (mode === 'mock_infected') {
    return {
      clean: false,
      infected: true,
      unavailable: false,
      engine: 'clamav-mock',
      definitionVersion: 'mock-1',
      signature: 'Eicar-Test-Signature',
      rawStatus: 'INFECTED'
    };
  }
  if (mode === 'disabled') {
    // Fail closed — never mark clean when scanner is disabled.
    return {
      clean: false,
      infected: false,
      unavailable: true,
      engine: 'clamav',
      rawStatus: 'UNAVAILABLE'
    };
  }

  const host = resolveHost();
  const port = resolvePort();
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || KYC_CLAMAV_TIMEOUT_MS);
  const retries = Math.max(0, Number(process.env.CLAMAV_RETRIES || KYC_CLAMAV_RETRIES));

  let last: ClamAvScanResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await scanViaInstream(buffer, host, port, timeoutMs);
    if (last.clean || last.infected) return last;
  }
  return (
    last || {
      clean: false,
      infected: false,
      unavailable: true,
      engine: 'clamav',
      rawStatus: 'UNAVAILABLE'
    }
  );
};

export const getClamAvConfigSnapshot = () => ({
  mode: resolveMode(),
  host: resolveHost(),
  port: resolvePort(),
  timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS || KYC_CLAMAV_TIMEOUT_MS),
  mutualTls: resolveMode() === 'tcp_tls'
});
