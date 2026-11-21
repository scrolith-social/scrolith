-- First stage for a NEW, EMPTY Azure PostgreSQL Flexible Server 17 database.
-- Run as the server administrator, with explicit change approval.
-- Create runtime, migrator, and optional system-backup roles as NOLOGIN. The
-- backup identity remains disabled unless separately approved and configured.
\ir scrolith-production-target-guard.sql

DO $bootstrap_preflight$
DECLARE
  admin_can_create_roles BOOLEAN;
  admin_is_azure_pg_admin BOOLEAN;
  existing_app_objects BOOLEAN;
BEGIN
  IF current_user IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup') THEN
    RAISE EXCEPTION 'connect as the Azure PostgreSQL server administrator';
  END IF;

  SELECT rolcreaterole
    INTO admin_can_create_roles
    FROM pg_roles
   WHERE rolname = current_user;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'azure_pg_admin')
         AND pg_has_role(current_user, 'azure_pg_admin', 'MEMBER')
    INTO admin_is_azure_pg_admin;

  IF NOT COALESCE(admin_can_create_roles, false) OR NOT admin_is_azure_pg_admin THEN
    RAISE EXCEPTION 'bootstrap requires the Flexible Server administrator with CREATEROLE and azure_pg_admin membership';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_database d
     WHERE d.datname = current_database()
       AND pg_get_userbyid(d.datdba) = current_user
  ) THEN
    RAISE EXCEPTION 'bootstrap administrator must own the fresh database';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')) THEN
    RAISE EXCEPTION 'one or more Scrolith roles already exist; stop and inspect instead of reusing them';
  END IF;

  IF to_regclass('public._prisma_migrations') IS NOT NULL
     OR to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL THEN
    RAISE EXCEPTION 'database already has a migration ledger or Scrolith policy marker';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_class'::regclass
       AND e.objid = c.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND e.objid IS NULL
  ) INTO existing_app_objects;

  IF existing_app_objects THEN
    RAISE EXCEPTION 'public schema is not empty; this bootstrap is only for the reviewed fresh database';
  END IF;
END
$bootstrap_preflight$;

BEGIN;
CREATE ROLE scrolith_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE scrolith_migrator
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE scrolith_backup
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE scrolith TO scrolith_runtime, scrolith_migrator, scrolith_backup;
DO $bootstrap_public_acl$
DECLARE
  database_acl ACLITEM[];
  schema_acl ACLITEM[];
BEGIN
  SELECT COALESCE(datacl, acldefault('d', datdba)) INTO database_acl
    FROM pg_database WHERE datname = current_database();
  IF EXISTS (
    SELECT 1 FROM aclexplode(database_acl) a
     WHERE a.grantee = 0 AND a.privilege_type IN ('CONNECT', 'TEMPORARY')
  ) THEN
    EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  END IF;

  SELECT COALESCE(nspacl, acldefault('n', nspowner)) INTO schema_acl
    FROM pg_namespace WHERE nspname = 'public';
  IF EXISTS (
    SELECT 1 FROM aclexplode(schema_acl) a
     WHERE a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
  END IF;
END
$bootstrap_public_acl$;
GRANT USAGE ON SCHEMA public TO scrolith_runtime, scrolith_migrator, scrolith_backup;
GRANT CREATE ON SCHEMA public TO scrolith_migrator;

DO $bootstrap_verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup') AND rolcanlogin) THEN
    RAISE EXCEPTION 'runtime, migrator, and backup roles must remain NOLOGIN after bootstrap';
  END IF;
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE')
     OR NOT has_schema_privilege('scrolith_migrator', 'public', 'CREATE')
     OR NOT has_schema_privilege('scrolith_runtime', 'public', 'USAGE')
     OR NOT has_database_privilege('scrolith_runtime', current_database(), 'CONNECT')
     OR NOT has_database_privilege('scrolith_migrator', current_database(), 'CONNECT')
     OR NOT has_database_privilege('scrolith_backup', current_database(), 'CONNECT')
     OR has_schema_privilege('scrolith_backup', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'initial role grants do not match the fail-closed bootstrap policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
       OR (granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
           AND (member_role.rolname <> current_user
                OR NOT m.admin_option OR m.inherit_option OR m.set_option))
  ) THEN
    RAISE EXCEPTION 'application roles may only have the creating administrator as admin-only member';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = current_user
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'creating administrator must hold only non-inheriting, non-SET admin membership on all three application roles';
  END IF;
  IF has_database_privilege('scrolith_runtime', current_database(), 'TEMP')
     OR has_database_privilege('scrolith_migrator', current_database(), 'TEMP')
     OR has_database_privilege('scrolith_backup', current_database(), 'TEMP') THEN
    RAISE EXCEPTION 'application roles must not inherit TEMPORARY from PUBLIC';
  END IF;
END
$bootstrap_verify$;
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
  FROM pg_roles
 WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
 ORDER BY rolname;
