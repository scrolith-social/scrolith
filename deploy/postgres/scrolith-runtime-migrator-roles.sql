-- SOURCE TEMPLATE ONLY. Run once or repeat before ownership handoff on a fresh,
-- explicitly disposable local test/e2e database. Never run against production.
-- The runtime role remains NOLOGIN until finalization and the separate
-- scrolith-runtime-enable.sql gate both succeed. Existing runtime sessions are
-- terminated before transitional grants are applied; invoke only from a
-- quiesced, disposable test database with sufficient session-termination rights.

\set ON_ERROR_STOP on
\set _scrolith_guard_failed true
\if :{?SCROLITH_ROLE_SETUP_APPROVED}
  \if :SCROLITH_ROLE_SETUP_APPROVED
    \set _scrolith_guard_failed false
  \else
    \echo 'STOP: set SCROLITH_ROLE_SETUP_APPROVED=true only for an isolated test/e2e database.'
  \endif
\else
  \echo 'STOP: set SCROLITH_ROLE_SETUP_APPROVED=true only for an isolated test/e2e database.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'explicit disposable-database approval is required'; END $psql_guard_failure$;
\endif

\set _scrolith_guard_failed true
\if :{?database_name}
  \set _scrolith_guard_failed false
\else
  \echo 'STOP: pass -v database_name=<fresh disposable database name>.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'database_name is required'; END $psql_guard_failure$;
\endif
SELECT CASE
         WHEN current_database() = :'database_name'
          AND current_database() ~* '(test|e2e)'
         THEN 1 ELSE 0
       END AS target_is_disposable \gset
\if :target_is_disposable
  \set _scrolith_guard_failed false
\else
  \set _scrolith_guard_failed true
\echo 'STOP: connected database must match the supplied name and include test/e2e.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'role bootstrap requires the named disposable database'; END $psql_guard_failure$;
\endif

-- If this is a repeat before finalization, refuse to make any changes after the
-- finalizer has marked the policy complete. If an older runtime role exists,
-- persistently disable login before doing any further setup work.
\set policy_finalized false
SELECT (to_regclass('public.scrolith_runtime_policy_state') IS NOT NULL) AS has_policy_state \gset
\if :has_policy_state
  SELECT COALESCE((SELECT finalized FROM public.scrolith_runtime_policy_state WHERE singleton), false) AS policy_finalized \gset
\endif
\set _scrolith_guard_failed false
\if :policy_finalized
  \set _scrolith_guard_failed true
  \echo 'STOP: runtime policy is finalized; do not rerun the compatibility-grant setup.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'runtime policy is finalized; compatibility grants are forbidden'; END $psql_guard_failure$;
\endif

DO $disable_existing_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_runtime') THEN
    EXECUTE 'ALTER ROLE scrolith_runtime NOLOGIN';
  END IF;
END
$disable_existing_runtime$;

-- NOLOGIN prevents new sessions but does not close sessions opened earlier.
-- Drain them before applying any transitional compatibility grants. If the
-- bootstrap administrator cannot terminate a session, stop before setup moves
-- forward; the operator must quiesce the app and resolve the session safely.
DO $terminate_existing_runtime_sessions$
DECLARE
  session_row RECORD;
  signaled_pids INTEGER[] := ARRAY[]::INTEGER[];
  attempts INTEGER := 0;
BEGIN
  LOOP
    FOR session_row IN
      SELECT pid
      FROM pg_stat_activity
      WHERE usename = 'scrolith_runtime'
        AND pid <> pg_backend_pid()
        AND NOT (pid = ANY(signaled_pids))
    LOOP
      -- A false return can mean the backend exited after an earlier signal;
      -- the bounded existence check below distinguishes that from a stuck one.
      PERFORM pg_terminate_backend(session_row.pid);
      signaled_pids := array_append(signaled_pids, session_row.pid);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM pg_stat_activity
      WHERE usename = 'scrolith_runtime'
        AND pid <> pg_backend_pid()
    );

    attempts := attempts + 1;
    IF attempts >= 50 THEN
      RAISE EXCEPTION 'scrolith_runtime sessions remain after termination attempts; setup stopped before compatibility grants';
    END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
END
$terminate_existing_runtime_sessions$;

BEGIN;
DO $create_or_verify_roles$
DECLARE
  runtime_exists BOOLEAN;
  migrator_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_runtime') INTO runtime_exists;
  IF NOT runtime_exists THEN
    EXECUTE 'CREATE ROLE scrolith_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  ELSE
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
      RAISE EXCEPTION 'existing scrolith_runtime attributes are not safe for pre-finalized setup';
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_migrator') INTO migrator_exists;
  IF NOT migrator_exists THEN
    EXECUTE 'CREATE ROLE scrolith_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  ELSE
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrolith_migrator'
      AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
      RAISE EXCEPTION 'existing scrolith_migrator login/attributes are not safe';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = 'scrolith_runtime'
  ) THEN
    RAISE EXCEPTION 'scrolith_runtime must not inherit or assume any other role';
  END IF;
END
$create_or_verify_roles$;

GRANT CONNECT ON DATABASE :"database_name" TO scrolith_runtime, scrolith_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, scrolith_runtime;
GRANT USAGE ON SCHEMA public TO scrolith_runtime, scrolith_migrator;
GRANT CREATE ON SCHEMA public TO scrolith_migrator;

-- Transitional compatibility grants are deliberately limited to this setup
-- phase. The finalizer removes financial/history deletes and narrows UPDATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scrolith_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scrolith_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE scrolith_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO scrolith_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE scrolith_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO scrolith_runtime;

-- A private gate row is transferred to the migrator by the handoff script.
-- Runtime receives no privileges on it. Setup is repeatable only while false.
CREATE TABLE IF NOT EXISTS public.scrolith_runtime_policy_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ
);
REVOKE ALL PRIVILEGES ON TABLE public.scrolith_runtime_policy_state FROM PUBLIC, scrolith_runtime, scrolith_migrator;
GRANT SELECT, UPDATE ON TABLE public.scrolith_runtime_policy_state TO scrolith_migrator;
INSERT INTO public.scrolith_runtime_policy_state (singleton, finalized)
VALUES (TRUE, FALSE) ON CONFLICT (singleton) DO NOTHING;
DO $assert_policy_not_finalized$
BEGIN
  IF (SELECT finalized FROM public.scrolith_runtime_policy_state WHERE singleton) THEN
    RAISE EXCEPTION 'runtime policy gate was already finalized; compatibility grants were not applied';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime') THEN
    RAISE EXCEPTION 'scrolith_runtime must remain NOLOGIN until finalizer and enable gate succeed';
  END IF;
  IF NOT has_table_privilege('scrolith_migrator', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR NOT has_table_privilege('scrolith_migrator', 'public.scrolith_runtime_policy_state', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'SELECT')
     OR has_table_privilege('scrolith_runtime', 'public.scrolith_runtime_policy_state', 'UPDATE') THEN
    RAISE EXCEPTION 'policy marker must be readable/updatable only by the migrator before finalization';
  END IF;
END
$assert_policy_not_finalized$;
COMMIT;
