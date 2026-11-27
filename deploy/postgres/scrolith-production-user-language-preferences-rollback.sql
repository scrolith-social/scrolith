-- Existing initialized database only. Revoke only the three language-preference
-- UPDATE columns introduced by the focused incremental procedure.
\ir scrolith-production-target-guard.sql

\set _policy_commit_missing true
\if :{?expected_policy_source_commit}
  \set _policy_commit_missing false
\endif
\if :_policy_commit_missing
DO $guard$ BEGIN RAISE EXCEPTION 'expected_policy_source_commit is required for the existing finalized marker'; END $guard$;
\endif

SELECT (:'expected_policy_source_commit' ~ '^[0-9a-f]{40}$') AS _policy_commit_valid \gset
\if :_policy_commit_valid
\else
DO $guard$ BEGIN RAISE EXCEPTION 'expected_policy_source_commit must be a 40-character lowercase Git SHA'; END $guard$;
\endif
SELECT set_config('scrolith.expected_policy_source_commit', :'expected_policy_source_commit', false);

BEGIN;
SELECT set_config('scrolith.user_language_update_state', 'all', true);
\ir scrolith-production-user-language-preferences-preflight.sql

REVOKE UPDATE ("languagePreferencesConfirmed", "languagePreferencesUpdatedAt", "understoodLanguages")
  ON TABLE public."User" FROM scrolith_runtime;

SELECT set_config('scrolith.user_language_update_state', 'none', true);
\ir scrolith-production-user-language-preferences-preflight.sql
COMMIT;

\echo 'Incremental User language-preference rollback completed; pre-existing User grants were preserved.'
