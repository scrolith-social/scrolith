-- Separate step: enable only the migration identity after its credential has
-- been entered with psql password and stored through the approved Key Vault UI.
\ir scrolith-production-target-guard.sql

DO $migrator_enable_preflight$
DECLARE
  admin_can_create_roles BOOLEAN;
BEGIN
  IF current_user IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup') THEN
    RAISE EXCEPTION 'migrator login enablement requires the separate server administrator';
  END IF;
  SELECT rolcreaterole INTO admin_can_create_roles
    FROM pg_roles WHERE rolname = current_user;
  IF NOT COALESCE(admin_can_create_roles, false)
     OR NOT pg_has_role(current_user, 'azure_pg_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'migrator login enablement requires the Flexible Server administrator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_runtime'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_migrator'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_backup'
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'runtime, migrator, and optional backup roles must be in the expected NOLOGIN least-privilege state';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL
     OR to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL THEN
    RAISE EXCEPTION 'migrations or policy setup already started; do not enable migrator through bootstrap';
  END IF;
  IF has_schema_privilege('scrolith_runtime', 'public', 'CREATE')
     OR NOT has_schema_privilege('scrolith_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'schema grants do not match the reviewed bootstrap';
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
    RAISE EXCEPTION 'application roles may only have the current administrator as admin-only member';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = current_user
      AND granted_role.rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) <> 3 THEN
    RAISE EXCEPTION 'current administrator does not have the expected admin-only membership for all three application roles';
  END IF;
END
$migrator_enable_preflight$;

BEGIN;
ALTER ROLE scrolith_migrator LOGIN;
DO $migrator_enable_verify$
BEGIN
  IF NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_migrator')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_backup') THEN
    RAISE EXCEPTION 'only migrator may be LOGIN before production role finalization';
  END IF;
END
$migrator_enable_verify$;
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
  FROM pg_roles
 WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator', 'scrolith_backup')
 ORDER BY rolname;
