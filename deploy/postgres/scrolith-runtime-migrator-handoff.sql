-- SOURCE TEMPLATE ONLY. Transfer an already-migrated disposable schema to the
-- non-superuser migrator role before running pending Prisma migrations.
-- Run as the database bootstrap owner/administrator, never as the runtime role.

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
\echo 'STOP: connect as the bootstrap owner to the supplied test/e2e database.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'handoff requires a bootstrap administrator and the named disposable database'; END $psql_guard_failure$;
\endif

\set application_schema 'public'
\set migrator_role 'scrolith_migrator'
SELECT current_user AS handoff_actor,
       pg_has_role(current_user, 'scrolith_migrator', 'MEMBER') AS already_member
\gset

DO $preflight$
DECLARE
  db_owner TEXT;
  actor_is_superuser BOOLEAN;
  actor_can_create_roles BOOLEAN;
BEGIN
  SELECT pg_get_userbyid(d.datdba)
    INTO db_owner
    FROM pg_database d
   WHERE d.datname = current_database();
  SELECT r.rolsuper, r.rolcreaterole
    INTO actor_is_superuser, actor_can_create_roles
    FROM pg_roles r
   WHERE r.rolname = current_user;

  IF NOT actor_is_superuser
     AND (current_user <> db_owner OR NOT actor_can_create_roles) THEN
    RAISE EXCEPTION 'handoff requires database owner with CREATEROLE or a bootstrap administrator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'scrolith_migrator'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'scrolith_migrator is missing or has excessive role attributes';
  END IF;
  IF NOT has_schema_privilege('scrolith_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'scrolith_migrator must have CREATE on public before ownership handoff';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_class'::regclass
       AND e.objid = c.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
       AND e.objid IS NULL
       AND pg_get_userbyid(c.relowner) NOT IN (current_user, 'scrolith_migrator')
  ) THEN
    RAISE EXCEPTION 'public schema contains relations owned by an unexpected role';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_type'::regclass
       AND e.objid = t.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND t.typtype IN ('d', 'e')
       AND e.objid IS NULL
       AND pg_get_userbyid(t.typowner) NOT IN (current_user, 'scrolith_migrator')
  ) THEN
    RAISE EXCEPTION 'public schema contains standalone types owned by an unexpected role';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_proc'::regclass
       AND e.objid = p.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND e.objid IS NULL
       AND pg_get_userbyid(p.proowner) NOT IN (current_user, 'scrolith_migrator')
  ) THEN
    RAISE EXCEPTION 'public schema contains routines owned by an unexpected role';
  END IF;
END
$preflight$;

BEGIN;
\if :already_member
\else
GRANT :"migrator_role" TO :"handoff_actor";
\endif

DO $transfer_relations$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT c.relkind, n.nspname, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_class'::regclass
       AND e.objid = c.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
       AND e.objid IS NULL
       AND pg_get_userbyid(c.relowner) = current_user
     ORDER BY CASE c.relkind
       WHEN 'p' THEN 0 WHEN 'r' THEN 1 WHEN 'v' THEN 2
       WHEN 'm' THEN 3 WHEN 'f' THEN 4 WHEN 'S' THEN 5 ELSE 6 END
  LOOP
    IF item.relkind IN ('r', 'p') THEN
      EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    ELSIF item.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    ELSIF item.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    ELSIF item.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    ELSIF item.relkind = 'f' THEN
      EXECUTE format('ALTER FOREIGN TABLE %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    ELSIF item.relkind = 'c' THEN
      EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', item.nspname, item.relname, 'scrolith_migrator');
    END IF;
  END LOOP;
END
$transfer_relations$;

DO $transfer_types$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT t.oid, n.nspname, t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_type'::regclass
       AND e.objid = t.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND t.typtype IN ('d', 'e')
       AND e.objid IS NULL
       AND pg_get_userbyid(t.typowner) = current_user
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', item.nspname, item.typname, 'scrolith_migrator');
  END LOOP;
END
$transfer_types$;

DO $transfer_routines$
DECLARE
  item RECORD;
  alter_verb TEXT;
BEGIN
  FOR item IN
    SELECT p.oid, p.prokind, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend e
        ON e.classid = 'pg_proc'::regclass
       AND e.objid = p.oid
       AND e.deptype = 'e'
     WHERE n.nspname = 'public'
       AND e.objid IS NULL
       AND pg_get_userbyid(p.proowner) = current_user
  LOOP
    alter_verb := CASE WHEN item.prokind = 'p' THEN 'PROCEDURE'
                       WHEN item.prokind = 'a' THEN 'AGGREGATE'
                       ELSE 'FUNCTION' END;
    EXECUTE format('ALTER %s %I.%I(%s) OWNER TO %I', alter_verb,
                   item.nspname, item.proname, item.identity_arguments,
                   'scrolith_migrator');
  END LOOP;
END
$transfer_routines$;

DO $verify_handoff$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
       AND pg_get_userbyid(c.relowner) <> 'scrolith_migrator'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend e
          WHERE e.classid = 'pg_class'::regclass
            AND e.objid = c.oid AND e.deptype = 'e'
       )
  ) THEN
    RAISE EXCEPTION 'not all non-extension public relations were transferred';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_userbyid(p.proowner) <> 'scrolith_migrator'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend e
          WHERE e.classid = 'pg_proc'::regclass
            AND e.objid = p.oid AND e.deptype = 'e'
       )
  ) THEN
    RAISE EXCEPTION 'not all non-extension public routines were transferred';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_roles r
     WHERE r.rolname = 'scrolith_runtime'
       AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
            OR r.rolreplication OR r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'runtime role is login-enabled or has a privileged role attribute before finalization';
  END IF;
END
$verify_handoff$;

\if :already_member
\else
REVOKE :"migrator_role" FROM :"handoff_actor";
\endif
COMMIT;

SELECT current_database() AS verified_database,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'scrolith_migrator') AS migrator_owned_relations,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'scrolith_runtime') AS runtime_owned_relations
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = :'application_schema'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c');
