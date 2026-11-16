jest.mock('../../utils/prismaClient', () => ({ __esModule: true, default: {} }));

import { creditWallet } from '../../services/walletLedger.service';
import { GcoinService } from '../../services/gcoinService';
import { settleOrderPaymentIntent } from '../../services/orderPayments';
import { purchaseUserPlanWithWallet } from '../../services/planPurchase.service';
import { claimRewardDrop } from '../../modules/insights/services/engagementPhase.service';

describe('money movement service boundary', () => {
  const original = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;

  beforeEach(() => {
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'false';
  });

  afterAll(() => {
    if (original === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = original;
  });

  test('wallet, Gcoin, order settlement, and plan-purchase service calls reject before I/O', async () => {
    const tx = {
      wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      transaction: { findFirst: jest.fn(), create: jest.fn() }
    };

    await expect(creditWallet(tx, {
      userId: 'synthetic-user', amount: 5, currency: 'USD', referenceId: 'synthetic-ref', description: 'test'
    })).rejects.toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED', status: 503 });
    await expect(new GcoinService().transfer('synthetic-user', { toRecipientId: 'synthetic-recipient', amount: 1 }))
      .rejects.toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED', status: 503 });
    await expect(settleOrderPaymentIntent({
      provider: 'synthetic', providerReferenceId: 'synthetic-ref', status: 'succeeded', rawEvent: {}
    })).rejects.toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED', status: 503 });
    await expect(purchaseUserPlanWithWallet({ userId: 'synthetic-user', planId: 'synthetic-plan' }))
      .rejects.toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED', status: 503 });
    await expect(claimRewardDrop({ userId: 'synthetic-user', dropId: 'synthetic-drop' }))
      .rejects.toMatchObject({ code: 'MONEY_MOVEMENT_DISABLED', status: 503 });

    expect(tx.wallet.findUnique).not.toHaveBeenCalled();
    expect(tx.wallet.create).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
