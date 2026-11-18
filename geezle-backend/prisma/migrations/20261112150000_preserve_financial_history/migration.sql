-- Preserve payment, wallet, Gcoin, withdrawal, FX-lock, and founding-partner
-- evidence when a related parent is deleted. Account removal is a soft
-- deactivation in the application; hard deletes are not a supported flow.
-- This migration changes only referential actions and does not rewrite rows.

BEGIN;

ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_walletId_fkey";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_orderId_fkey";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletFundingIntent" DROP CONSTRAINT "WalletFundingIntent_userId_fkey";
ALTER TABLE "WalletFundingIntent" ADD CONSTRAINT "WalletFundingIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletFundingIntent" DROP CONSTRAINT "WalletFundingIntent_walletId_fkey";
ALTER TABLE "WalletFundingIntent" ADD CONSTRAINT "WalletFundingIntent_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletFundingIntent" DROP CONSTRAINT "WalletFundingIntent_fxLockId_fkey";
ALTER TABLE "WalletFundingIntent" ADD CONSTRAINT "WalletFundingIntent_fxLockId_fkey"
  FOREIGN KEY ("fxLockId") REFERENCES "FxLock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlement" DROP CONSTRAINT "PaymentSettlement_intentId_fkey";
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "WalletFundingIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderPaymentIntent" DROP CONSTRAINT "OrderPaymentIntent_orderId_fkey";
ALTER TABLE "OrderPaymentIntent" ADD CONSTRAINT "OrderPaymentIntent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentIntent" DROP CONSTRAINT "OrderPaymentIntent_fxLockId_fkey";
ALTER TABLE "OrderPaymentIntent" ADD CONSTRAINT "OrderPaymentIntent_fxLockId_fkey"
  FOREIGN KEY ("fxLockId") REFERENCES "FxLock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentSettlement" DROP CONSTRAINT "OrderPaymentSettlement_intentId_fkey";
ALTER TABLE "OrderPaymentSettlement" ADD CONSTRAINT "OrderPaymentSettlement_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "OrderPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GcoinWallet" DROP CONSTRAINT "GcoinWallet_userId_fkey";
ALTER TABLE "GcoinWallet" ADD CONSTRAINT "GcoinWallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GcoinTransaction" DROP CONSTRAINT "gcoin_transaction_user_fkey";
ALTER TABLE "GcoinTransaction" ADD CONSTRAINT "gcoin_transaction_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GcoinTransaction" DROP CONSTRAINT "gcoin_transaction_wallet_fkey";
ALTER TABLE "GcoinTransaction" ADD CONSTRAINT "gcoin_transaction_wallet_fkey"
  FOREIGN KEY ("walletId") REFERENCES "GcoinWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GcoinConversionRequest" DROP CONSTRAINT "gcoin_conversion_user_fkey";
ALTER TABLE "GcoinConversionRequest" ADD CONSTRAINT "gcoin_conversion_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GcoinConversionRequest" DROP CONSTRAINT "gcoin_conversion_wallet_fkey";
ALTER TABLE "GcoinConversionRequest" ADD CONSTRAINT "gcoin_conversion_wallet_fkey"
  FOREIGN KEY ("walletId") REFERENCES "GcoinWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WithdrawalRequest" DROP CONSTRAINT "WithdrawalRequest_fxLockId_fkey";
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_fxLockId_fkey"
  FOREIGN KEY ("fxLockId") REFERENCES "FxLock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoundingPartner" DROP CONSTRAINT "FoundingPartner_userId_fkey";
ALTER TABLE "FoundingPartner" ADD CONSTRAINT "FoundingPartner_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoundingPartnerEnrollmentPayment" DROP CONSTRAINT "FoundingPartnerEnrollmentPayment_userId_fkey";
ALTER TABLE "FoundingPartnerEnrollmentPayment" ADD CONSTRAINT "FoundingPartnerEnrollmentPayment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoundingPartnerEnrollmentPayment" DROP CONSTRAINT "FoundingPartnerEnrollmentPayment_partnerId_fkey";
ALTER TABLE "FoundingPartnerEnrollmentPayment" ADD CONSTRAINT "FoundingPartnerEnrollmentPayment_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "FoundingPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoundingPartnerProfitSource" DROP CONSTRAINT "FoundingPartnerProfitSource_periodId_fkey";
ALTER TABLE "FoundingPartnerProfitSource" ADD CONSTRAINT "FoundingPartnerProfitSource_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "FoundingPartnerProfitPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoundingPartnerAuditLog" DROP CONSTRAINT "FoundingPartnerAuditLog_programId_fkey";
ALTER TABLE "FoundingPartnerAuditLog" ADD CONSTRAINT "FoundingPartnerAuditLog_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "FoundingPartnerProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
