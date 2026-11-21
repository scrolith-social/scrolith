-- This is the sole production step that enables runtime login. It disables the
-- one-shot migrator and enables runtime in one transaction after every gate.
\ir scrolith-production-target-guard.sql
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);

BEGIN;
DO $production_enable_checks$
DECLARE
  applied_count INTEGER;
  total_count INTEGER;
  distinct_count INTEGER;
  last_name TEXT;
  bootstrap_admin TEXT;
  protected_table TEXT;
  cascade_risk_list TEXT;
  protected_tables TEXT[] := ARRAY[
    'User', 'Order', 'Wallet', 'Transaction', 'WalletFundingIntent',
    'PaymentSettlement', 'OrderPaymentIntent', 'OrderPaymentSettlement',
    'AdPayment', 'GcoinEarningEvent', 'GcoinWallet', 'GcoinTransaction',
    'GcoinConversionRequest', 'WithdrawalRequest', 'Escrow', 'FxLock',
    'FoundingPartnerProgram', 'FoundingPartner',
    'FoundingPartnerEnrollmentPayment', 'FoundingPartnerProfitPeriod',
    'FoundingPartnerProfitSource', 'FoundingPartnerDistributionRun',
    'FoundingPartnerDistribution', 'FoundingPartnerAuditLog'
  ];
BEGIN
  IF current_user IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup') THEN
    RAISE EXCEPTION 'runtime enable requires the separate Flexible Server administrator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND rolcreaterole
  ) OR NOT pg_has_role(current_user, 'azure_pg_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'runtime enable requires the Flexible Server administrator';
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
    RAISE EXCEPTION 'migration ledger is incomplete or differs from this release';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.scrolith_runtime_policy_state
     WHERE singleton
       AND source_commit = current_setting('scrolith.expected_source_commit')
       AND migration_count = 143
       AND last_migration = '20261122100000_restrict_order_gig_history'
       AND ownership_verified
       AND finalized
       AND finalized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'migration ownership handoff and policy finalizer have not committed for this release';
  END IF;
  SELECT bootstrap_admin_role INTO bootstrap_admin
    FROM public.scrolith_runtime_policy_state WHERE singleton;
  IF bootstrap_admin IS NULL OR bootstrap_admin <> current_user THEN
    RAISE EXCEPTION 'runtime login must be enabled by the same administrator that bootstrapped the roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_runtime'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_migrator'
       AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_backup'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'runtime/migrator role attributes are not in the expected pre-enable state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE r.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
       OR (granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
           AND (r.rolname <> bootstrap_admin
                OR NOT m.admin_option OR m.inherit_option OR m.set_option))
  ) THEN
    RAISE EXCEPTION 'unexpected runtime/migrator membership or privilege-bearing administrator membership';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = bootstrap_admin
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'bootstrap administrator no longer has the expected three-role admin-only control';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')) THEN
    RAISE EXCEPTION 'application-role sessions remain; stop the migration or backup job and retry';
  END IF;

  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE')
     OR has_database_privilege('scrolith_runtime', current_database(), 'TEMP')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'DELETE') THEN
    RAISE EXCEPTION 'runtime retains DDL, policy-marker, or migration-ledger access';
  END IF;

  FOREACH protected_table IN ARRAY protected_tables LOOP
    IF to_regclass(format('%I.%I', 'public', protected_table)) IS NULL THEN
      RAISE EXCEPTION 'expected relation public.% is missing', protected_table;
    END IF;
    IF has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'DELETE')
       OR has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'TRUNCATE')
       OR has_table_privilege('scrolith_runtime', format('%I.%I', 'public', protected_table), 'TRIGGER') THEN
      RAISE EXCEPTION 'runtime retains prohibited DELETE/TRUNCATE/TRIGGER on public.%', protected_table;
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

  IF has_table_privilege('scrolith_runtime', 'public."AppSetting"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."WithdrawalRequest"', 'details', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."WalletFundingIntent"', 'fxLockId', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."OrderPaymentIntent"', 'fxLockId', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."WalletFundingIntent"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."OrderPaymentIntent"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Transaction"', 'amount', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'value', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime column-level privilege checks failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'scrolith_runtime'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime owns a relation or routine';
  END IF;
END
$production_enable_checks$;

ALTER ROLE scrolith_migrator NOLOGIN;
ALTER ROLE scrolith_runtime LOGIN;
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
  FROM pg_roles
 WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator')
 ORDER BY rolname;
