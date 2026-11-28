-- Guarded cleanup of only the dedicated inspection role's approved grants.
\set ON_ERROR_STOP on
\ir scrolith-production-target-guard.sql

BEGIN;
DO $inspector_cleanup_preflight$
DECLARE
  marker_oid oid := 'public.scrolith_runtime_policy_state'::regclass;
  ledger_oid oid := 'public."_prisma_migrations"'::regclass;
  marker_columns name[];
  ledger_columns name[];
BEGIN
  IF current_user IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_inspector')
     OR NOT EXISTS (
       SELECT 1 FROM pg_roles
        WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper
     ) THEN
    RAISE EXCEPTION 'an authorized non-superuser database role with CREATEROLE is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_inspector' AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'scrolith_inspector is missing or has unexpected attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'scrolith_inspector') THEN
    RAISE EXCEPTION 'inspector sessions are active; stop the job and retry after they exit';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members m
       WHERE m.roleid = 'scrolith_inspector'::regrole
          OR m.member = 'scrolith_inspector'::regrole) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_auth_members m
        WHERE m.roleid = 'scrolith_inspector'::regrole
          AND m.admin_option
          AND NOT m.inherit_option
          AND NOT m.set_option
     ) THEN
    RAISE EXCEPTION 'inspector membership differs from the sole creator ADMIN edge; inspect manually';
  END IF;
  IF has_database_privilege('scrolith_inspector', 'scrolith', 'CREATE')
     OR has_database_privilege('scrolith_inspector', 'scrolith', 'TEMPORARY')
     OR NOT has_database_privilege('scrolith_inspector', 'scrolith', 'CONNECT')
     OR has_schema_privilege('scrolith_inspector', 'public', 'CREATE')
     OR NOT has_schema_privilege('scrolith_inspector', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'inspector database/schema ACL drift; refuse cleanup';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND has_function_privilege('scrolith_inspector', p.oid, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND CASE WHEN c.relkind = 'S'
                THEN has_sequence_privilege('scrolith_inspector', c.oid, 'USAGE,SELECT,UPDATE')
                ELSE false END
  ) THEN
    RAISE EXCEPTION 'inspector has an unapproved SECURITY DEFINER function or sequence privilege; refuse cleanup';
  END IF;
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attnum), ARRAY[]::name[])
    INTO marker_columns
    FROM pg_attribute att
   WHERE att.attrelid = marker_oid AND att.attnum > 0 AND NOT att.attisdropped
     AND has_column_privilege('scrolith_inspector', marker_oid, att.attname, 'SELECT');
  SELECT COALESCE(array_agg(att.attname ORDER BY att.attnum), ARRAY[]::name[])
    INTO ledger_columns
    FROM pg_attribute att
   WHERE att.attrelid = ledger_oid AND att.attnum > 0 AND NOT att.attisdropped
     AND has_column_privilege('scrolith_inspector', ledger_oid, att.attname, 'SELECT');
  IF marker_columns <> ARRAY[
       'singleton', 'source_commit', 'migration_count', 'last_migration',
       'ownership_verified', 'finalized', 'finalized_at', 'bootstrap_admin_role'
     ]::name[]
     OR ledger_columns <> ARRAY['migration_name', 'finished_at', 'rolled_back_at']::name[]
     OR has_table_privilege('scrolith_inspector', marker_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('scrolith_inspector', ledger_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('scrolith_inspector', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR EXISTS (
       SELECT 1 FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname NOT IN ('scrolith_runtime_policy_state', '_prisma_migrations')
         AND has_table_privilege('scrolith_inspector', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     ) OR EXISTS (
       SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(privilege_name)
        WHERE n.nspname = 'public'
          AND c.relname NOT IN ('scrolith_runtime_policy_state', '_prisma_migrations')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('scrolith_inspector', a.attrelid, a.attnum, p.privilege_name)
     ) OR EXISTS (
       SELECT 1
         FROM pg_attribute a
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(privilege_name)
        WHERE a.attrelid = 'public."User"'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('scrolith_inspector', a.attrelid, a.attnum, p.privilege_name)
     ) OR EXISTS (
       SELECT 1
         FROM pg_attribute a
         CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) p(privilege_name)
        WHERE a.attrelid IN (marker_oid, ledger_oid)
          AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('scrolith_inspector', a.attrelid, a.attnum, p.privilege_name)
     ) THEN
    RAISE EXCEPTION 'inspector ACL state differs from the exact setup allowlist; refuse cleanup';
  END IF;
END
$inspector_cleanup_preflight$;

ALTER ROLE scrolith_inspector NOLOGIN;
REVOKE SELECT (
  singleton, source_commit, migration_count, last_migration,
  ownership_verified, finalized, finalized_at, bootstrap_admin_role
) ON TABLE public.scrolith_runtime_policy_state FROM scrolith_inspector;
REVOKE SELECT (migration_name, finished_at, rolled_back_at)
  ON TABLE public."_prisma_migrations" FROM scrolith_inspector;
REVOKE USAGE ON SCHEMA public FROM scrolith_inspector;
REVOKE CONNECT ON DATABASE scrolith FROM scrolith_inspector;
DROP ROLE scrolith_inspector;
COMMIT;

\echo 'Inspector role and only its reviewed grants were removed.'
