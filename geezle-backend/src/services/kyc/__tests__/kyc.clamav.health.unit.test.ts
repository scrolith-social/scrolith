jest.mock('../kyc.clamav.service', () => ({
  pingClamAv: jest.fn()
}));

import { pingClamAv } from '../kyc.clamav.service';
import { clamAvHealthHandler } from '../kyc.clamav.health';

describe('KYC ClamAV health endpoint handler', () => {
  const response = () => {
    const res: any = {};
    res.headers = {} as Record<string, string>;
    res.setHeader = jest.fn((name: string, value: string) => { res.headers[name] = value; });
    res.status = jest.fn((status: number) => { res.statusCode = status; return res; });
    res.json = jest.fn((body: unknown) => { res.body = body; return res; });
    return res;
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns only a status when the private TCP scanner answers', async () => {
    (pingClamAv as jest.Mock).mockResolvedValue(true);
    const res = response();
    await clamAvHealthHandler({} as any, res, jest.fn());

    expect(pingClamAv).toHaveBeenCalledWith(1000);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ status: 'READY' });
  });

  it('returns not-ready without scanner details when clamd is unavailable', async () => {
    (pingClamAv as jest.Mock).mockResolvedValue(false);
    const res = response();
    await clamAvHealthHandler({} as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({ status: 'NOT_READY' });
  });
});
