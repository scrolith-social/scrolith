import { reconcileAdPayments as importedReconcileAdPayments } from '../services/adPaymentReconciliation.service';
import { disconnectPrisma } from '../utils/prismaClient';
import { assertMoneyMovementEnabled } from '../config/moneyMovement';

let disconnectPromise: Promise<void> | undefined;

export const reconcileAdPayments = async () => {
  assertMoneyMovementEnabled();
  return importedReconcileAdPayments();
};

export const closeReconciliationResources = async () => {
  if (!disconnectPromise) {
    disconnectPromise = disconnectPrisma();
  }
  return disconnectPromise;
};
