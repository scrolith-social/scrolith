jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: { communityPost: { findUnique: jest.fn() } }
}));

import prisma from '../../utils/prismaClient';
import { processThresholds } from '../community.controller';

describe('community Gcoin threshold rewards while money movement is disabled', () => {
  const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;

  afterAll(() => {
    if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
  });

  test('skips reward-side reads and writes without blocking the caller’s community action', async () => {
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    const findPost = (prisma as any).communityPost.findUnique as jest.Mock;
    findPost.mockClear();

    await expect(processThresholds('synthetic-post', null)).resolves.toBeUndefined();
    expect(findPost).not.toHaveBeenCalled();
  });
});
