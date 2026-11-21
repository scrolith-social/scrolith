jest.mock('../../utils/prismaClient', () => ({
  __esModule: true,
  default: {
    order: { count: jest.fn() },
    gig: { delete: jest.fn(), update: jest.fn() }
  }
}));

import prisma from '../../utils/prismaClient';
import { removeGigPreservingOrderHistory } from '../gigDeletion.service';

const prismaMock = prisma as unknown as {
  order: { count: jest.Mock };
  gig: { delete: jest.Mock; update: jest.Mock };
};

describe('removeGigPreservingOrderHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hard-deletes a gig that has no order history', async () => {
    prismaMock.order.count.mockResolvedValue(0);
    prismaMock.gig.delete.mockResolvedValue({ id: 'gig-1' });

    await expect(removeGigPreservingOrderHistory('gig-1')).resolves.toEqual({ retainedForOrderHistory: false });
    expect(prismaMock.gig.delete).toHaveBeenCalledWith({ where: { id: 'gig-1' } });
    expect(prismaMock.gig.update).not.toHaveBeenCalled();
  });

  test('deactivates a gig with existing orders without mutating order history', async () => {
    prismaMock.order.count.mockResolvedValue(2);
    prismaMock.gig.update.mockResolvedValue({ id: 'gig-1', isActive: false, status: 'PAUSED' });

    await expect(removeGigPreservingOrderHistory('gig-1')).resolves.toEqual({ retainedForOrderHistory: true });
    expect(prismaMock.gig.update).toHaveBeenCalledWith({
      where: { id: 'gig-1' },
      data: { isActive: false, status: 'PAUSED' }
    });
    expect(prismaMock.gig.delete).not.toHaveBeenCalled();
  });

  test('deactivates when a concurrent order causes the restrictive delete to fail', async () => {
    prismaMock.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prismaMock.gig.delete.mockRejectedValue({ code: 'P2003' });
    prismaMock.gig.update.mockResolvedValue({ id: 'gig-1', isActive: false, status: 'PAUSED' });

    await expect(removeGigPreservingOrderHistory('gig-1')).resolves.toEqual({ retainedForOrderHistory: true });
    expect(prismaMock.order.count).toHaveBeenCalledTimes(2);
    expect(prismaMock.gig.update).toHaveBeenCalledWith({
      where: { id: 'gig-1' },
      data: { isActive: false, status: 'PAUSED' }
    });
  });

  test('does not hide an unrelated foreign-key failure', async () => {
    const failure = { code: 'P2003' };
    prismaMock.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prismaMock.gig.delete.mockRejectedValue(failure);

    await expect(removeGigPreservingOrderHistory('gig-1')).rejects.toBe(failure);
    expect(prismaMock.gig.update).not.toHaveBeenCalled();
  });

  test('propagates non-foreign-key delete failures without changing the gig', async () => {
    const failure = new Error('database unavailable');
    prismaMock.order.count.mockResolvedValue(0);
    prismaMock.gig.delete.mockRejectedValue(failure);

    await expect(removeGigPreservingOrderHistory('gig-1')).rejects.toBe(failure);
    expect(prismaMock.gig.update).not.toHaveBeenCalled();
  });
});
