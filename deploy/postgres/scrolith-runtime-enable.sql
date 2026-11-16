-- SOURCE TEMPLATE ONLY. Run as the protected database bootstrap administrator
-- only after migrations, ownership handoff, and the policy finalizer succeed.
-- This is the sole step that enables the runtime role to accept connections.

\set ON_ERROR_STOP on
\set _scrolith_guard_failed true
\if :{?SCROLITH_ROLE_SETUP_APPROVED}
  \if :SCROLITH_ROLE_SETUP_APPROVED
    \set _scrolith_guard_failed false
  \else
    \echo 'STOP: explicit disposable-database approval is required for local verification.'
  \endif
\else
  \echo 'STOP: explicit disposable-database approval is required for local verification.'
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
          AND current_user NOT IN ('scrolith_runtime', 'scrolith_migrator')
         THEN 1 ELSE 0
       END AS target_is_safe \gset
\if :target_is_safe
  \set _scrolith_guard_failed false
\else
  \set _scrolith_guard_failed true
\echo 'STOP: only a separate bootstrap administrator may enable runtime on the named test/e2e database.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'enable requires the named disposable database and a separate bootstrap administrator'; END $psql_guard_failure$;
\endif

BEGIN;
DO $verify_finalized_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scrolith_runtime_policy_state
     WHERE singleton AND finalized AND finalized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'runtime policy finalizer has not completed; runtime remains NOLOGIN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_runtime'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'runtime role is missing or has unsafe role attributes';
  END IF;
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public._prisma_migrations', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public."AdPayment"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."GcoinEarningEvent"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."FoundingPartnerAuditLog"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."AppSetting"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'updatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'scope', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."AppSetting"', 'id', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'data', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedBy', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'updatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'scope', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."HumanVerificationSettings"', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime grants do not satisfy the finalized least-privilege checks';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime unexpectedly belongs to another role';
  END IF;
END
$verify_finalized_policy$;

ALTER ROLE scrolith_runtime LOGIN;
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
  FROM pg_roles WHERE rolname = 'scrolith_runtime';
