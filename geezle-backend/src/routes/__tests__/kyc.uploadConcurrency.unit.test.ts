jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => next())
}));

jest.mock('../../controllers/kyc.controller', () => {
  const handler = () => jest.fn((_req: unknown, _res: unknown, _next?: () => void) => undefined);
  return {
    getKycStatus: handler(),
    submitKyc: handler(),
    updateKyc: handler(),
    uploadKycDocument: handler(),
    uploadKycSecureDocument: handler(),
    getKycDocumentTypes: handler(),
    getKycFormConfig: handler(),
    kycUploadMulterMiddleware: handler(),
    kycUploadRateLimiter: handler(),
    kycSubmitRateLimiter: handler()
  };
});

import { EventEmitter } from 'events';
import {
  kycUploadMulterMiddleware,
  kycUploadRateLimiter
} from '../../controllers/kyc.controller';
import router from '../kyc.routes';

const makeResponse = () => {
  const response: any = new EventEmitter();
  response.headers = {} as Record<string, string>;
  response.setHeader = jest.fn((name: string, value: string) => { response.headers[name] = value; });
  response.status = jest.fn((status: number) => { response.statusCode = status; return response; });
  response.json = jest.fn((body: unknown) => { response.body = body; return response; });
  return response;
};

describe('KYC upload per-replica concurrency guard', () => {
  const uploadRoute: any = (router as any).stack.find((layer: any) => layer.route?.path === '/uploads');

  it('rejects excess uploads before multer can buffer their bodies', () => {
    expect(uploadRoute).toBeDefined();
    const handlers = uploadRoute.route.stack.map((layer: any) => layer.handle);
    const rateLimitIndex = handlers.indexOf(kycUploadRateLimiter);
    const multerIndex = handlers.indexOf(kycUploadMulterMiddleware);
    expect(rateLimitIndex).toBeGreaterThanOrEqual(0);
    expect(multerIndex).toBeGreaterThan(rateLimitIndex);

    const concurrencyLimiter = handlers[rateLimitIndex + 1];
    expect(concurrencyLimiter).toBeDefined();
    expect(handlers.indexOf(concurrencyLimiter)).toBeLessThan(multerIndex);

    const nextFirst = jest.fn();
    const nextSecond = jest.fn();
    const nextExcess = jest.fn();
    const responseFirst = makeResponse();
    const responseSecond = makeResponse();
    const responseExcess = makeResponse();

    concurrencyLimiter({} as any, responseFirst, nextFirst);
    concurrencyLimiter({} as any, responseSecond, nextSecond);
    concurrencyLimiter({} as any, responseExcess, nextExcess);

    expect(nextFirst).toHaveBeenCalledTimes(1);
    expect(nextSecond).toHaveBeenCalledTimes(1);
    expect(nextExcess).not.toHaveBeenCalled();
    expect(responseExcess.status).toHaveBeenCalledWith(503);
    expect(responseExcess.headers['Retry-After']).toBe('5');
    expect(responseExcess.body).toMatchObject({ success: false });

    responseFirst.emit('finish');
    responseSecond.emit('finish');
    const nextAfterRelease = jest.fn();
    concurrencyLimiter({} as any, makeResponse(), nextAfterRelease);
    expect(nextAfterRelease).toHaveBeenCalledTimes(1);
  });
});
