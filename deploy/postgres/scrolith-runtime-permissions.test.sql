-- Disposable-database capability test for the runtime/migrator policy.
-- Invoke only through psql on the task-owned PostgreSQL 17 test instance with
-- -v SCROLITH_ROLE_SETUP_APPROVED=true -v database_name=<exact test db>.
-- All fixtures and attempted mutations are rolled back at the end.

\set ON_ERROR_STOP on
\set _scrolith_guard_failed true
\if :{?SCROLITH_ROLE_SETUP_APPROVED}
  \if :SCROLITH_ROLE_SETUP_APPROVED
    \set _scrolith_guard_failed false
  \else
    \echo 'STOP: explicit disposable-database approval is required.'
  \endif
\else
  \echo 'STOP: explicit disposable-database approval is required.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'explicit disposable-database approval is required'; END $psql_guard_failure$;
\endif
\set _scrolith_guard_failed true
\if :{?database_name}
  \set _scrolith_guard_failed false
\else
  \echo 'STOP: pass -v database_name=<disposable database name>.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'database_name is required'; END $psql_guard_failure$;
\endif
SELECT CASE WHEN current_database() = :'database_name'
                  AND current_database() ~* '(test|e2e)'
                  AND current_user <> 'scrolith_runtime'
            THEN 1 ELSE 0 END AS target_is_safe \gset
\if :target_is_safe
  \set _scrolith_guard_failed false
\else
  \set _scrolith_guard_failed true
\echo 'STOP: test is not connected to the declared disposable database.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'permission test requires the named disposable database'; END $psql_guard_failure$;
\endif
DO $assert_enabled_after_finalization$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scrolith_runtime_policy_state WHERE singleton AND finalized)
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime') THEN
    RAISE EXCEPTION 'runtime must be enabled only after a successful finalization marker';
  END IF;
END
$assert_enabled_after_finalization$;

BEGIN;
SET LOCAL ROLE scrolith_migrator;

INSERT INTO "User" ("id", "email", "updatedAt") VALUES
  ('role-review-user-a', 'role-review-a@example.test', now()),
  ('role-review-user-b', 'role-review-b@example.test', now()),
  ('role-review-user-gcoin-only', 'role-review-gcoin-only@example.test', now());
INSERT INTO "AuthSession" ("id", "userId", "tokenIdHash", "expiresAt", "createdAt") VALUES
  ('role-review-auth-session-active', 'role-review-user-a', 'synthetic-auth-session-active-hash',
   now() + interval '7 days', now()),
  ('role-review-auth-session-expired', 'role-review-user-a', 'synthetic-auth-session-expired-hash',
   now() - interval '2 days', now() - interval '2 days');
INSERT INTO "OAuthExchangeCode" (
  "id", "userId", "codeHash", "authSessionVersion", "expiresAt", "createdAt"
) VALUES
  ('role-review-oauth-code-active', 'role-review-user-a', 'synthetic-oauth-code-active-hash',
   0, now() + interval '1 day', now()),
  ('role-review-oauth-code-expired', 'role-review-user-a', 'synthetic-oauth-code-expired-hash',
   0, now() - interval '2 days', now() - interval '2 days');
INSERT INTO "Wallet" ("id", "userId", "updatedAt") VALUES
  ('role-review-wallet-a', 'role-review-user-a', now());
INSERT INTO "Order" ("id", "clientId", "freelancerId", "amount", "updatedAt")
VALUES ('role-review-order-a', 'role-review-user-a', 'role-review-user-b', 25, now());
INSERT INTO "Escrow" ("id", "orderId", "clientId", "freelancerId", "amount", "updatedAt")
VALUES ('role-review-escrow-a', 'role-review-order-a', 'role-review-user-a', 'role-review-user-b', 25, now());
INSERT INTO "FxLock" (
  "id", "entityType", "entityId", "fromCurrency", "toCurrency",
  "sourceAmount", "convertedAmount", "rate", "baseCurrency", "updatedAt"
) VALUES
  ('role-review-fx-wallet', 'wallet-funding', 'role-review-funding', 'USD', 'USD', 10, 10, 1, 'USD', now()),
  ('role-review-fx-order', 'order-payment', 'role-review-order-intent', 'USD', 'USD', 25, 25, 1, 'USD', now()),
  ('role-review-fx-withdrawal', 'withdrawal', 'role-review-withdrawal', 'USD', 'USD', 5, 5, 1, 'USD', now());
INSERT INTO "WalletFundingIntent" (
  "id", "userId", "walletId", "fxLockId", "provider", "amount", "currency", "status", "updatedAt"
) VALUES ('role-review-funding', 'role-review-user-a', 'role-review-wallet-a',
          'role-review-fx-wallet', 'synthetic', 10, 'USD', 'PENDING', now());
INSERT INTO "PaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-funding-settlement', 'synthetic', 'funding-ref-1', 'role-review-funding');
INSERT INTO "OrderPaymentIntent" (
  "id", "orderId", "clientId", "fxLockId", "provider", "amount", "currency", "status", "updatedAt"
) VALUES ('role-review-order-intent', 'role-review-order-a', 'role-review-user-a',
          'role-review-fx-order', 'synthetic', 25, 'USD', 'PENDING', now());
INSERT INTO "OrderPaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-order-settlement', 'synthetic', 'order-ref-1', 'role-review-order-intent');
INSERT INTO "GcoinWallet" ("id", "userId", "recipientId", "updatedAt")
VALUES ('role-review-gcoin-wallet', 'role-review-user-a', 'ROLE-REVIEW-GC', now());
INSERT INTO "GcoinTransaction" ("id", "userId", "walletId", "amount", "type")
VALUES ('role-review-gcoin-transaction', 'role-review-user-a', 'role-review-gcoin-wallet', 2, 'EARN');
INSERT INTO "GcoinConversionRequest" ("id", "userId", "walletId", "amountGcoin", "amountFiat")
VALUES ('role-review-gcoin-conversion', 'role-review-user-a', 'role-review-gcoin-wallet', 1, 1);
INSERT INTO "GcoinWallet" ("id", "userId", "recipientId", "updatedAt")
VALUES ('role-review-gcoin-only-wallet', 'role-review-user-gcoin-only', 'ROLE-REVIEW-GC-ONLY', now());
INSERT INTO "GcoinTransaction" ("id", "userId", "walletId", "amount", "type")
VALUES ('role-review-gcoin-only-transaction', 'role-review-user-gcoin-only', 'role-review-gcoin-only-wallet', 3, 'EARN');
INSERT INTO "WithdrawalRequest" (
  "id", "userId", "fxLockId", "amount", "method", "details", "updatedAt"
) VALUES ('role-review-withdrawal', 'role-review-user-a', 'role-review-fx-withdrawal',
          5, 'bank', '{"synthetic":true}'::jsonb, now());
INSERT INTO "Transaction" (
  "id", "walletId", "userId", "orderId", "type", "amount", "status", "updatedAt"
) VALUES ('role-review-transaction', 'role-review-wallet-a', 'role-review-user-a',
          'role-review-order-a', 'DEPOSIT', 10, 'PENDING', now());
INSERT INTO "AppSetting" ("id", "scope", "data", "updatedAt") VALUES
  ('role-review-app-setting-existing', 'role_review_existing', '{"enabled":false}'::jsonb, now());
INSERT INTO "HumanVerificationSettings" ("id", "scope", "data", "updatedBy", "updatedAt") VALUES
  ('role-review-hv-setting-existing', 'role_review_hv_existing',
   '{"masterEnabled":false,"endpoints":{"signup":false}}'::jsonb, NULL, now());

SET LOCAL ROLE scrolith_runtime;

-- Durable auth-session operations: issue, revoke, and retention cleanup.
INSERT INTO "AuthSession" ("id", "userId", "tokenIdHash", "expiresAt", "createdAt")
VALUES ('role-review-auth-session-runtime-created', 'role-review-user-b',
        'synthetic-auth-session-runtime-hash', now() + interval '7 days', now());
UPDATE "AuthSession"
   SET "revokedAt" = now(), "revokeReason" = 'synthetic logout'
 WHERE "id" = 'role-review-auth-session-active';
DELETE FROM "AuthSession"
 WHERE "id" = 'role-review-auth-session-expired'
   AND "expiresAt" < now() - interval '1 day';
INSERT INTO "OAuthExchangeCode" (
  "id", "userId", "codeHash", "authSessionVersion", "expiresAt", "createdAt"
) VALUES ('role-review-oauth-code-runtime-created', 'role-review-user-b',
          'synthetic-oauth-code-runtime-hash', 0, now() + interval '1 day', now());
UPDATE "OAuthExchangeCode" SET "usedAt" = now()
 WHERE "id" = 'role-review-oauth-code-active';
DELETE FROM "OAuthExchangeCode"
 WHERE "id" = 'role-review-oauth-code-expired'
   AND "expiresAt" < now() - interval '1 day';

-- Supported app behavior: account deactivation is a soft UPDATE; wallet and
-- Gcoin snapshots, transaction status, payment intents and withdrawal fields
-- can be advanced; settlement receipts are INSERT-only and idempotent.
UPDATE "User" SET "isActive" = false WHERE "id" = 'role-review-user-a';
UPDATE "Wallet"
   SET "balance" = 10, "pendingClearance" = 0,
       "escrowBalance" = 0, "frozen" = false, "updatedAt" = now()
 WHERE "id" = 'role-review-wallet-a';
UPDATE "GcoinWallet"
   SET "balance" = 2, "lifetimeEarned" = 2, "status" = 'active',
       "fraudScore" = 0, "updatedAt" = now()
 WHERE "id" = 'role-review-gcoin-wallet';
UPDATE "WalletFundingIntent"
   SET "fxLockId" = 'role-review-fx-wallet', "status" = 'SUCCEEDED',
       "providerReferenceId" = 'provider-funding-1',
       "providerPayload" = '{"fixture":true}'::jsonb, "updatedAt" = now()
 WHERE "id" = 'role-review-funding';
UPDATE "OrderPaymentIntent"
   SET "fxLockId" = 'role-review-fx-order', "status" = 'SUCCEEDED',
       "providerReferenceId" = 'provider-order-1',
       "providerPayload" = '{"fixture":true}'::jsonb, "updatedAt" = now()
 WHERE "id" = 'role-review-order-intent';
UPDATE "WithdrawalRequest"
   SET "fxLockId" = 'role-review-fx-withdrawal',
       "details" = '{"synthetic":true,"reference":"masked-fixture"}'::jsonb,
       "status" = 'PROCESSING', "processedAt" = now(), "updatedAt" = now()
 WHERE "id" = 'role-review-withdrawal';
UPDATE "Transaction"
   SET "status" = 'COMPLETED', "description" = 'synthetic role test',
       "metadata" = '{"fixture":true}'::jsonb, "updatedAt" = now()
 WHERE "id" = 'role-review-transaction';
UPDATE "Order"
   SET "status" = 'PAID', "stripeIntentId" = 'synthetic-order-intent',
       "transactionId" = 'synthetic-transaction', "updatedAt" = now()
 WHERE "id" = 'role-review-order-a';
UPDATE "Escrow"
   SET "status" = 'FUNDED', "commission" = 2, "fundedAt" = now(), "updatedAt" = now()
 WHERE "id" = 'role-review-escrow-a';
UPDATE "GcoinConversionRequest"
   SET "status" = 'approved', "processedAt" = now(), "processedBy" = 'role-review-user-b'
 WHERE "id" = 'role-review-gcoin-conversion';

-- Existing configuration flows use Prisma upsert: insert a new scoped row or
-- update only the JSON payload/actor and Prisma-managed timestamp. Row identity
-- and scope remain immutable to the runtime role.
INSERT INTO "AppSetting" ("id", "scope", "data", "updatedAt") VALUES
  ('role-review-app-setting-new', 'role_review_new', '{"enabled":true}'::jsonb, now());
INSERT INTO "AppSetting" ("id", "scope", "data", "updatedAt") VALUES
  ('role-review-app-setting-conflict', 'role_review_existing', '{"enabled":true}'::jsonb, now())
ON CONFLICT ("scope") DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = now();
INSERT INTO "HumanVerificationSettings" ("id", "scope", "data", "updatedBy", "updatedAt") VALUES
  ('role-review-hv-setting-new', 'role_review_hv_new',
   '{"masterEnabled":true,"endpoints":{"signup":true}}'::jsonb, 'role-review-user-a', now());
INSERT INTO "HumanVerificationSettings" ("id", "scope", "data", "updatedBy", "updatedAt") VALUES
  ('role-review-hv-setting-conflict', 'role_review_hv_existing',
   '{"masterEnabled":true,"endpoints":{"signup":true}}'::jsonb, 'role-review-user-a', now())
ON CONFLICT ("scope") DO UPDATE
  SET "data" = EXCLUDED."data", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now();

-- Runtime is allowed to append payment, withdrawal and wallet-history rows.
INSERT INTO "WalletFundingIntent" (
  "id", "userId", "walletId", "provider", "amount", "currency", "status", "updatedAt"
) VALUES ('role-review-funding-created', 'role-review-user-a', 'role-review-wallet-a',
          'synthetic', 4, 'USD', 'PENDING', now());
INSERT INTO "PaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-funding-created-settlement', 'synthetic', 'funding-ref-created', 'role-review-funding-created');
INSERT INTO "OrderPaymentIntent" (
  "id", "orderId", "clientId", "provider", "amount", "currency", "status", "updatedAt"
) VALUES ('role-review-order-intent-created', 'role-review-order-a', 'role-review-user-a',
          'synthetic', 25, 'USD', 'PENDING', now());
INSERT INTO "OrderPaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-order-created-settlement', 'synthetic', 'order-ref-created', 'role-review-order-intent-created');
INSERT INTO "FxLock" (
  "id", "entityType", "entityId", "fromCurrency", "toCurrency",
  "sourceAmount", "convertedAmount", "rate", "baseCurrency", "updatedAt"
) VALUES ('role-review-fx-withdrawal-created', 'withdrawal', 'role-review-withdrawal-created',
          'USD', 'USD', 2, 2, 1, 'USD', now());
INSERT INTO "WithdrawalRequest" (
  "id", "userId", "fxLockId", "amount", "method", "details", "updatedAt"
) VALUES ('role-review-withdrawal-created', 'role-review-user-a', 'role-review-fx-withdrawal-created',
          2, 'bank', '{"synthetic":true}'::jsonb, now());
INSERT INTO "Transaction" (
  "id", "walletId", "userId", "type", "amount", "status", "updatedAt"
) VALUES ('role-review-transaction-created', 'role-review-wallet-a', 'role-review-user-a',
          'WITHDRAWAL', 2, 'PENDING', now());
INSERT INTO "GcoinWallet" ("id", "userId", "recipientId", "updatedAt")
VALUES ('role-review-gcoin-wallet-created', 'role-review-user-b', 'ROLE-REVIEW-GC-CREATED', now());

INSERT INTO "PaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-funding-settlement-duplicate', 'synthetic', 'funding-ref-1', 'role-review-funding')
ON CONFLICT ("provider", "providerReferenceId") DO NOTHING;
INSERT INTO "PaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-funding-created-duplicate', 'synthetic', 'funding-ref-created', 'role-review-funding-created')
ON CONFLICT ("provider", "providerReferenceId") DO NOTHING;
INSERT INTO "OrderPaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-order-settlement-duplicate', 'synthetic', 'order-ref-1', 'role-review-order-intent')
ON CONFLICT ("provider", "providerReferenceId") DO NOTHING;
INSERT INTO "OrderPaymentSettlement" ("id", "provider", "providerReferenceId", "intentId")
VALUES ('role-review-order-created-duplicate', 'synthetic', 'order-ref-created', 'role-review-order-intent-created')
ON CONFLICT ("provider", "providerReferenceId") DO NOTHING;
INSERT INTO "GcoinTransaction" ("id", "userId", "walletId", "amount", "type")
VALUES ('role-review-gcoin-transaction-2', 'role-review-user-a', 'role-review-gcoin-wallet', 1, 'EARN');

DO $assert_allowed_writes$
BEGIN
  IF (SELECT count(*) FROM "PaymentSettlement"
       WHERE "provider" = 'synthetic' AND "providerReferenceId" = 'funding-ref-1') <> 1
     OR (SELECT count(*) FROM "OrderPaymentSettlement"
       WHERE "provider" = 'synthetic' AND "providerReferenceId" = 'order-ref-1') <> 1
     OR (SELECT count(*) FROM "PaymentSettlement"
       WHERE "provider" = 'synthetic' AND "providerReferenceId" = 'funding-ref-created') <> 1
     OR (SELECT count(*) FROM "OrderPaymentSettlement"
       WHERE "provider" = 'synthetic' AND "providerReferenceId" = 'order-ref-created') <> 1
     OR (SELECT "isActive" FROM "User" WHERE "id" = 'role-review-user-a')
     OR (SELECT "status"::text FROM "Transaction" WHERE "id" = 'role-review-transaction') <> 'COMPLETED'
      OR (SELECT "details"->>'reference' FROM "WithdrawalRequest" WHERE "id" = 'role-review-withdrawal') <> 'masked-fixture'
      OR (SELECT "status"::text FROM "Order" WHERE "id" = 'role-review-order-a') <> 'PAID'
      OR (SELECT "status"::text FROM "Escrow" WHERE "id" = 'role-review-escrow-a') <> 'FUNDED'
      OR (SELECT "commission" FROM "Escrow" WHERE "id" = 'role-review-escrow-a') <> 2
      OR (SELECT "status" FROM "GcoinConversionRequest" WHERE "id" = 'role-review-gcoin-conversion') <> 'approved'
      OR (SELECT "data"->>'enabled' FROM "AppSetting" WHERE "scope" = 'role_review_existing') <> 'true'
      OR (SELECT "data"->>'masterEnabled' FROM "HumanVerificationSettings" WHERE "scope" = 'role_review_hv_existing') <> 'true'
      OR (SELECT "updatedBy" FROM "HumanVerificationSettings" WHERE "scope" = 'role_review_hv_existing') <> 'role-review-user-a'
      OR (SELECT "revokeReason" FROM "AuthSession" WHERE "id" = 'role-review-auth-session-active') <> 'synthetic logout'
      OR (SELECT count(*) FROM "AuthSession" WHERE "id" = 'role-review-auth-session-runtime-created') <> 1
      OR (SELECT count(*) FROM "AuthSession" WHERE "id" = 'role-review-auth-session-expired') <> 0
      OR (SELECT "usedAt" FROM "OAuthExchangeCode" WHERE "id" = 'role-review-oauth-code-active') IS NULL
      OR (SELECT count(*) FROM "OAuthExchangeCode" WHERE "id" = 'role-review-oauth-code-runtime-created') <> 1
      OR (SELECT count(*) FROM "OAuthExchangeCode" WHERE "id" = 'role-review-oauth-code-expired') <> 0 THEN
    RAISE EXCEPTION 'runtime supported writes or settlement idempotency did not match expectations';
  END IF;
END
$assert_allowed_writes$;

DO $assert_runtime_denials$
DECLARE
  denied BOOLEAN;
  protected_table TEXT;
BEGIN
  denied := false;
  BEGIN UPDATE "Order" SET "amount" = 26 WHERE "id" = 'role-review-order-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed the economic amount on Order'; END IF;
  denied := false;
  BEGIN UPDATE "Order" SET "clientId" = 'role-review-user-b' WHERE "id" = 'role-review-order-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Order ownership'; END IF;
  denied := false;
  BEGIN UPDATE "Escrow" SET "amount" = 26 WHERE "id" = 'role-review-escrow-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed the economic amount on Escrow'; END IF;
  denied := false;
  BEGIN UPDATE "Escrow" SET "orderId" = 'role-review-order-intent' WHERE "id" = 'role-review-escrow-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Escrow parent identity'; END IF;
  denied := false;
  BEGIN UPDATE "GcoinConversionRequest" SET "amountGcoin" = 2 WHERE "id" = 'role-review-gcoin-conversion';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Gcoin conversion amount'; END IF;
  denied := false;
  BEGIN UPDATE "GcoinConversionRequest" SET "userId" = 'role-review-user-b' WHERE "id" = 'role-review-gcoin-conversion';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Gcoin conversion ownership'; END IF;
  denied := false;
  BEGIN UPDATE "AppSetting" SET "scope" = 'role_review_scope_tamper' WHERE "id" = 'role-review-app-setting-existing';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AppSetting scope'; END IF;
  denied := false;
  BEGIN UPDATE "AppSetting" SET "id" = 'role-review-app-setting-id-tamper'
    WHERE "id" = 'role-review-app-setting-existing';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AppSetting identity'; END IF;
  denied := false;
  BEGIN UPDATE "HumanVerificationSettings" SET "scope" = 'role_review_hv_scope_tamper'
    WHERE "id" = 'role-review-hv-setting-existing';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Human Verification settings scope'; END IF;
  denied := false;
  BEGIN UPDATE "HumanVerificationSettings" SET "id" = 'role-review-hv-setting-id-tamper'
    WHERE "id" = 'role-review-hv-setting-existing';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Human Verification settings identity'; END IF;

  denied := false;
  BEGIN UPDATE "AuthSession" SET "id" = 'tampered-auth-session-id'
    WHERE "id" = 'role-review-auth-session-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AuthSession identity'; END IF;
  denied := false;
  BEGIN UPDATE "AuthSession" SET "userId" = 'role-review-user-b'
    WHERE "id" = 'role-review-auth-session-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AuthSession ownership'; END IF;
  denied := false;
  BEGIN UPDATE "AuthSession" SET "tokenIdHash" = 'tampered-session-hash'
    WHERE "id" = 'role-review-auth-session-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AuthSession token binding'; END IF;
  denied := false;
  BEGIN UPDATE "AuthSession" SET "expiresAt" = now() + interval '30 days'
    WHERE "id" = 'role-review-auth-session-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AuthSession expiry'; END IF;
  denied := false;
  BEGIN UPDATE "AuthSession" SET "createdAt" = now() - interval '30 days'
    WHERE "id" = 'role-review-auth-session-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AuthSession creation time'; END IF;

  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "id" = 'tampered-oauth-code-id'
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode identity'; END IF;
  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "userId" = 'role-review-user-b'
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode ownership'; END IF;
  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "codeHash" = 'tampered-oauth-code-hash'
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode hash'; END IF;
  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "authSessionVersion" = 1
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode session version'; END IF;
  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "expiresAt" = now() + interval '30 days'
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode expiry'; END IF;
  denied := false;
  BEGIN UPDATE "OAuthExchangeCode" SET "createdAt" = now() - interval '30 days'
    WHERE "id" = 'role-review-oauth-code-active';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed OAuthExchangeCode creation time'; END IF;

  denied := false;
  BEGIN DELETE FROM "PaymentSettlement" WHERE "id" = 'role-review-funding-settlement';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of PaymentSettlement was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "OrderPaymentSettlement" WHERE "id" = 'role-review-order-settlement';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of OrderPaymentSettlement was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "Transaction" WHERE "id" = 'role-review-transaction';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of Transaction was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "GcoinTransaction" WHERE "id" = 'role-review-gcoin-transaction';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of GcoinTransaction was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "GcoinConversionRequest" WHERE "id" = 'role-review-gcoin-conversion';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of GcoinConversionRequest was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "WalletFundingIntent" WHERE "id" = 'role-review-funding';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of WalletFundingIntent was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "OrderPaymentIntent" WHERE "id" = 'role-review-order-intent';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of OrderPaymentIntent was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "WithdrawalRequest" WHERE "id" = 'role-review-withdrawal';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of WithdrawalRequest was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "User" WHERE "id" = 'role-review-user-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of User was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "Order" WHERE "id" = 'role-review-order-a';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE of Order was allowed'; END IF;
  denied := false;
  BEGIN UPDATE "WalletFundingIntent" SET "amount" = 11 WHERE "id" = 'role-review-funding';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime update of immutable funding amount was allowed'; END IF;
  denied := false;
  BEGIN UPDATE "WithdrawalRequest" SET "amount" = 6 WHERE "id" = 'role-review-withdrawal';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime update of withdrawal amount was allowed'; END IF;
  denied := false;
  BEGIN UPDATE "PaymentSettlement" SET "providerReferenceId" = 'rewritten' WHERE "id" = 'role-review-funding-settlement';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime update of immutable settlement receipt was allowed'; END IF;
  denied := false;
  BEGIN UPDATE "GcoinTransaction" SET "amount" = 999 WHERE "id" = 'role-review-gcoin-transaction';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime update of immutable Gcoin ledger row was allowed'; END IF;
  denied := false;
  BEGIN CREATE TABLE public.role_review_forbidden (id integer);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime CREATE TABLE was allowed'; END IF;
  denied := false;
  BEGIN ALTER TABLE "User" ADD COLUMN role_review_forbidden integer;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime ALTER TABLE was allowed'; END IF;
  denied := false;
  BEGIN TRUNCATE TABLE "Transaction";
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime TRUNCATE was allowed'; END IF;
  denied := false;
  BEGIN CREATE TRIGGER role_review_forbidden_trigger
    BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime CREATE TRIGGER was allowed'; END IF;
  denied := false;
  BEGIN ALTER TABLE "AppSetting" DISABLE TRIGGER set_updated_at_trigger;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime altered a migration-managed trigger'; END IF;
  denied := false;
  BEGIN PERFORM 1 FROM "_prisma_migrations";
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime read of migration history was allowed'; END IF;
  denied := false;
  BEGIN PERFORM 1 FROM "scrolith_runtime_policy_state";
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime read of its private finalization gate was allowed'; END IF;
  denied := false;
  BEGIN INSERT INTO "_prisma_migrations" DEFAULT VALUES;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime INSERT into migration history was allowed'; END IF;
  denied := false;
  BEGIN UPDATE "_prisma_migrations" SET "applied_steps_count" = 99 WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime UPDATE of migration history was allowed'; END IF;
  denied := false;
  BEGIN DELETE FROM "_prisma_migrations" WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime DELETE from migration history was allowed'; END IF;
  FOREACH protected_table IN ARRAY ARRAY[
    'User', 'Order', 'Wallet', 'Transaction', 'WalletFundingIntent',
    'PaymentSettlement', 'OrderPaymentIntent', 'OrderPaymentSettlement',
    'GcoinWallet', 'GcoinTransaction', 'GcoinConversionRequest',
    'WithdrawalRequest', 'Escrow', 'FxLock', 'FoundingPartnerProgram',
    'FoundingPartner', 'FoundingPartnerEnrollmentPayment',
    'FoundingPartnerProfitPeriod', 'FoundingPartnerProfitSource',
    'FoundingPartnerDistributionRun', 'FoundingPartnerDistribution',
    'FoundingPartnerAuditLog'
  ] LOOP
    denied := false;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE false', protected_table);
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'runtime DELETE privilege remains on protected table %', protected_table;
    END IF;
  END LOOP;
END
$assert_runtime_denials$;

RESET ROLE;
SET LOCAL ROLE scrolith_migrator;

DO $assert_restrictive_foreign_keys$
DECLARE
  denied BOOLEAN;
BEGIN
  denied := false;
  BEGIN DELETE FROM "WalletFundingIntent" WHERE "id" = 'role-review-funding';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'funding intent deletion erased/allowed settlement history'; END IF;
  denied := false;
  BEGIN DELETE FROM "OrderPaymentIntent" WHERE "id" = 'role-review-order-intent';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'order payment intent deletion erased/allowed settlement history'; END IF;
  denied := false;
  BEGIN DELETE FROM "Order" WHERE "id" = 'role-review-order-a';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'order deletion erased/allowed financial history'; END IF;
  denied := false;
  BEGIN DELETE FROM "Wallet" WHERE "id" = 'role-review-wallet-a';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'wallet deletion erased/allowed financial history'; END IF;
  denied := false;
  BEGIN DELETE FROM "GcoinWallet" WHERE "id" = 'role-review-gcoin-wallet';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Gcoin wallet deletion erased/allowed transaction history'; END IF;
  denied := false;
  BEGIN DELETE FROM "User" WHERE "id" = 'role-review-user-a';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'user deletion erased/allowed account financial history'; END IF;
  denied := false;
  BEGIN DELETE FROM "User" WHERE "id" = 'role-review-user-gcoin-only';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Gcoin-only user deletion cascaded transaction history'; END IF;
  denied := false;
  BEGIN DELETE FROM "GcoinWallet" WHERE "id" = 'role-review-gcoin-only-wallet';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Gcoin wallet deletion cascaded its transaction history'; END IF;
  denied := false;
  BEGIN DELETE FROM "FxLock" WHERE "id" = 'role-review-fx-wallet';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FX lock deletion orphaned financial intent'; END IF;
  IF (SELECT count(*) FROM "PaymentSettlement" WHERE "id" = 'role-review-funding-settlement') <> 1
     OR (SELECT count(*) FROM "OrderPaymentSettlement" WHERE "id" = 'role-review-order-settlement') <> 1
     OR (SELECT count(*) FROM "GcoinTransaction" WHERE "id" = 'role-review-gcoin-transaction') <> 1 THEN
    RAISE EXCEPTION 'one of the retained historical rows disappeared';
  END IF;
END
$assert_restrictive_foreign_keys$;

CREATE TABLE public.role_review_future_table (id integer PRIMARY KEY);
DO $assert_future_defaults$
BEGIN
  IF NOT has_table_privilege('scrolith_runtime', 'public.role_review_future_table', 'SELECT')
     OR NOT has_table_privilege('scrolith_runtime', 'public.role_review_future_table', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.role_review_future_table', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.role_review_future_table', 'DELETE') THEN
    RAISE EXCEPTION 'future tables do not receive the expected read/insert-only runtime defaults';
  END IF;
END
$assert_future_defaults$;

ROLLBACK;
\echo 'PASS: runtime allowed-write, immutability, migration-isolation, and parent-cascade checks passed; fixtures rolled back.'
