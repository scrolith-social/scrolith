-- Production counterpart to the disposable-only finalizer. Its runtime policy
-- is an explicit, source-reviewed grant inventory; the disposable-only script
-- and its production-target guard remain separate and unchanged.
\ir scrolith-production-target-guard.sql
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);
\set application_schema 'public'
\set runtime_role 'scrolith_runtime'

BEGIN;
DO $production_release_preflight$
DECLARE
  applied_count INTEGER;
  total_count INTEGER;
  distinct_count INTEGER;
  last_name TEXT;
  bootstrap_admin TEXT;
BEGIN
  IF current_user <> 'scrolith_migrator'
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_migrator')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime') THEN
    RAISE EXCEPTION 'finalization requires LOGIN migrator while runtime remains NOLOGIN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scrolith_runtime_policy_state
     WHERE singleton
       AND source_commit = current_setting('scrolith.expected_source_commit')
       AND migration_count = 143
       AND last_migration = '20261122100000_restrict_order_gig_history'
       AND ownership_verified
       AND NOT finalized
       AND finalized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'migration/ownership marker is missing, mismatched, or already finalized';
  END IF;
  SELECT bootstrap_admin_role INTO bootstrap_admin
    FROM public.scrolith_runtime_policy_state WHERE singleton;
  IF bootstrap_admin IS NULL OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
       OR (granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
           AND (member_role.rolname <> bootstrap_admin
                OR NOT m.admin_option OR m.inherit_option OR m.set_option))
  ) THEN
    RAISE EXCEPTION 'application role memberships changed after bootstrap';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_backup')
     OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'scrolith_backup') THEN
    RAISE EXCEPTION 'the separate backup identity must remain NOLOGIN and disconnected during runtime policy finalization';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = bootstrap_admin
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'bootstrap administrator role-control memberships differ from the reviewed three-role state';
  END IF;

  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer,
         COUNT(DISTINCT migration_name)::integer,
         MAX(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
    INTO total_count, applied_count, distinct_count, last_name
    FROM public."_prisma_migrations";
  IF total_count <> 143 OR applied_count <> 143 OR distinct_count <> 143
     OR last_name <> '20261122100000_restrict_order_gig_history'
     OR EXISTS (
       SELECT 1 FROM public."_prisma_migrations"
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'migration ledger is incomplete or differs from the reviewed release';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
       AND e.objid IS NULL
       AND pg_get_userbyid(c.relowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'all non-extension application relations must be migrator-owned';
  END IF;
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role must not have CREATE on public';
  END IF;
END
$production_release_preflight$;
-- Clear only pre-existing grants to runtime/PUBLIC on application objects.
-- The conditional checks avoid PostgreSQL's harmless but noisy "no privileges
-- could be revoked" warnings on a fresh schema. Explicit matrix grants follow.
DO $runtime_acl_reset$
DECLARE
  relation_row RECORD;
  column_row RECORD;
  sequence_row RECORD;
  runtime_oid OID := (SELECT oid FROM pg_roles WHERE rolname = 'scrolith_runtime');
BEGIN
  FOR relation_row IN
    SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend e
          WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
       )
  LOOP
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(relation_row.relacl,
                           acldefault('r', relation_row.relowner))) a
       WHERE a.grantee = 0
    ) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC',
                     relation_row.nspname, relation_row.relname);
    END IF;
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(relation_row.relacl,
                           acldefault('r', relation_row.relowner))) a
       WHERE a.grantee = runtime_oid
    ) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',
                     relation_row.nspname, relation_row.relname, 'scrolith_runtime');
    END IF;
    FOR column_row IN
      SELECT a.attname, a.attacl
        FROM pg_attribute a
       WHERE a.attrelid = relation_row.oid AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attacl IS NOT NULL
         AND EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee IN (0, runtime_oid))
    LOOP
      IF EXISTS (SELECT 1 FROM aclexplode(column_row.attacl) a WHERE a.grantee = 0) THEN
        EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM PUBLIC',
                       column_row.attname, relation_row.nspname, relation_row.relname);
      END IF;
      IF EXISTS (SELECT 1 FROM aclexplode(column_row.attacl) a WHERE a.grantee = runtime_oid) THEN
        EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM %I',
                       column_row.attname, relation_row.nspname, relation_row.relname,
                       'scrolith_runtime');
      END IF;
    END LOOP;
  END LOOP;

  FOR sequence_row IN
    SELECT c.oid, n.nspname, c.relname, c.relowner, c.relacl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend e
          WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
       )
  LOOP
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(sequence_row.relacl,
                           acldefault('S', sequence_row.relowner))) a
       WHERE a.grantee = 0
    ) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC',
                     sequence_row.nspname, sequence_row.relname);
    END IF;
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(sequence_row.relacl,
                           acldefault('S', sequence_row.relowner))) a
       WHERE a.grantee = runtime_oid
    ) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM %I',
                     sequence_row.nspname, sequence_row.relname, 'scrolith_runtime');
    END IF;
  END LOOP;

  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE') THEN
    REVOKE CREATE ON SCHEMA public FROM scrolith_runtime;
  END IF;
END
$runtime_acl_reset$;

\ir scrolith-production-runtime-grants.sql

DO $verify_profile_update_allowlist$
DECLARE
  allowed_columns TEXT[] := ARRAY[
    'bio', 'certifications', 'city', 'country', 'countryCode',
    'coverPhotoUrl', 'dateOfBirth', 'educationItems', 'experienceItems',
    'formattedAddress', 'gender', 'githubUrl', 'hourlyRate', 'introVideoUrl',
    'languages', 'latitude', 'linkedinUrl', 'location', 'locationSource',
    'longitude', 'placeId', 'portfolio', 'portfolioUrl', 'postalCode',
    'region', 'showBirthMonthDayPublic', 'skills', 'state', 'title',
    'updatedAt', 'websiteUrl'
  ];
BEGIN
  IF has_table_privilege('scrolith_runtime', 'public."Profile"', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM unnest(allowed_columns) AS allowed(column_name)
        WHERE NOT has_column_privilege('scrolith_runtime', 'public."Profile"', allowed.column_name, 'UPDATE')
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns AS profile_column
        WHERE profile_column.table_schema = 'public'
          AND profile_column.table_name = 'Profile'
          AND has_column_privilege('scrolith_runtime', 'public."Profile"', profile_column.column_name, 'UPDATE')
          AND NOT profile_column.column_name = ANY(allowed_columns)
     ) THEN
    RAISE EXCEPTION 'Profile UPDATE allowlist does not match the reviewed application write paths';
  END IF;
END
$verify_profile_update_allowlist$;

DO $verify_user_update_allowlist$
DECLARE
  allowed_columns TEXT[] := ARRAY[
    'authSessionVersion', 'avatar', 'country', 'currency_preference_updated_at',
    'email', 'followOnboardingCompletedAt', 'followOnboardingRequired', 'isActive',
    'isOnline', 'isVerified', 'kycStatus', 'languagePreferencesConfirmed',
    'languagePreferencesUpdatedAt', 'lastLoginAt', 'lastSeenAt', 'loginApprovalWaivedById',
    'loginApprovalWaivedReason', 'loginApprovalWaivedUntil', 'name', 'passwordHash',
    'preferred_currency', 'profilePhotoFileId', 'refreshToken', 'role',
    'understoodLanguages', 'updatedAt', 'username'
  ];
BEGIN
  IF has_table_privilege('scrolith_runtime', 'public."User"', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM unnest(allowed_columns) AS allowed(column_name)
        WHERE NOT has_column_privilege('scrolith_runtime', 'public."User"', allowed.column_name, 'UPDATE')
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns AS user_column
        WHERE user_column.table_schema = 'public'
          AND user_column.table_name = 'User'
          AND has_column_privilege('scrolith_runtime', 'public."User"', user_column.column_name, 'UPDATE')
          AND NOT user_column.column_name = ANY(allowed_columns)
     )
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'User UPDATE allowlist or protected-table policy does not match reviewed application writes';
  END IF;
END
$verify_user_update_allowlist$;

-- Prisma inserts that use serial/identity defaults need sequence USAGE. Grant
-- only sequences owned by a table receiving INSERT; never grant setval UPDATE.
DO $runtime_sequence_grants$
DECLARE
  sequence_row RECORD;
BEGIN
  FOR sequence_row IN
    SELECT DISTINCT sequence_ns.nspname AS sequence_schema,
                    sequence_class.relname AS sequence_name
      FROM pg_class sequence_class
      JOIN pg_namespace sequence_ns ON sequence_ns.oid = sequence_class.relnamespace
      JOIN pg_depend dependency
        ON dependency.classid = 'pg_class'::regclass
       AND dependency.objid = sequence_class.oid
       AND dependency.refclassid = 'pg_class'::regclass
       AND dependency.deptype IN ('a', 'i')
       AND dependency.refobjsubid > 0
      JOIN pg_class table_class ON table_class.oid = dependency.refobjid
      JOIN pg_namespace table_ns ON table_ns.oid = table_class.relnamespace
     WHERE sequence_class.relkind = 'S'
       AND sequence_ns.nspname = 'public'
       AND table_ns.nspname = 'public'
       AND has_table_privilege('scrolith_runtime', table_class.oid, 'INSERT')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO %I',
                   sequence_row.sequence_schema, sequence_row.sequence_name, 'scrolith_runtime');
  END LOOP;
END
$runtime_sequence_grants$;

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
  relation_row RECORD;
  protected_table TEXT;
  cascade_risk_list TEXT;
  protected_tables TEXT[] := ARRAY[
    'User', 'Order', 'Wallet', 'Transaction', 'WalletFundingIntent',
    'PaymentSettlement', 'OrderPaymentIntent', 'OrderPaymentSettlement',
    'AdPayment', 'GcoinEarningEvent',
    'GcoinWallet', 'GcoinTransaction', 'GcoinConversionRequest',
    'WithdrawalRequest', 'Escrow', 'FxLock', 'FoundingPartnerProgram',
    'FoundingPartner', 'FoundingPartnerEnrollmentPayment',
    'FoundingPartnerProfitPeriod', 'FoundingPartnerProfitSource',
    'FoundingPartnerDistributionRun', 'FoundingPartnerDistribution',
    'FoundingPartnerAuditLog'
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
  IF has_table_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedBy', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'scope', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime HumanVerificationSettings UPDATE allowlist does not match its service';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public."AdPayment"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'amount', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'currency', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'status', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AdPayment"', 'adId', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime AdPayment UPDATE allowlist does not match provider reconciliation';
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
  SELECT string_agg(
           format('%I.%I -> %I.%I via %I (%s)',
                  child_ns.nspname, child.relname, parent_ns.nspname, parent.relname,
                  fk.conname,
                  CASE fk.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE 'SET DEFAULT' END),
           '; ' ORDER BY child.relname, fk.conname)
    INTO cascade_risk_list
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid = fk.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = fk.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
     WHERE fk.contype = 'f'
       AND child_ns.nspname = 'public'
       AND parent_ns.nspname = 'public'
       AND child.relname = ANY (protected_tables)
       AND fk.confdeltype IN ('c', 'n', 'd')
       AND has_table_privilege('scrolith_runtime', parent.oid, 'DELETE');
  IF cascade_risk_list IS NOT NULL THEN
    RAISE EXCEPTION 'runtime-deletable parent can cascade or rewrite protected financial/history relations: %', cascade_risk_list;
  END IF;
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
  FOR relation_row IN
    SELECT c.oid, c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend e
          WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
       )
  LOOP
    IF relation_row.relkind <> 'S' AND (
       has_table_privilege('scrolith_runtime', relation_row.oid, 'UPDATE')
       OR has_table_privilege('scrolith_runtime', relation_row.oid, 'TRUNCATE')
       OR has_table_privilege('scrolith_runtime', relation_row.oid, 'REFERENCES')
       OR has_table_privilege('scrolith_runtime', relation_row.oid, 'TRIGGER')) THEN
      RAISE EXCEPTION 'runtime has a table-level UPDATE or DDL-like privilege on public.%', relation_row.relname;
    END IF;
    IF relation_row.relkind = 'S'
       AND (has_sequence_privilege('scrolith_runtime', relation_row.oid, 'UPDATE')) THEN
      RAISE EXCEPTION 'runtime can change sequence state on public.%', relation_row.relname;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(
      (CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END), c.relowner))) a
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public' AND e.objid IS NULL AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE n.nspname = 'public' AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains explicit privileges on application relations or columns';
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
