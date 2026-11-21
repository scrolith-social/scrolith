-- Run after Prisma migrate deploy succeeds. This transaction verifies the
-- applied ledger/object owners and only then creates the protected marker.
-- Creating the marker now keeps the configured Prisma schema empty before
-- migrate deploy, avoiding Prisma P3005.
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

-- psql does not interpolate variables inside dollar-quoted SQL bodies.
SELECT set_config('scrolith.bootstrap_admin_role', :'bootstrap_admin_role', false);
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);

DO $ownership_handoff_preflight$
DECLARE
  applied_count INTEGER;
  total_count INTEGER;
  distinct_count INTEGER;
  last_name TEXT;
  migrator_oid OID;
  runtime_oid OID;
  backup_oid OID;
  public_oid OID;
  table_privilege_count INTEGER;
  sequence_privilege_count INTEGER;
BEGIN
  IF current_user <> 'scrolith_migrator'
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_migrator')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime')
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_backup') THEN
    RAISE EXCEPTION 'ownership verification must run as migrator while runtime remains NOLOGIN';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Prisma migration ledger is missing';
  END IF;
  IF to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL THEN
    RAISE EXCEPTION 'policy marker already exists; stop and inspect instead of reusing it';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_setting('scrolith.bootstrap_admin_role')
       AND rolcreaterole
       AND pg_has_role(rolname, 'azure_pg_admin', 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'stored bootstrap administrator is not a Flexible Server role administrator';
  END IF;
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
    RAISE EXCEPTION 'expected exactly 143 fully applied migrations ending at the reviewed release migration';
  END IF;

  SELECT oid INTO migrator_oid FROM pg_roles WHERE rolname = 'scrolith_migrator';
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname = 'scrolith_runtime';
  SELECT oid INTO backup_oid FROM pg_roles WHERE rolname = 'scrolith_backup';
  SELECT oid INTO public_oid FROM pg_namespace WHERE nspname = 'public';
  SELECT COUNT(*)::integer INTO table_privilege_count
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
     AND d.defaclobjtype = 'r' AND a.grantee = runtime_oid
     AND NOT a.is_grantable
     AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  SELECT COUNT(*)::integer INTO sequence_privilege_count
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
     AND d.defaclobjtype = 'S' AND a.grantee = runtime_oid
     AND NOT a.is_grantable
     AND a.privilege_type IN ('USAGE', 'SELECT', 'UPDATE');
  IF table_privilege_count <> 0 OR sequence_privilege_count <> 0 THEN
    RAISE EXCEPTION 'runtime default privileges are not empty before finalization';
  END IF;
  IF (SELECT COUNT(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
         AND d.defaclobjtype = 'r' AND a.grantee = backup_oid AND NOT a.is_grantable
         AND a.privilege_type IN ('SELECT', 'INSERT', 'TRUNCATE')) <> 3
     OR (SELECT COUNT(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclrole = migrator_oid AND d.defaclnamespace = public_oid
         AND d.defaclobjtype = 'S' AND a.grantee = backup_oid AND NOT a.is_grantable
         AND a.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')) <> 3 THEN
    RAISE EXCEPTION 'optional backup default privileges differ from the reviewed policy';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
      AND e.objid IS NULL
      AND pg_get_userbyid(c.relowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'a non-extension public relation is not owned by scrolith_migrator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public' AND e.objid IS NULL
      AND pg_get_userbyid(p.proowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'a non-extension public routine is not owned by scrolith_migrator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_type'::regclass AND e.objid = t.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e')
      AND e.objid IS NULL
      AND pg_get_userbyid(t.typowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'a non-extension standalone type is not owned by scrolith_migrator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime must not own schema objects';
  END IF;
END
$ownership_handoff_preflight$;

BEGIN;
CREATE TABLE public.scrolith_runtime_policy_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  source_commit TEXT NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  bootstrap_admin_role TEXT NOT NULL,
  migration_count INTEGER NOT NULL CHECK (migration_count = 143),
  last_migration TEXT NOT NULL CHECK (last_migration = '20261122100000_restrict_order_gig_history'),
  ownership_verified BOOLEAN NOT NULL DEFAULT FALSE,
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.scrolith_runtime_policy_state
  (singleton, source_commit, bootstrap_admin_role, migration_count, last_migration)
VALUES
  (TRUE, current_setting('scrolith.expected_source_commit'),
   current_setting('scrolith.bootstrap_admin_role'), 143,
   '20261122100000_restrict_order_gig_history');
-- The marker inherits the optional backup role's default ACL. Remove that
-- grant explicitly; PUBLIC and runtime receive no default table privileges.
REVOKE ALL PRIVILEGES ON TABLE public.scrolith_runtime_policy_state
  FROM scrolith_backup;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations"
  FROM scrolith_backup;
GRANT SELECT ON TABLE public.scrolith_runtime_policy_state
  TO :"bootstrap_admin_role";
-- The separate administrator enable step reads the ledger itself before it
-- changes role LOGIN flags. Give that operator SELECT only, never DML or DDL.
GRANT SELECT ON TABLE public."_prisma_migrations"
  TO :"bootstrap_admin_role";

DO $ownership_handoff_marker$
DECLARE
  changed_rows INTEGER;
BEGIN
  IF pg_get_userbyid((
       SELECT c.relowner FROM pg_class c
        WHERE c.oid = 'public.scrolith_runtime_policy_state'::regclass
     )) <> 'scrolith_migrator' THEN
    RAISE EXCEPTION 'policy marker is not owned by scrolith_migrator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scrolith_runtime_policy_state
     WHERE singleton
       AND source_commit = current_setting('scrolith.expected_source_commit')
       AND bootstrap_admin_role = current_setting('scrolith.bootstrap_admin_role')
       AND migration_count = 143
       AND last_migration = '20261122100000_restrict_order_gig_history'
       AND NOT ownership_verified AND NOT finalized AND finalized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'policy marker is missing, mismatched, or already advanced';
  END IF;
  IF has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'DELETE')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'INSERT')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'DELETE')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'TRUNCATE')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'REFERENCES')
     OR has_table_privilege('scrolith_backup', 'public.scrolith_runtime_policy_state', 'TRIGGER')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'SELECT')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'INSERT')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'UPDATE')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'DELETE')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'TRUNCATE')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'REFERENCES')
     OR has_table_privilege('scrolith_backup', 'public."_prisma_migrations"', 'TRIGGER') THEN
    RAISE EXCEPTION 'runtime policy marker or Prisma ledger is accessible to an application role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(
      (CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END), c.relowner))) a
    WHERE n.nspname = 'public' AND c.relname IN ('scrolith_runtime_policy_state', '_prisma_migrations')
      AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have privileges on the policy marker or Prisma migration ledger';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend e
      ON e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
      AND e.objid IS NULL
      AND pg_get_userbyid(c.relowner) <> 'scrolith_migrator'
  ) THEN
    RAISE EXCEPTION 'post-migration public relation ownership differs from scrolith_migrator';
  END IF;

  UPDATE public.scrolith_runtime_policy_state
     SET ownership_verified = TRUE
   WHERE singleton
     AND source_commit = current_setting('scrolith.expected_source_commit')
     AND NOT ownership_verified AND NOT finalized;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'ownership verification marker was not advanced';
  END IF;
END
$ownership_handoff_marker$;
COMMIT;

SELECT source_commit, bootstrap_admin_role, migration_count, last_migration,
       ownership_verified, finalized
  FROM public.scrolith_runtime_policy_state
 WHERE singleton;
