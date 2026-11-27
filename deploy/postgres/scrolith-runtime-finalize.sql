-- SOURCE TEMPLATE ONLY. Run after migrations and the guarded migrator handoff.
-- This finalizer is intended to run as scrolith_migrator, which owns the
-- application objects. It only adjusts grants; it never edits application rows.

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
SELECT CASE
         WHEN current_database() = :'database_name'
          AND current_database() ~* '(test|e2e)'
          AND current_user = 'scrolith_migrator'
         THEN 1 ELSE 0
       END AS target_is_safe \gset
\if :target_is_safe
  \set _scrolith_guard_failed false
\else
  \set _scrolith_guard_failed true
\echo 'STOP: connect as scrolith_migrator to the supplied test/e2e database.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'finalizer requires scrolith_migrator and the named disposable database'; END $psql_guard_failure$;
\endif

\set application_schema 'public'
\set runtime_role 'scrolith_runtime'

BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.scrolith_runtime_policy_state FROM PUBLIC, :"runtime_role";

REVOKE ALL PRIVILEGES ON TABLE :"application_schema"."_prisma_migrations"
  FROM :"runtime_role";
REVOKE CREATE ON SCHEMA :"application_schema" FROM :"runtime_role";
REVOKE TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA :"application_schema"
  FROM :"runtime_role";

-- These records and their identifying parents are not hard-deleted by the
-- application. Account removal is soft deactivation; payment, wallet, order,
-- withdrawal, FX, settlement, Gcoin, and founding-partner evidence is retained.
REVOKE DELETE ON TABLE
  :"application_schema"."User",
  :"application_schema"."Order",
  :"application_schema"."Wallet",
  :"application_schema"."Transaction",
  :"application_schema"."WalletFundingIntent",
  :"application_schema"."PaymentSettlement",
  :"application_schema"."OrderPaymentIntent",
  :"application_schema"."OrderPaymentSettlement",
  :"application_schema"."AdPayment",
  :"application_schema"."GcoinEarningEvent",
  :"application_schema"."GcoinWallet",
  :"application_schema"."GcoinTransaction",
  :"application_schema"."GcoinConversionRequest",
  :"application_schema"."Profile",
  :"application_schema"."WithdrawalRequest",
  :"application_schema"."Escrow",
  :"application_schema"."FxLock",
  :"application_schema"."FoundingPartnerProgram",
  :"application_schema"."FoundingPartner",
  :"application_schema"."FoundingPartnerEnrollmentPayment",
  :"application_schema"."FoundingPartnerProfitPeriod",
  :"application_schema"."FoundingPartnerProfitSource",
  :"application_schema"."FoundingPartnerDistributionRun",
  :"application_schema"."FoundingPartnerDistribution",
  :"application_schema"."FoundingPartnerAuditLog"
FROM :"runtime_role";

-- Immutable receipts/records are insert-only for the runtime role. Transaction
-- status transitions remain supported below; amounts, currency, ownership, and
-- identifiers do not become mutable merely because the table has an UPDATE grant.
REVOKE UPDATE ON TABLE
  :"application_schema"."PaymentSettlement",
  :"application_schema"."OrderPaymentSettlement",
  :"application_schema"."AdPayment",
  :"application_schema"."GcoinEarningEvent",
  :"application_schema"."GcoinTransaction",
  :"application_schema"."FxLock",
  :"application_schema"."FoundingPartnerAuditLog"
FROM :"runtime_role";

-- Clear any previous per-column UPDATE grants before applying the current
-- allowlists. This makes the finalizer repeatable after an earlier policy run.
DO $revoke_column_updates$
DECLARE
  table_name TEXT;
  column_row RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AppSetting', 'HumanVerificationSettings',
    'Transaction', 'Wallet', 'WalletFundingIntent', 'OrderPaymentIntent',
    'WithdrawalRequest', 'GcoinWallet', 'Order', 'Escrow',
    'GcoinConversionRequest', 'AdPayment', 'GcoinEarningEvent',
    'Profile',
    'FoundingPartnerProgram', 'FoundingPartner',
    'FoundingPartnerEnrollmentPayment', 'FoundingPartnerProfitPeriod',
    'FoundingPartnerProfitSource', 'FoundingPartnerDistributionRun',
    'FoundingPartnerDistribution', 'AuthSession', 'OAuthExchangeCode'
  ] LOOP
    FOR column_row IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = to_regclass(format('%I.%I', 'public', table_name))
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE UPDATE (%I) ON TABLE %I.%I FROM %I',
        column_row.attname, 'public', table_name, 'scrolith_runtime'
      );
    END LOOP;
  END LOOP;
END
$revoke_column_updates$;

REVOKE UPDATE ON TABLE
  :"application_schema"."AppSetting",
  :"application_schema"."HumanVerificationSettings",
  :"application_schema"."Transaction",
  :"application_schema"."Wallet",
  :"application_schema"."WalletFundingIntent",
  :"application_schema"."OrderPaymentIntent",
  :"application_schema"."WithdrawalRequest",
  :"application_schema"."GcoinWallet",
  :"application_schema"."Order",
  :"application_schema"."Escrow",
  :"application_schema"."GcoinConversionRequest",
  :"application_schema"."Profile",
  :"application_schema"."AdPayment",
  :"application_schema"."GcoinEarningEvent",
  :"application_schema"."FoundingPartnerProgram",
  :"application_schema"."FoundingPartner",
  :"application_schema"."FoundingPartnerEnrollmentPayment",
  :"application_schema"."FoundingPartnerProfitPeriod",
  :"application_schema"."FoundingPartnerProfitSource",
  :"application_schema"."FoundingPartnerDistributionRun",
  :"application_schema"."FoundingPartnerDistribution",
  :"application_schema"."AuthSession",
  :"application_schema"."OAuthExchangeCode"
FROM :"runtime_role";

GRANT UPDATE ("status", "description", "metadata", "updatedAt")
  ON TABLE :"application_schema"."Transaction" TO :"runtime_role";
-- Application settings are written through the existing admin/configuration
-- services. Keep row identity and scope immutable while permitting their JSON
-- payload and Prisma-managed timestamp to change. Human Verification also
-- records the actor responsible for the policy update.
GRANT UPDATE ("data", "updatedAt")
  ON TABLE :"application_schema"."AppSetting" TO :"runtime_role";
GRANT UPDATE ("data", "updatedBy", "updatedAt")
  ON TABLE :"application_schema"."HumanVerificationSettings" TO :"runtime_role";
-- Profile edits are limited to updateUserProfile and the approved Scrolitha
-- profile-advisor fields; identity and aggregate columns are intentionally excluded.
GRANT UPDATE ("bio", "certifications", "city", "country", "countryCode",
              "coverPhotoUrl", "dateOfBirth", "educationItems", "experienceItems",
              "formattedAddress", "gender", "githubUrl", "hourlyRate", "introVideoUrl",
              "languages", "latitude", "linkedinUrl", "location", "locationSource",
              "longitude", "placeId", "portfolio", "portfolioUrl", "postalCode",
              "region", "showBirthMonthDayPublic", "skills", "state", "title",
              "updatedAt", "websiteUrl")
  ON TABLE :"application_schema"."Profile" TO :"runtime_role";
GRANT UPDATE ("balance", "pendingClearance", "escrowBalance", "frozen", "updatedAt")
  ON TABLE :"application_schema"."Wallet" TO :"runtime_role";
GRANT UPDATE ("fxLockId", "status", "providerReferenceId", "providerCheckoutUrl", "providerPayload", "expiresAt", "updatedAt")
  ON TABLE :"application_schema"."WalletFundingIntent" TO :"runtime_role";
GRANT UPDATE ("fxLockId", "status", "providerReferenceId", "providerCheckoutUrl", "providerPayload", "updatedAt")
  ON TABLE :"application_schema"."OrderPaymentIntent" TO :"runtime_role";
GRANT UPDATE ("fxLockId", "details", "status", "processedAt", "updatedAt")
  ON TABLE :"application_schema"."WithdrawalRequest" TO :"runtime_role";
GRANT UPDATE ("balance", "lifetimeEarned", "status", "fraudScore", "updatedAt")
  ON TABLE :"application_schema"."GcoinWallet" TO :"runtime_role";
GRANT UPDATE ("status", "stripeIntentId", "transactionId", "updatedAt")
  ON TABLE :"application_schema"."Order" TO :"runtime_role";
GRANT UPDATE ("status", "commission", "fundedAt", "releasedAt", "refundedAt", "updatedAt")
  ON TABLE :"application_schema"."Escrow" TO :"runtime_role";
GRANT UPDATE ("status", "processedAt", "processedBy")
  ON TABLE :"application_schema"."GcoinConversionRequest" TO :"runtime_role";
GRANT UPDATE ("amount", "currency", "status")
  ON TABLE :"application_schema"."AdPayment" TO :"runtime_role";
GRANT UPDATE ("reactionActive", "reversedAt", "reversalCount")
  ON TABLE :"application_schema"."GcoinEarningEvent" TO :"runtime_role";
-- Authentication writes durable sessions and OAuth exchange codes, updates
-- only revocation/consumption fields, and removes expired rows after retention.
GRANT SELECT, INSERT, DELETE
  ON TABLE :"application_schema"."AuthSession" TO :"runtime_role";
GRANT UPDATE ("revokedAt", "revokeReason")
  ON TABLE :"application_schema"."AuthSession" TO :"runtime_role";
GRANT SELECT, INSERT, DELETE
  ON TABLE :"application_schema"."OAuthExchangeCode" TO :"runtime_role";
GRANT UPDATE ("usedAt")
  ON TABLE :"application_schema"."OAuthExchangeCode" TO :"runtime_role";

-- Founding Partner field allowlists are derived from the current service and
-- admin route writes. Economic inputs and identity/idempotency keys remain
-- immutable; only workflow, provider settlement, and operational source fields
-- required by those call sites may be updated.
GRANT UPDATE ("status", "enrolledCount", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerProgram" TO :"runtime_role";
GRANT UPDATE ("status", "deactivatedAt", "deactivatedReason", "reactivatedAt", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartner" TO :"runtime_role";
GRANT UPDATE ("sourceAmount", "sourceCurrency", "chargedAmount", "chargedCurrency",
              "fxRate", "fxRateSource", "fxSnapshotId", "providerReferenceId",
              "providerIntentId", "providerPayload", "status", "settledAt",
              "partnerId", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerEnrollmentPayment" TO :"runtime_role";
GRANT UPDATE ("status", "notes", "clearedProfit", "partnerPool", "closedAt",
              "approvedAt", "approvedById", "distributedAt", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerProfitPeriod" TO :"runtime_role";
GRANT UPDATE ("clearedAmount", "adjustments", "notes", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerProfitSource" TO :"runtime_role";
GRANT UPDATE ("status", "approvedById", "executedById", "approvedAt", "executedAt",
              "completedAt", "failureReason", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerDistributionRun" TO :"runtime_role";
GRANT UPDATE ("status", "walletTransactionId", "walletAmount", "walletCurrency",
              "fxRate", "creditedAt", "updatedAt")
  ON TABLE :"application_schema"."FoundingPartnerDistribution" TO :"runtime_role";

DO $verify_policy$
DECLARE
  protected_table TEXT;
  protected_tables TEXT[] := ARRAY[
    'User', 'Order', 'Wallet', 'Transaction', 'WalletFundingIntent',
    'PaymentSettlement', 'OrderPaymentIntent', 'OrderPaymentSettlement',
    'AdPayment', 'GcoinEarningEvent', 'Profile',
    'GcoinWallet', 'GcoinTransaction', 'GcoinConversionRequest',
    'WithdrawalRequest', 'Escrow', 'FxLock', 'FoundingPartnerProgram',
    'FoundingPartner', 'FoundingPartnerEnrollmentPayment',
    'FoundingPartnerProfitPeriod', 'FoundingPartnerProfitSource',
    'FoundingPartnerDistributionRun', 'FoundingPartnerDistribution',
    'FoundingPartnerAuditLog'
  ];
  profile_update_columns TEXT[] := ARRAY[
    'bio', 'certifications', 'city', 'country', 'countryCode',
    'coverPhotoUrl', 'dateOfBirth', 'educationItems', 'experienceItems',
    'formattedAddress', 'gender', 'githubUrl', 'hourlyRate', 'introVideoUrl',
    'languages', 'latitude', 'linkedinUrl', 'location', 'locationSource',
    'longitude', 'placeId', 'portfolio', 'portfolioUrl', 'postalCode',
    'region', 'showBirthMonthDayPublic', 'skills', 'state', 'title',
    'updatedAt', 'websiteUrl'
  ];
BEGIN
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has CREATE on public schema';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."AppSetting"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'updatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'scope', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime AppSetting UPDATE allowlist does not match supported config upserts';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."Profile"', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM unnest(profile_update_columns) AS allowed(column_name)
        WHERE NOT has_column_privilege('scrolith_runtime', 'public."Profile"', allowed.column_name, 'UPDATE')
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns AS profile_column
        WHERE profile_column.table_schema = 'public'
          AND profile_column.table_name = 'Profile'
          AND has_column_privilege('scrolith_runtime', 'public."Profile"', profile_column.column_name, 'UPDATE')
          AND NOT profile_column.column_name = ANY(profile_update_columns)
     ) THEN
    RAISE EXCEPTION 'runtime Profile UPDATE allowlist does not match the profile write paths';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedBy', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'scope', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime HumanVerificationSettings UPDATE allowlist does not match its service';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."AuthSession"', 'UPDATE')
     OR NOT has_table_privilege('scrolith_runtime', 'public."AuthSession"', 'SELECT')
     OR NOT has_table_privilege('scrolith_runtime', 'public."AuthSession"', 'INSERT')
     OR NOT has_table_privilege('scrolith_runtime', 'public."AuthSession"', 'DELETE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'revokedAt', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'revokeReason', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'id', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'userId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'tokenIdHash', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'expiresAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AuthSession"', 'createdAt', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime AuthSession privileges do not match the reviewed service operations';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'UPDATE')
     OR NOT has_table_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'SELECT')
     OR NOT has_table_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'INSERT')
     OR NOT has_table_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'DELETE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'usedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'id', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'userId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'codeHash', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'authSessionVersion', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'expiresAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OAuthExchangeCode"', 'createdAt', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime OAuthExchangeCode privileges do not match the reviewed service operations';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has migration-ledger privileges';
  END IF;
  FOREACH protected_table IN ARRAY protected_tables LOOP
    IF to_regclass(format('%I.%I', 'public', protected_table)) IS NULL THEN
      RAISE EXCEPTION 'expected protected table public.% is missing', protected_table;
    END IF;
    IF has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'DELETE') THEN
      RAISE EXCEPTION 'runtime role unexpectedly retains DELETE on public.%', protected_table;
    END IF;
    IF has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'TRUNCATE')
       OR has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'TRIGGER') THEN
      RAISE EXCEPTION 'runtime role unexpectedly retains TRUNCATE/TRIGGER on public.%', protected_table;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('scrolith_runtime', 'public."WalletFundingIntent"', 'fxLockId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."OrderPaymentIntent"', 'fxLockId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."WithdrawalRequest"', 'details', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."WalletFundingIntent"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."WalletFundingIntent"', 'currency', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OrderPaymentIntent"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Transaction"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Transaction"', 'currency', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Wallet"', 'userId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Wallet"', 'currency', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinWallet"', 'userId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinWallet"', 'recipientId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."WithdrawalRequest"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."WithdrawalRequest"', 'userId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."Order"', 'status', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."Order"', 'stripeIntentId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Order"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Order"', 'clientId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."Escrow"', 'status', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."Escrow"', 'commission', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Escrow"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Escrow"', 'orderId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."GcoinConversionRequest"', 'status', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinConversionRequest"', 'amountGcoin', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinConversionRequest"', 'userId', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime column UPDATE allowlist does not match the reviewed flows';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."AdPayment"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'status', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'amount', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'currency', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'adId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'transactionId', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'reactionActive', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'reversedAt', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'reversalCount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'value', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'credited', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime AdPayment/GcoinEarningEvent UPDATE allowlist is incorrect';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."FoundingPartnerProgram"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProgram"', 'status', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProgram"', 'enrolledCount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProgram"', 'capacity', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartner"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartner"', 'status', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartner"', 'deactivatedReason', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartner"', 'encryptedTaxId', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerEnrollmentPayment"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerEnrollmentPayment"', 'providerReferenceId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerEnrollmentPayment"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerEnrollmentPayment"', 'idempotencyKey', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerProfitPeriod"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProfitPeriod"', 'status', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProfitPeriod"', 'periodYear', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerProfitSource"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProfitSource"', 'clearedAmount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerProfitSource"', 'sourceType', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerDistributionRun"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerDistributionRun"', 'status', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerDistributionRun"', 'poolAmount', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerDistribution"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."FoundingPartnerDistribution"', 'walletAmount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."FoundingPartnerDistribution"', 'amount', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime Founding Partner UPDATE allowlists do not match verified flows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(c.relowner) = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime role owns an application relation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime role owns an application routine';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime') THEN
    RAISE EXCEPTION 'runtime login must remain disabled until the separate enable script runs';
  END IF;
  IF to_regclass('public.scrolith_runtime_policy_state') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.scrolith_runtime_policy_state WHERE singleton AND NOT finalized) THEN
    RAISE EXCEPTION 'runtime policy gate is missing or already finalized';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has access to the policy gate';
  END IF;
END
$verify_policy$;

DO $mark_policy_finalized$
DECLARE
  changed_rows INTEGER;
BEGIN
  UPDATE public.scrolith_runtime_policy_state
     SET finalized = TRUE, finalized_at = now()
   WHERE singleton AND NOT finalized;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'runtime policy finalization marker could not be written';
  END IF;
END
$mark_policy_finalized$;

COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
FROM pg_roles
WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator')
ORDER BY rolname;

SELECT n.nspname AS schema_name, c.relname AS relation_name,
       pg_get_userbyid(c.relowner) AS owner_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'application_schema'
  AND pg_get_userbyid(c.relowner) = :'runtime_role';
