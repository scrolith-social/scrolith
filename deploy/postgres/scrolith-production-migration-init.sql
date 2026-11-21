-- Run as scrolith_migrator before prisma migrate deploy. This step sets only
-- the object's default privileges; it deliberately creates no public-schema
-- objects so Prisma can initialize a truly empty schema (P3005).
\ir scrolith-production-target-guard.sql

\set _admin_role_missing true
\if :{?bootstrap_admin_role}
  \set _admin_role_missing false
\endif
\if :_admin_role_missing
DO $guard$ BEGIN RAISE EXCEPTION 'bootstrap_admin_role psql variable is required'; END $guard$;
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_roles
   WHERE rolname = :'bootstrap_admin_role'
     AND rolcreaterole
     AND pg_has_role(rolname, 'azure_pg_admin', 'MEMBER')
     AND rolname NOT IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
) AS _bootstrap_admin_valid \gset
\if :_bootstrap_admin_valid
\else
DO $guard$ BEGIN RAISE EXCEPTION 'bootstrap_admin_role is not a verified Flexible Server administrator'; END $guard$;
\endif

-- psql does not interpolate variables inside dollar-quoted SQL bodies. Save the
-- already-validated role identifier as a session setting for guarded DO blocks.
SELECT set_config('scrolith.bootstrap_admin_role', :'bootstrap_admin_role', false);
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);

DO $migration_init_preflight$
DECLARE
  migrator_oid OID;
  runtime_oid OID;
  backup_oid OID;
  public_oid OID;
BEGIN
  IF current_user <> 'scrolith_migrator'
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_migrator')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_backup') THEN
    RAISE EXCEPTION 'initialize as LOGIN scrolith_migrator while runtime remains NOLOGIN';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'migration ledger already exists; initialize defaults before migration deploy';
  END IF;
  IF to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL THEN
    RAISE EXCEPTION 'policy marker already exists; do not reuse or repair a partial bootstrap';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND e.objid IS NULL
  ) THEN
    RAISE EXCEPTION 'public schema must remain empty until Prisma migration deploy';
  END IF;

  SELECT oid INTO migrator_oid FROM pg_roles WHERE rolname = 'scrolith_migrator';
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname = 'scrolith_runtime';
  SELECT oid INTO backup_oid FROM pg_roles WHERE rolname = 'scrolith_backup';
  SELECT oid INTO public_oid FROM pg_namespace WHERE nspname = 'public';

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
       OR (granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
           AND (member_role.rolname <> current_setting('scrolith.bootstrap_admin_role')
                OR NOT m.admin_option OR m.inherit_option OR m.set_option))
  ) THEN
    RAISE EXCEPTION 'application role memberships changed after bootstrap';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = current_setting('scrolith.bootstrap_admin_role')
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'bootstrap administrator role membership does not match the safe three-role CREATEROLE pattern';
  END IF;
  IF NOT has_schema_privilege('scrolith_migrator', 'public', 'CREATE')
     OR has_schema_privilege('scrolith_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'schema CREATE grants are not in the expected bootstrap state';
  END IF;

  -- Runtime receives no migration-created object privileges until the
  -- finalizer applies the explicit operation matrix. Backup remains optional.
  IF migrator_oid IS NULL OR runtime_oid IS NULL OR backup_oid IS NULL OR public_oid IS NULL THEN
    RAISE EXCEPTION 'required role or public schema is missing';
  END IF;
END
$migration_init_preflight$;

BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM scrolith_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM scrolith_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM scrolith_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM scrolith_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, TRUNCATE ON TABLES TO scrolith_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO scrolith_backup;

DO $migration_init_verify$
DECLARE
  migrator_oid OID;
  runtime_oid OID;
  backup_oid OID;
  public_oid OID;
  table_privilege_count INTEGER;
  sequence_privilege_count INTEGER;
BEGIN
  SELECT oid INTO migrator_oid FROM pg_roles WHERE rolname = 'scrolith_migrator';
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname = 'scrolith_runtime';
  SELECT oid INTO backup_oid FROM pg_roles WHERE rolname = 'scrolith_backup';
  SELECT oid INTO public_oid FROM pg_namespace WHERE nspname = 'public';

  SELECT COUNT(*)::integer INTO table_privilege_count
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = migrator_oid
     AND d.defaclnamespace = public_oid
     AND d.defaclobjtype = 'r'
     AND a.grantee = runtime_oid
     AND NOT a.is_grantable
     AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  SELECT COUNT(*)::integer INTO sequence_privilege_count
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = migrator_oid
     AND d.defaclnamespace = public_oid
     AND d.defaclobjtype = 'S'
     AND a.grantee = runtime_oid
     AND NOT a.is_grantable
     AND a.privilege_type IN ('USAGE', 'SELECT', 'UPDATE');

  IF table_privilege_count <> 0 OR sequence_privilege_count <> 0 THEN
    RAISE EXCEPTION 'runtime default privileges must remain empty until explicit finalization';
  END IF;
  IF (SELECT COUNT(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
         AND d.defaclobjtype = 'r' AND a.grantee = backup_oid AND NOT a.is_grantable
         AND a.privilege_type IN ('SELECT', 'INSERT', 'TRUNCATE')) <> 3
     OR (SELECT COUNT(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
         AND d.defaclobjtype = 'S' AND a.grantee = backup_oid AND NOT a.is_grantable
         AND a.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')) <> 3 THEN
    RAISE EXCEPTION 'optional backup default privileges differ from its reviewed policy';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL
     OR to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-migration initialization unexpectedly created a public object';
  END IF;
  IF current_setting('scrolith.expected_source_commit') !~ '^[0-9a-f]{40}$'
     OR current_setting('scrolith.bootstrap_admin_role') IS NULL THEN
    RAISE EXCEPTION 'release or bootstrap context was lost';
  END IF;
END
$migration_init_verify$;
COMMIT;

SELECT 'default privileges ready; public schema remains empty for Prisma migrate deploy' AS result;
