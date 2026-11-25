-- Reversible rollback for the focused Profile column UPDATE allowlist.
-- Run only from the existing approved PostgreSQL migrator session through psql.
-- Required variables are checked by the shared production target guard.
\ir scrolith-production-target-guard.sql
SELECT set_config('scrolith.expected_source_commit', :'expected_source_commit', false);

BEGIN;
DO $profile_rollback_preflight$
BEGIN
  IF current_user <> 'scrolith_migrator'
     OR NOT EXISTS (
       SELECT 1 FROM public.scrolith_runtime_policy_state
        WHERE singleton AND finalized
          AND source_commit = current_setting('scrolith.expected_source_commit')
     ) THEN
    RAISE EXCEPTION 'Profile rollback requires the finalized policy created by the declared release';
  END IF;
END
$profile_rollback_preflight$;

REVOKE UPDATE ("bio", "certifications", "city", "country", "countryCode",
               "coverPhotoUrl", "dateOfBirth", "educationItems", "experienceItems",
               "formattedAddress", "gender", "githubUrl", "hourlyRate", "introVideoUrl",
               "languages", "latitude", "linkedinUrl", "location", "locationSource",
               "longitude", "placeId", "portfolio", "portfolioUrl", "postalCode",
               "region", "showBirthMonthDayPublic", "skills", "state", "title", "websiteUrl")
  ON TABLE public."Profile" FROM scrolith_runtime;
GRANT UPDATE ("updatedAt") ON TABLE public."Profile" TO scrolith_runtime;

DO $profile_rollback_assertions$
BEGIN
  IF has_table_privilege('scrolith_runtime', 'public."Profile"', 'UPDATE')
     OR has_column_privilege('scrolith_runtime', 'public."Profile"', 'title', 'UPDATE')
     OR NOT has_column_privilege('scrolith_runtime', 'public."Profile"', 'updatedAt', 'UPDATE')
     OR has_table_privilege('scrolith_runtime', 'public."Profile"', 'DELETE')
     OR has_table_privilege('scrolith_runtime', 'public."Profile"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Profile rollback did not restore the prior narrowly scoped UPDATE state';
  END IF;
END
$profile_rollback_assertions$;
COMMIT;

\echo 'Profile UPDATE rollback completed; existing updatedAt-only access remains.'
