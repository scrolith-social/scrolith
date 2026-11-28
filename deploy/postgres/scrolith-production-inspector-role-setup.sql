-- Creates a narrowly scoped, NOLOGIN reader for the existing-database
-- inspection report. Never use this in place of the fresh-database bootstrap.
\set ON_ERROR_STOP on
\ir scrolith-production-target-guard.sql

DO $inspector_preflight$
DECLARE
  marker_oid oid := to_regclass('public.scrolith_runtime_policy_state');
  ledger_oid oid := to_regclass('public."_prisma_migrations"');
BEGIN
  IF current_user IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_inspector')
     OR NOT EXISTS (
       SELECT 1 FROM pg_roles
        WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper
     ) THEN
    RAISE EXCEPTION 'an authorized non-superuser database role with CREATEROLE is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_migrator') THEN
    RAISE EXCEPTION 'initialized Scrolith runtime and migrator roles are required';
  END IF;
  IF marker_oid IS NULL OR ledger_oid IS NULL THEN
    RAISE EXCEPTION 'initialized runtime policy marker and Prisma ledger are required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_inspector') THEN
    RAISE EXCEPTION 'scrolith_inspector already exists; stop and inspect instead of reusing it';
  END IF;
  IF has_database_privilege('public', 'scrolith', 'CONNECT')
     OR has_database_privilege('public', 'scrolith', 'TEMPORARY') THEN
    RAISE EXCEPTION 'PUBLIC retains CONNECT or TEMPORARY on scrolith; stop and resolve the database ACL first';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND a.grantee = 0
       AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute a SECURITY DEFINER function in public; review the function ACL before creating an inspector';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) a
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND a.grantee = 0
       AND a.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC has privileges on a public sequence; review sequence ACLs before creating an inspector';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid IN (marker_oid, ledger_oid)
       AND a.grantee = 0
       AND a.privilege_type = 'SELECT'
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute att
      CROSS JOIN LATERAL aclexplode(att.attacl) a
     WHERE att.attrelid IN (marker_oid, ledger_oid)
       AND a.grantee = 0
       AND a.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can read inspection metadata; resolve the existing ACL before adding an inspector';
  END IF;
END
$inspector_preflight$;

BEGIN;
CREATE ROLE scrolith_inspector
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE scrolith TO scrolith_inspector;
GRANT USAGE ON SCHEMA public TO scrolith_inspector;
GRANT SELECT (
  singleton,
  source_commit,
  migration_count,
  last_migration,
  ownership_verified,
  finalized,
  finalized_at,
  bootstrap_admin_role
) ON TABLE public.scrolith_runtime_policy_state TO scrolith_inspector;
GRANT SELECT (
  migration_name,
  finished_at,
  rolled_back_at
) ON TABLE public."_prisma_migrations" TO scrolith_inspector;
DO $inspector_assertions$
DECLARE
  marker_oid oid := 'public.scrolith_runtime_policy_state'::regclass;
  ledger_oid oid := 'public."_prisma_migrations"'::regclass;
  marker_columns name[];
  ledger_columns name[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_inspector' AND NOT rolcanlogin
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'inspector role attributes are broader than the NOLOGIN policy';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members m
       WHERE m.roleid = 'scrolith_inspector'::regrole
          OR m.member = 'scrolith_inspector'::regrole) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_auth_members m
        WHERE m.roleid = 'scrolith_inspector'::regrole
          AND m.member = current_user::regrole
          AND m.admin_option
          AND NOT m.inherit_option
          AND NOT m.set_option
     ) THEN
    -- PostgreSQL 16+ gives the CREATEROLE creator a non-inheriting ADMIN
    -- membership on the new role. Require exactly that management edge only.
    RAISE EXCEPTION 'inspector membership must be only the creator ADMIN edge assigned by PostgreSQL';
  END IF;
  IF NOT has_database_privilege('scrolith_inspector', 'scrolith', 'CONNECT')
     OR has_database_privilege('scrolith_inspector', 'scrolith', 'CREATE')
     OR has_database_privilege('scrolith_inspector', 'scrolith', 'TEMPORARY')
     OR NOT has_schema_privilege('scrolith_inspector', 'public', 'USAGE')
     OR has_schema_privilege('scrolith_inspector', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'database or schema privileges differ from the inspector allowlist';
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
    RAISE EXCEPTION 'inspector has an unapproved SECURITY DEFINER function or sequence privilege';
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
     OR has_table_privilege('scrolith_inspector', marker_oid, 'SELECT')
     OR has_table_privilege('scrolith_inspector', ledger_oid, 'SELECT')
     OR has_table_privilege('scrolith_inspector', marker_oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('scrolith_inspector', ledger_oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'inspection table/column privileges differ from the exact allowlist';
  END IF;
  IF has_table_privilege('scrolith_inspector', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
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
    RAISE EXCEPTION 'inspector has privileges on application or unapproved relations';
  END IF;
END
$inspector_assertions$;
COMMIT;

\echo 'Inspector role created NOLOGIN with column-scoped report access; no login was enabled.'
