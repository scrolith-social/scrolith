import type { Request, Response } from 'express';
import prisma from '../../utils/prismaClient';
import { getI18nConfigPublic } from '../i18n.controller';

jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    languageConfig: {
      findUnique: jest.fn(),
      create: jest.fn()
    }
  }
}));

const findUnique = prisma.languageConfig.findUnique as jest.Mock;
const create = prisma.languageConfig.create as jest.Mock;

const makeResponse = () => {
  const response: any = {
    setHeader: jest.fn(),
    json: jest.fn((payload) => payload),
    status: jest.fn(function (this: any) {
      return this;
    })
  };
  return response as Response;
};

describe('public i18n config singleton initialization', () => {
  const config = {
    scope: 'default',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    rtlLocales: ['ar', 'he', 'fa', 'ur'],
    dictionaryCacheSeconds: 60,
    overridesCacheSeconds: 60
  };
  let created = false;

  beforeEach(() => {
    created = false;
    findUnique.mockReset();
    create.mockReset();
    findUnique.mockImplementation(async () => (created ? config : null));
    create.mockImplementation(async (input) => {
      if (created) {
        const conflict: any = new Error('unique scope conflict');
        conflict.code = 'P2002';
        throw conflict;
      }
      created = true;
      return { ...config, ...input.data };
    });
  });

  it('recovers concurrent first reads using the unique scope constraint and a re-read', async () => {
    const responses = Array.from({ length: 8 }, makeResponse);

    await Promise.all(
      responses.map((response) => getI18nConfigPublic({} as Request, response))
    );

    expect(findUnique).toHaveBeenCalledWith({ where: { scope: 'default' } });
    expect(create).toHaveBeenCalledTimes(responses.length);
    expect(create).toHaveBeenCalledWith({
      data: {
        scope: 'default',
        defaultLocale: 'en',
        enabledLocales: ['en'],
        rtlLocales: ['ar', 'he', 'fa', 'ur']
      }
    });
    expect(created).toBe(true);
    responses.forEach((response) => {
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'i18n config loaded' })
      );
    });
  });
});
