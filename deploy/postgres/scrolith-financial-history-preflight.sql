-- Read-only preflight for the retained AdPayment and GcoinEarningEvent FKs.
-- Run only on a local disposable database whose name contains test/e2e.
-- Separately verify the connection endpoint is loopback before invoking psql.

\set ON_ERROR_STOP on
\set _scrolith_guard_failed true
\if :{?database_name}
  \set _scrolith_guard_failed false
\else
  \echo 'STOP: pass -v database_name=<disposable database name>.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'database_name is required'; END $psql_guard_failure$;
\endif

BEGIN TRANSACTION READ ONLY;

SELECT CASE
         WHEN current_database() = :'database_name'
          AND current_database() ~* '(test|e2e)'
         THEN 1 ELSE 0
       END AS target_is_disposable \gset
\if :target_is_disposable
  \set _scrolith_guard_failed false
\else
  \set _scrolith_guard_failed true
\echo 'STOP: connected database must match the supplied test/e2e name.'
\endif
\if :_scrolith_guard_failed
DO $psql_guard_failure$ BEGIN RAISE EXCEPTION 'preflight requires the named disposable database'; END $psql_guard_failure$;
\endif

DO $preflight$
BEGIN
  IF to_regclass('public."AdPayment"') IS NULL
     OR to_regclass('public."CommunityAd"') IS NULL
     OR to_regclass('public."GcoinEarningEvent"') IS NULL
     OR to_regclass('public."CommunityPost"') IS NULL THEN
    RAISE EXCEPTION 'required financial-history tables are missing; inspect schema drift before migration';
  END IF;
END
$preflight$;

SELECT 'AdPayment.adId -> CommunityAd.id' AS relation,
       COUNT(*)::bigint AS orphan_count
FROM public."AdPayment" AS payment
LEFT JOIN public."CommunityAd" AS ad ON ad."id" = payment."adId"
WHERE payment."adId" IS NOT NULL AND ad."id" IS NULL
UNION ALL
SELECT 'GcoinEarningEvent.postId -> CommunityPost.id',
       COUNT(*)::bigint
FROM public."GcoinEarningEvent" AS earning
LEFT JOIN public."CommunityPost" AS post ON post."id" = earning."postId"
WHERE earning."postId" IS NOT NULL AND post."id" IS NULL;

SELECT child.relname AS child_table,
       constraint_row.conname AS constraint_name,
       parent.relname AS parent_table,
       constraint_row.convalidated,
       pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_constraint AS constraint_row
JOIN pg_class AS child ON child.oid = constraint_row.conrelid
JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
JOIN pg_namespace AS child_schema ON child_schema.oid = child.relnamespace
WHERE constraint_row.contype = 'f'
  AND child_schema.nspname = 'public'
  AND constraint_row.conname IN (
    'AdPayment_adId_fkey',
    'GcoinEarningEvent_postId_fkey'
  )
ORDER BY child.relname;

ROLLBACK;
