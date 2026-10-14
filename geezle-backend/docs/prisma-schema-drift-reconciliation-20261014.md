# Prisma schema-drift reconciliation — 2026-10-14

## Scope and baseline

This package reconciles the post-`20261014120000_reconcile_prisma_schema_drift`
drift on the local remediation branch only. The 137 historical migrations were
not edited or re-hashed. The prior additive migration remains unchanged.

The Prisma diff contained 73 operation sections:

| Operation | Count | Interpretation |
| --- | ---: | --- |
| DropIndex | 13 | Historical performance indexes existed in PostgreSQL but were not represented in the schema. They are retained; no drop is authorized. |
| AlterTable | 45 | 60 column-level observations: historical defaults plus 13 nullability changes. Defaults are represented in Prisma; required-column changes use a fail-closed migration. |
| CreateIndex | 1 | `ResumeVersion(resumeId, versionNumber)` is required by Prisma but absent from historical replay. |
| RenameIndex | 14 | PostgreSQL 63-byte identifier truncation and historical index naming; physical indexes are preserved with Prisma `map` names. |

The operation-section count is distinct from the number of affected columns.

The forward-only additive migration contains exactly 22 `CREATE TABLE`
statements, 51 `CREATE INDEX` statements, and 48 `ADD CONSTRAINT ... FOREIGN
KEY` statements. The 51-index count must not be reported as a foreign-key
count.

## Reconciliation matrix: historical indexes that must not be dropped

| Table | Physical index and historical source | Prisma treatment | Risk / result |
| --- | --- | --- | --- |
| `Conversation` | `Conversation_type_memberCount_idx`; `Conversation_type_visibility_lastMessageAt_idx`; `20260721160000_phase295_messaging_groups_search_indexes` | Added mapped `@@index` declarations, including historical descending/null ordering | Dropping would remove group-directory/query performance. Preserved. |
| `ConversationJoinRequest` | `ConversationJoinRequest_status_createdAt_idx`; `20260721160000_phase295_messaging_groups_search_indexes` | Added mapped descending `@@index` | Preserved queue lookup index. |
| `ConversationParticipant` | `ConversationParticipant_conversationId_lastDeliveredAt_idx`, `...lastReadAt_idx`; `20260720160000_phase223_presence_receipts` | Added mapped `@@index` declarations | Preserved receipt-query indexes. |
| `ConversationParticipant` | `ConversationParticipant_deletedAt_idx`, `...isStarred_idx`; `20260209100000_patch_missing_profile_messaging_columns` | Added mapped `@@index` declarations | Preserved historical additive indexes. |
| `GroupModerationAction` | `GroupModerationAction_createdAt_idx`; `20260721160000_phase295_messaging_groups_search_indexes` | Added mapped descending `@@index` | Preserved audit time-series lookup. |
| `Notification` | `Notification_title_trgm_placeholder_idx`; `20260722150000_phase321_notification_inbox` (physical columns are `userId,type`) | Added mapped `@@index([userId,type])` | Name is historical/misleading; no index drop. |
| `User` | `User_languagePreferencesConfirmed_idx`; `20260720190000_phase26_multilingual_intelligence` | Added mapped `@@index` | Preserved language-preference lookup. |
| `User` | `User_loginApprovalWaivedUntil_idx`; `20260823100000_login_approval_emergency_waiver` | Added mapped `@@index` | Preserved waiver lookup. |
| `User` | `User_twoFactorEnabled_idx`; `20260722010000_phase297_admin_2fa_and_system_controls` | Added mapped `@@index` | Preserved 2FA lookup. |
| `UserSettings` | `UserSettings_videoCallsEnabled_idx`; `20260725163000_user_video_call_controls` | Added mapped `@@index` | Preserved video-call control lookup. |

The four rows with multiple indexes account for all 13 proposed drops. The
schema now describes the existing physical indexes instead of generating DROP
operations. Index definitions with historical `DESC NULLS LAST` behavior retain
that behavior in the Prisma declaration.

## Reconciliation matrix: index-name differences

| Table | Historical physical name | Prisma-generated name that caused the rename | Safe correction |
| --- | --- | --- | --- |
| `CommunityNotificationSubscription` | `CommunityNotificationSubscription_userId_targetType_targetId_ke` | `...targetI_key` | Map the unique constraint to the physical 63-byte name. |
| `ContentTranslation` | `ContentTranslation_entityType_entityId_targetLocale_contentHash` | `...content_key` | Map the unique constraint to the physical truncated name. |
| `FoundingPartnerEnrollmentPayment` | `FoundingPartnerEnrollmentPayment_provider_providerReferenceId_k` | `...providerReference_key` | Map the unique constraint to the physical truncated name. |
| `FxManualOverride` | `FxManualOverride_fromCurrency_toCurrency_status_effectiveFrom_i` | `...effectiveFr_idx` | Map the index to the physical truncated name. |
| `engagement_milestone_state` | `engagement_milestone_state_claim_key` | `...rule_id_entity_type_entity_id_ow_key` | Map the existing unique constraint. |
| `engagement_milestone_state` | `engagement_milestone_state_owner_lookup_idx` | `...owner_id_event_type_created_at_idx` | Map the existing index. |
| `engagement_milestone_state` | `engagement_milestone_state_status_lookup_idx` | `...status_created_at_idx` | Map the existing index. |
| `engagement_signal` | `engagement_signal_event_lookup_idx` | `...event_type_entity_type_entity_id_occurred_idx` | Map the existing index. |
| `engagement_signal` | `engagement_signal_owner_lookup_idx` | `...owner_id_event_type_occurred_at_idx` | Map the existing index. |
| `reco_feedback_log` | `reco_feedback_log_entity_surface_action_created_at_idx` | `...entity_type_entity_id_surface_action_crea_idx` | Map the existing index. |
| `reco_feedback_log` | `reco_feedback_log_viewer_created_at_idx` | `...viewer_id_created_at_idx` | Map the existing index. |
| `reco_impression_log` | `reco_impression_log_entity_surface_day_idx` | `...entity_type_entity_id_surface_shown_at__idx` | Map the existing index. |
| `reco_impression_log` | `reco_impression_log_unique_key` | `...viewer_id_entity_type_entity_id_surface_key` | Map the existing unique constraint. |
| `reco_impression_log` | `reco_impression_log_viewer_day_idx` | `...viewer_id_shown_at_day_idx` | Map the existing index. |

These are representation-only differences caused by historical names and
PostgreSQL's 63-byte identifier limit. No physical rename is performed.

## Reconciliation matrix: historical defaults

The historical table-create or additive migration definitions use
`DEFAULT CURRENT_TIMESTAMP` for the following `updatedAt`/`updated_at` columns.
The schema now declares `@default(now()) @updatedAt`, preserving the database
default and Prisma's automatic update behavior. Removing these defaults would
be an unnecessary compatibility risk.

| Table/column | Historical source |
| --- | --- |
| `AICapability.updatedAt`, `AIConsent.updatedAt`, `AIFeatureFlag.updatedAt`, `AIModelConfiguration.updatedAt`, `AIPrompt.updatedAt`, `AIProviderConfiguration.updatedAt` | `20260722190000_phase330_scrolitha_ai_foundation` |
| `AIConversation.updatedAt` | `20260722200000_phase331_scrolitha_ai_assistant` |
| `AIUserMemory.updatedAt` | `20260722210000_phase332_intelligent_discovery` |
| `ClientHiringStatus.updatedAt` | `20260902110000_add_client_hiring_status` |
| `ClubMembership.updatedAt` | Initial table creation plus `20260629110000_add_community_groups` |
| `ConversationJoinRequest.updatedAt`, `ConversationSettings.updatedAt` | `20260721140000_phase291_enterprise_messaging_groups` |
| `HiringRecommendationState.updatedAt` | `20260903110000_add_hiring_recommendations` |
| `HumanVerificationAnalytics.updatedAt`, `HumanVerificationPolicy.updatedAt`, `HumanVerificationSettings.updatedAt` | `20260722120000_phase30_human_verification` |
| `LoginApprovalAttempt.updatedAt` | `20260821100000_login_device_approval` |
| `LoginTrustedDevice.updatedAt` | `20260821100000_login_device_approval` |
| `NotificationAnalyticsCounter.updatedAt`, `NotificationDelivery.updatedAt`, `NotificationPreference.updatedAt` | `20260722140000_phase320_notification_center_foundation` |
| `NotificationCampaign.updatedAt`, `NotificationOpsConfig.updatedAt`, `NotificationOpsTemplate.updatedAt`, `NotificationRetryJob.updatedAt` | `20260722180000_phase324_notification_operations` |
| `NotificationDigest.updatedAt`, `NotificationDigestSchedule.updatedAt`, `NotificationEventPreference.updatedAt`, `NotificationFocusSession.updatedAt`, `NotificationGlobalPreference.updatedAt` | `20260722160000_phase322_preferences_digests` |
| `NotificationSyncState.updatedAt` | `20260722170000_phase323_android_cross_device` |
| `PasskeyCredential.updated_at` | `20260908120000_add_passkeys` |
| `ProfessionalAvailability.updatedAt` | `20260902093000_add_professional_availability` |
| `Reaction.updatedAt`, `ReactionSummary.updatedAt` | `20260208093000_add_universal_reactions_and_message_reply` |
| `ResumeAnalysis.updatedAt`, `ResumeDocument.updatedAt` | `20260522090000_add_resume_ai` |
| `Topic.updatedAt` | `20260313223000_add_phase1_topic_pipeline_feed_signals` and later additive definitions |
| `fx_quotes.updated_at` | `20260721090000_phase28_multi_currency` |

Other default observations are preserved in the schema:

| Table/columns | Historical definition | Correction |
| --- | --- | --- |
| `FeatureAudience.roleScope`, `countryScope`, `platformScope`, `appVersions` | `DEFAULT ARRAY[]::TEXT[]` | Added `@default([])` to all four fields. |
| `LoginApprovalAttempt.challenge` | `DEFAULT ''` from `20260821110000_login_approval_challenge_compat` | Added `@default("")`; physical values are preserved. |
| `NotificationCampaign.channels` | `DEFAULT ARRAY['IN_APP']::TEXT[]` from phase 32.4 | Schema now declares `@default(["IN_APP"])`; no database rewrite. |
| `PresenceLease.rooms`, `SocketSession.rooms` | `DEFAULT ARRAY[]::TEXT[]` from their historical table definitions | Added `@default([])` to both fields. |

## Reconciliation matrix: nullability changes

| Table/columns | Historical source and actual state | Risk | Resolution |
| --- | --- | --- | --- |
| `Conversation.visibility`, `joinPolicy`, `messagingMode` | Added/defined through `20260721140000_phase291_enterprise_messaging_groups`; replay leaves them nullable | Existing NULL values may encode legacy behavior. `SET NOT NULL` can fail or change application semantics if backfilled incorrectly. | The corrective migration checks for NULL and aborts with an owner-actionable error; only then applies `SET NOT NULL`. No values are fabricated. |
| `ConversationParticipant.role`, `notifications` | Original group-messaging definitions in `20260720140000_phase222_group_messaging`; replay leaves them nullable | Existing NULL values require a data-owner-approved interpretation. | Same fail-closed preflight and conditional `SET NOT NULL`. |
| `User.presenceVisibility` | Added by `20260720160000_phase223_presence_receipts`, with privacy follow-up in `20260720180000_phase223b_messaging_privacy` | NULL may mean legacy default or unknown preference. | No automatic backfill; preflight aborts if any NULL exists. |
| `User.lastSeenVisibility`, `readReceiptsEnabled`, `typingIndicatorsEnabled`, `recordingIndicatorsEnabled`, `directMessageAudience`, `groupInviteAudience`, `notificationMessagePreviewEnabled` | `20260720180000_phase223b_messaging_privacy`; historical additions are nullable while Prisma now expects required values | Broad user-row update could silently change privacy behavior. | No automatic backfill; owner-approved backfill is required if live NULLs are found, followed by rerun of the same migration. |

## Missing unique index

`ResumeVersion_resumeId_versionNumber_key` is required by the Prisma model but
absent from historical replay. The corrective migration first checks for
duplicate `(resumeId, versionNumber)` groups and raises an exception if any are
found, before any DDL runs, then creates the unique index. It does not delete,
merge, or select a winner. The same operation must be preflighted on staging by
the database/data owner and scheduled for an appropriate lock window; a
duplicate or lock failure must stop the deployment.

## Corrective migration and rollback

Both new migrations are forward-only and use explicit PostgreSQL `BEGIN` and
`COMMIT` boundaries. The first migration encloses all 22 table creations, 51
indexes, and 48 foreign keys in one transaction. The corrective migration
performs all 13 NULL preflights and the duplicate-key preflight before any DDL,
then encloses the approved `SET NOT NULL` operations and unique-index creation
in the same transaction. PostgreSQL rolls back the complete migration
transaction when a preflight or DDL statement fails. These boundaries were
verified through Prisma Migrate replay on PostgreSQL 16 and 17; Prisma accepted
the explicit boundaries and recorded successful migrations only after `COMMIT`.
Neither migration contains UPDATE, DELETE, DROP, TRUNCATE, or historical
checksum manipulation.

Before staging approval:

1. Database owner runs read-only NULL-count checks for the 13 required fields.
2. Database owner runs the duplicate-group check for `ResumeVersion`.
3. Product/data owners approve any required backfill values; no backfill is
   included in this migration.
4. The migration is applied in a maintenance window with lock monitoring.
5. If a preflight fails, leave the migration unapplied, preserve the rows, and
   obtain a separate approved remediation. Do not mark the migration as applied.
6. After a successful apply, rollback is operational recovery: restore from an
   approved backup or execute a separately reviewed reverse migration. Do not
   drop the unique index or reintroduce nullable columns automatically as a
   rollback shortcut.

## Read-only staging preflight queries

The following queries are prepared for the database owner to run against the
approved staging target only after separate authorization. They are read-only,
do not return application records, and must be captured as sanitized evidence.
They do not approve or apply a migration.

### Required-field NULL counts

```sql
SELECT
  COUNT(*) FILTER (WHERE "visibility" IS NULL) AS conversation_visibility_nulls,
  COUNT(*) FILTER (WHERE "joinPolicy" IS NULL) AS conversation_join_policy_nulls,
  COUNT(*) FILTER (WHERE "messagingMode" IS NULL) AS conversation_messaging_mode_nulls
FROM public."Conversation";

SELECT
  COUNT(*) FILTER (WHERE "role" IS NULL) AS participant_role_nulls,
  COUNT(*) FILTER (WHERE "notifications" IS NULL) AS participant_notifications_nulls
FROM public."ConversationParticipant";

SELECT
  COUNT(*) FILTER (WHERE "presenceVisibility" IS NULL) AS presence_visibility_nulls,
  COUNT(*) FILTER (WHERE "lastSeenVisibility" IS NULL) AS last_seen_visibility_nulls,
  COUNT(*) FILTER (WHERE "readReceiptsEnabled" IS NULL) AS read_receipts_enabled_nulls,
  COUNT(*) FILTER (WHERE "typingIndicatorsEnabled" IS NULL) AS typing_indicators_enabled_nulls,
  COUNT(*) FILTER (WHERE "recordingIndicatorsEnabled" IS NULL) AS recording_indicators_enabled_nulls,
  COUNT(*) FILTER (WHERE "directMessageAudience" IS NULL) AS direct_message_audience_nulls,
  COUNT(*) FILTER (WHERE "groupInviteAudience" IS NULL) AS group_invite_audience_nulls,
  COUNT(*) FILTER (WHERE "notificationMessagePreviewEnabled" IS NULL) AS notification_preview_nulls
FROM public."User";
```

### Duplicate ResumeVersion keys

```sql
SELECT "resumeId", "versionNumber", COUNT(*) AS duplicate_count
FROM public."ResumeVersion"
GROUP BY "resumeId", "versionNumber"
HAVING COUNT(*) > 1
ORDER BY "resumeId", "versionNumber";
```

### Candidate table and index presence

```sql
SELECT n.nspname AS schema_name, c.relname, c.relkind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'QuestCatalog', 'UserQuest', 'QuestCompletionLog', 'PortfolioProof',
    'ProofAttestation', 'ProofAuditLog', 'ProjectPod', 'PodMember',
    'PodMilestone', 'PodActivity', 'Question', 'Answer', 'Vote', 'Bounty',
    'ChannelSubscriptionPlan', 'ChannelSubscription', 'EventOfficeHour',
    'UserAnalyticsDaily', 'EntityAnalyticsDaily', 'ModerationCase',
    'ModerationAction', 'CommunityStoryLike'
  )
ORDER BY c.relname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('ResumeVersion_resumeId_versionNumber_key');
```

### Prisma migration ledger

```sql
SELECT migration_name, checksum, started_at, finished_at,
       rolled_back_at, applied_steps_count
FROM public."_prisma_migrations"
ORDER BY started_at NULLS LAST, migration_name;
```

The ledger query intentionally omits `id` and `logs`; it is for migration
identity/status reconciliation, not application-data inspection. The owner
must separately verify that there are no duplicate migration names, incomplete
rows, rolled-back rows, or checksum mismatches against the local migration
files. No ledger row may be edited to force a pass.

### Lock-impact assessment

```sql
SELECT pid, usename, application_name, client_addr, state,
       wait_event_type, wait_event, xact_start, query_start,
       pg_catalog.pg_blocking_pids(pid) AS blocking_pids,
       left(query, 200) AS query_preview
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state <> 'idle'
ORDER BY xact_start NULLS LAST, query_start NULLS LAST;

SELECT l.pid, l.mode, l.granted, c.relname,
       pg_catalog.pg_blocking_pids(l.pid) AS blocking_pids
FROM pg_catalog.pg_locks AS l
JOIN pg_catalog.pg_class AS c ON c.oid = l.relation
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('Conversation', 'ConversationParticipant', 'User', 'ResumeVersion')
ORDER BY c.relname, l.granted, l.pid;
```

These lock queries assess maintenance-window risk only. They do not guarantee
a future lock duration and must be repeated immediately before an authorized
migration.

## Validation evidence

Disposable-only runs used these exact Linux/amd64 image references:

- PG16: `postgres:16@sha256:65b16a8b326e0cfbdf33fa7e783f2a0cb352a61448616ccccfd616ef42aa0f65`
- PG17: `postgres:17@sha256:91eb910c44c7ed13f7f1a4ccadaa9ca72ef14cddc04cacb6e070e48eb44731a3`

Both replayed all 139 migrations (137 historical plus the two reconciliation
migrations), then passed `prisma migrate status` and the actual drift gate with
exit code 0. Synthetic representative rows were inserted before the corrective
migration on PG16 and persisted/reconciled. PG17 replayed the same migration
chain cleanly and passed the structural checks; its synthetic representative
rows were then used for post-migration persistence checks. A synthetic
`LoginApprovalAttempt` row was
written and read using `requestedDeviceId`, `requestedIp`,
`requestedUserAgent`, `deviceMetadata`, and `approvedByUserId`; no legacy
physical login columns were used.

Validation commands and results:

| Check | Result |
| --- | --- |
| `prisma validate` | PASS, exit 0 |
| `prisma generate` | PASS, Prisma Client 7.10.0, exit 0 |
| PG16 `migrate deploy` | PASS, 139 migrations, exit 0 |
| PG16 `migrate diff --exit-code` | PASS, `No difference detected`, exit 0 |
| PG16 `migrate status` | PASS, up to date, exit 0 |
| PG17 `migrate deploy` | PASS, 139 migrations, exit 0 |
| PG17 `migrate diff --exit-code` | PASS, `No difference detected`, exit 0 |
| PG17 `migrate status` | PASS, up to date, exit 0 |
| Login-approval unit suite | PASS, 1 suite / 6 tests |
| TypeScript build | PASS, exit 0 |
| Historical migration integrity | PASS, no historical migration file changed |

### Atomic-failure validation

| Scenario | PG16 | PG17 | Evidence |
| --- | --- | --- | --- |
| NULL-value preflight | PASS, Prisma exit 1 | PASS, Prisma exit 1 | `Cannot enforce Conversation required fields`; all 13 target columns remained nullable, the unique index remained absent, and no successful corrective ledger row was recorded. |
| Duplicate `ResumeVersion` preflight | PASS, Prisma exit 1 | PASS, Prisma exit 1 | `Cannot create ResumeVersion uniqueness constraint`; two synthetic duplicate rows remained, all 13 target columns remained nullable, and the unique index remained absent. |
| Mid-22-table DDL failure | PASS, Prisma exit 1 | PASS, Prisma exit 1 | Synthetic `ProjectPod` conflict produced `relation "ProjectPod" already exists`; earlier `QuestCatalog`, `UserQuest`, and other newly created tables were absent after failure. |

The failure cases used cloned disposable databases only. Failed migration
attempts left an incomplete Prisma ledger attempt with `applied_steps_count = 0`
and no finished timestamp; this is expected failure evidence, not a successful
application. No staging or production database was contacted.

Live staging and production compatibility remain **NOT VERIFIED**. In
particular, null counts, duplicate resume-version keys, current migration
checksums, lock duration, and database version must be verified by the database
owner before staging execution.
