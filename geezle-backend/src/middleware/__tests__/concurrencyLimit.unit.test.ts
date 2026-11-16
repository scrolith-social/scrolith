import { EventEmitter } from 'events';
import { createConcurrencyLimit } from '../concurrencyLimit';

const makeResponse = () => {
  const response: any = new EventEmitter();
  response.headers = {} as Record<string, string>;
  response.setHeader = jest.fn((name: string, value: string) => { response.headers[name] = value; });
  response.status = jest.fn((status: number) => { response.statusCode = status; return response; });
  response.json = jest.fn((body: unknown) => { response.body = body; return response; });
  return response;
};

describe('upload concurrency limit', () => {
  it('rejects excess Azure uploads and releases capacity exactly once', () => {
    const gate = createConcurrencyLimit({ max: 2, shouldLimit: () => true, message: 'busy' });
    const nextA = jest.fn();
    const nextB = jest.fn();
    const responseA = makeResponse();
    const responseB = makeResponse();
    gate({} as any, responseA, nextA);
    gate({} as any, responseB, nextB);

    const responseC = makeResponse();
    const nextC = jest.fn();
    gate({} as any, responseC, nextC);
    expect(nextA).toHaveBeenCalledTimes(1);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(nextC).not.toHaveBeenCalled();
    expect(responseC.status).toHaveBeenCalledWith(503);
    expect(responseC.headers['Retry-After']).toBe('5');

    responseA.emit('finish');
    responseA.emit('close');
    gate({} as any, responseC, nextC);
    expect(nextC).toHaveBeenCalledTimes(1);
  });

  it('does not limit non-Azure requests', () => {
    const gate = createConcurrencyLimit({ max: 1, shouldLimit: () => false, message: 'busy' });
    const next = jest.fn();
    gate({} as any, makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
