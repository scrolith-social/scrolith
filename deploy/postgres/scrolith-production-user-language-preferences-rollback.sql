-- Reversible rollback for the focused User language-preference UPDATE columns.
-- Run only from the existing approved PostgreSQL migrator session through psql.
-- Required variables are checked by the shared production target guard.
\ir scrolith-production-target-guard.sql
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);

BEGIN;
DO $user_language_rollback_preflight$
BEGIN
  IF current_user <> 'scrolith_migrator'
     OR NOT EXISTS (
       SELECT 1 FROM public.scrolith_runtime_policy_state
        WHERE singleton AND finalized
          AND source_commit = current_setting('scrolith.expected_source_commit')
     ) THEN
    RAISE EXCEPTION 'User language-preference rollback requires the finalized policy created by the declared release';
  END IF;
END
$user_language_rollback_preflight$;

REVOKE UPDATE ("languagePreferencesConfirmed", "languagePreferencesUpdatedAt", "understoodLanguages")
  ON TABLE public."User" FROM scrolith_runtime;

DO $user_language_rollback_assertions$
BEGIN
  IF has_table_privilege('scrolith_runtime', 'public."User"', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."User"', 'languagePreferencesConfirmed', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."User"', 'languagePreferencesUpdatedAt', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."User"', 'understoodLanguages', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."User"', 'followOnboardingCompletedAt', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."User"', 'followOnboardingRequired', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."User"', 'updatedAt', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."User"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'User language-preference rollback did not restore the pre-release narrow UPDATE state';
  END IF;
END
$user_language_rollback_assertions$;
COMMIT;

\echo 'User language-preference UPDATE rollback completed; onboarding and updatedAt access remain.'
