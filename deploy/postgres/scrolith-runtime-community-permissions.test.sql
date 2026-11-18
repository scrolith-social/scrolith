-- Disposable-only regression tests for ad-payment/Gcoin history retention and
-- Founding Partner column grants. All rows and attempted writes roll back.
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
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'community permission test requires the named disposable database'; END $psql_guard_failure$;
\endif

BEGIN;
SET LOCAL ROLE scrolith_migrator;
INSERT INTO "User" ("id", "email", "updatedAt") VALUES
  ('retention-test-user', 'retention-test@example.invalid', now()),
  ('retention-test-partner', 'retention-partner@example.invalid', now());
INSERT INTO "CommunityPost" ("id", "authorId", "content", "updatedAt")
VALUES ('retention-test-post', 'retention-test-user', 'synthetic retained post', now());
INSERT INTO "GcoinEarningEvent" ("id", "postId", "actorId", "eventType", "eventKey")
VALUES ('retention-test-event', 'retention-test-post', 'retention-test-user', 'like', 'retention-test-event-key');
INSERT INTO "CommunityAd" ("id", "creatorId", "title", "body", "placement", "status", "updatedAt")
VALUES ('retention-test-ad', 'retention-test-user', 'Synthetic retained ad', 'Synthetic body', 'feed', 'PAID', now());
INSERT INTO "AdPayment" ("id", "adId", "transactionId", "amount", "currency", "status")
VALUES ('retention-test-payment', 'retention-test-ad', 'synthetic-ad-payment', 10, 'USD', 'pending');

INSERT INTO "FoundingPartnerProgram" ("id", "programKey", "updatedAt")
VALUES ('retention-test-program', 'retention-test-program-key', now());
INSERT INTO "FoundingPartner" (
  "id", "programId", "userId", "fullName", "country", "city", "termsVersion", "termsAcceptedAt", "updatedAt"
) VALUES (
  'retention-test-partner-row', 'retention-test-program', 'retention-test-partner',
  'Synthetic partner', 'XX', 'Test City', 'test-v1', now(), now()
);
INSERT INTO "FoundingPartnerEnrollmentPayment" (
  "id", "programId", "userId", "provider", "idempotencyKey", "amount", "currency", "updatedAt"
) VALUES (
  'retention-test-enrollment', 'retention-test-program', 'retention-test-partner',
  'synthetic', 'retention-test-enrollment-key', 2, 'USD', now()
);
INSERT INTO "FoundingPartnerProfitPeriod" (
  "id", "programId", "periodYear", "notes", "updatedAt"
) VALUES ('retention-test-period', 'retention-test-program', 2199, 'initial', now());
INSERT INTO "FoundingPartnerProfitSource" (
  "id", "periodId", "sourceType", "clearedAmount", "adjustments", "updatedAt"
) VALUES ('retention-test-source', 'retention-test-period', 'synthetic', 100, 0, now());
INSERT INTO "FoundingPartnerDistributionRun" (
  "id", "periodId", "idempotencyKey", "poolAmount", "partnerCount", "perPartnerAmount", "updatedAt"
) VALUES ('retention-test-run', 'retention-test-period', 'retention-test-run-key', 20, 1, 20, now());
INSERT INTO "FoundingPartnerDistribution" (
  "id", "runId", "partnerId", "userId", "amount", "idempotencyKey", "updatedAt"
) VALUES (
  'retention-test-distribution', 'retention-test-run', 'retention-test-partner-row',
  'retention-test-partner', 20, 'retention-test-distribution-key', now()
);
INSERT INTO "FoundingPartnerAuditLog" (
  "id", "programId", "action", "entityType", "entityId"
) VALUES ('retention-test-audit', 'retention-test-program', 'TEST', 'test', 'retention-test');

-- Even the migrator cannot cascade-delete a retained child because the FK is
-- RESTRICT. Catch expected violations so the enclosing test transaction lives.
DO $assert_restrictive_fks$
DECLARE denied BOOLEAN;
BEGIN
  denied := false;
  BEGIN DELETE FROM "CommunityAd" WHERE "id" = 'retention-test-ad';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'CommunityAd delete cascaded through AdPayment'; END IF;

  denied := false;
  BEGIN DELETE FROM "CommunityPost" WHERE "id" = 'retention-test-post';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'CommunityPost delete cascaded through GcoinEarningEvent'; END IF;

  denied := false;
  BEGIN DELETE FROM "User" WHERE "id" = 'retention-test-user';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'User delete cascaded through retained ad/payment or Gcoin history'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "AdPayment" WHERE "id" = 'retention-test-payment')
     OR NOT EXISTS (SELECT 1 FROM "GcoinEarningEvent" WHERE "id" = 'retention-test-event') THEN
    RAISE EXCEPTION 'User delete removed retained AdPayment or GcoinEarningEvent history';
  END IF;

  denied := false;
  BEGIN DELETE FROM "FoundingPartner" WHERE "id" = 'retention-test-partner-row';
  EXCEPTION WHEN foreign_key_violation THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FoundingPartner delete removed enrollment/distribution history'; END IF;
END
$assert_restrictive_fks$;

SET LOCAL ROLE scrolith_runtime;

-- Supported ad-payment reconciliation and Gcoin reaction lifecycle writes.
UPDATE "AdPayment" SET "status" = 'completed', "amount" = 10, "currency" = 'USD'
 WHERE "id" = 'retention-test-payment';
UPDATE "GcoinEarningEvent"
   SET "reactionActive" = false, "reversedAt" = now(), "reversalCount" = "reversalCount" + 1
 WHERE "id" = 'retention-test-event';
UPDATE "FoundingPartnerProgram" SET "status" = 'ACTIVE', "enrolledCount" = 1, "updatedAt" = now()
 WHERE "id" = 'retention-test-program';
UPDATE "FoundingPartner" SET "status" = 'DEACTIVATED', "deactivatedAt" = now(),
  "deactivatedReason" = 'synthetic', "updatedAt" = now()
 WHERE "id" = 'retention-test-partner-row';
UPDATE "FoundingPartnerEnrollmentPayment" SET "sourceAmount" = 2, "sourceCurrency" = 'USD',
  "chargedAmount" = 2, "chargedCurrency" = 'USD', "fxRate" = 1, "fxRateSource" = 'test',
  "fxSnapshotId" = 'synthetic-fx', "providerReferenceId" = 'synthetic-session',
  "providerIntentId" = 'synthetic-intent', "providerPayload" = '{"synthetic":true}'::jsonb,
  "status" = 'COMPLETED', "settledAt" = now(), "partnerId" = 'retention-test-partner-row', "updatedAt" = now()
 WHERE "id" = 'retention-test-enrollment';
UPDATE "FoundingPartnerProfitPeriod" SET "notes" = 'edited', "status" = 'CLOSED',
  "clearedProfit" = 100, "partnerPool" = 20, "closedAt" = now(), "approvedAt" = now(),
  "approvedById" = 'retention-test-partner', "distributedAt" = now(), "updatedAt" = now()
 WHERE "id" = 'retention-test-period';
UPDATE "FoundingPartnerProfitSource" SET "clearedAmount" = 110, "adjustments" = 1,
  "notes" = 'synthetic update', "updatedAt" = now()
 WHERE "id" = 'retention-test-source';
UPDATE "FoundingPartnerDistributionRun" SET "status" = 'PROCESSING',
  "approvedById" = 'retention-test-partner', "executedById" = 'retention-test-partner',
  "approvedAt" = now(), "executedAt" = now(), "completedAt" = now(),
  "failureReason" = 'synthetic retry', "updatedAt" = now()
 WHERE "id" = 'retention-test-run';
UPDATE "FoundingPartnerDistribution" SET "status" = 'COMPLETED',
  "walletTransactionId" = 'synthetic-wallet-txn', "walletAmount" = 20,
  "walletCurrency" = 'USD', "fxRate" = 1, "creditedAt" = now(), "updatedAt" = now()
 WHERE "id" = 'retention-test-distribution';

DO $assert_supported_updates$
BEGIN
  IF (SELECT "status" FROM "AdPayment" WHERE "id" = 'retention-test-payment') <> 'completed'
     OR (SELECT "reactionActive" FROM "GcoinEarningEvent" WHERE "id" = 'retention-test-event')
     OR (SELECT "reversalCount" FROM "GcoinEarningEvent" WHERE "id" = 'retention-test-event') <> 1
     OR (SELECT "status" FROM "FoundingPartnerProgram" WHERE "id" = 'retention-test-program') <> 'ACTIVE'
     OR (SELECT "status" FROM "FoundingPartner" WHERE "id" = 'retention-test-partner-row') <> 'DEACTIVATED'
     OR (SELECT "status" FROM "FoundingPartnerEnrollmentPayment" WHERE "id" = 'retention-test-enrollment') <> 'COMPLETED'
     OR (SELECT "clearedAmount" FROM "FoundingPartnerProfitSource" WHERE "id" = 'retention-test-source') <> 110
     OR (SELECT "status" FROM "FoundingPartnerDistributionRun" WHERE "id" = 'retention-test-run') <> 'PROCESSING'
     OR (SELECT "status" FROM "FoundingPartnerDistribution" WHERE "id" = 'retention-test-distribution') <> 'COMPLETED' THEN
    RAISE EXCEPTION 'one or more supported runtime updates failed';
  END IF;
END
$assert_supported_updates$;

DO $assert_denied_operations$
DECLARE denied BOOLEAN;
BEGIN
  denied := false;
  BEGIN DELETE FROM "AdPayment" WHERE "id" = 'retention-test-payment';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime deleted AdPayment history'; END IF;
  denied := false;
  BEGIN DELETE FROM "GcoinEarningEvent" WHERE "id" = 'retention-test-event';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime deleted GcoinEarningEvent history'; END IF;
  denied := false;
  BEGIN UPDATE "AdPayment" SET "adId" = 'missing-ad' WHERE "id" = 'retention-test-payment';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed AdPayment identity'; END IF;
  denied := false;
  BEGIN UPDATE "GcoinEarningEvent" SET "value" = 999 WHERE "id" = 'retention-test-event';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Gcoin earning value'; END IF;
  denied := false;
  BEGIN UPDATE "GcoinEarningEvent" SET "credited" = true WHERE "id" = 'retention-test-event';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Gcoin credit evidence'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerProgram" SET "capacity" = 999 WHERE "id" = 'retention-test-program';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed Founding Partner capacity'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartner" SET "encryptedTaxId" = 'rewritten' WHERE "id" = 'retention-test-partner-row';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed encrypted Founding Partner identity'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerEnrollmentPayment" SET "amount" = 999 WHERE "id" = 'retention-test-enrollment';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed enrollment principal amount'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerProfitPeriod" SET "periodYear" = 2200 WHERE "id" = 'retention-test-period';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed profit period identity'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerProfitSource" SET "sourceType" = 'rewritten' WHERE "id" = 'retention-test-source';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed profit-source identity'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerDistributionRun" SET "poolAmount" = 999 WHERE "id" = 'retention-test-run';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed distribution pool amount'; END IF;
  denied := false;
  BEGIN UPDATE "FoundingPartnerDistribution" SET "amount" = 999 WHERE "id" = 'retention-test-distribution';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime changed distribution principal amount'; END IF;
  denied := false;
  BEGIN DELETE FROM "FoundingPartnerAuditLog" WHERE "id" = 'retention-test-audit';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime deleted Founding Partner audit history'; END IF;
  denied := false;
  BEGIN DELETE FROM "FoundingPartner" WHERE "id" = 'retention-test-partner-row';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime deleted Founding Partner'; END IF;
END
$assert_denied_operations$;

ROLLBACK;
