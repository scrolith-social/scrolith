-- Forward-only Prisma drift reconciliation.
-- This migration is intentionally fail-closed: it never fabricates values,
-- deletes rows, or silently repairs incompatible data.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Conversation"
    WHERE "visibility" IS NULL
       OR "joinPolicy" IS NULL
       OR "messagingMode" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce Conversation required fields: existing NULL values require data-owner approval and an explicit backfill plan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ConversationParticipant"
    WHERE "role" IS NULL
       OR "notifications" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce ConversationParticipant required fields: existing NULL values require data-owner approval and an explicit backfill plan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "presenceVisibility" IS NULL
       OR "lastSeenVisibility" IS NULL
       OR "readReceiptsEnabled" IS NULL
       OR "typingIndicatorsEnabled" IS NULL
       OR "recordingIndicatorsEnabled" IS NULL
       OR "directMessageAudience" IS NULL
       OR "groupInviteAudience" IS NULL
       OR "notificationMessagePreviewEnabled" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce User required privacy fields: existing NULL values require data-owner approval and an explicit backfill plan';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ResumeVersion"
    GROUP BY "resumeId", "versionNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create ResumeVersion uniqueness constraint: duplicate (resumeId, versionNumber) values require data-owner approval';
  END IF;
END $$;

ALTER TABLE "Conversation"
  ALTER COLUMN "visibility" SET NOT NULL,
  ALTER COLUMN "joinPolicy" SET NOT NULL,
  ALTER COLUMN "messagingMode" SET NOT NULL;

ALTER TABLE "ConversationParticipant"
  ALTER COLUMN "role" SET NOT NULL,
  ALTER COLUMN "notifications" SET NOT NULL;

ALTER TABLE "User"
  ALTER COLUMN "presenceVisibility" SET NOT NULL,
  ALTER COLUMN "lastSeenVisibility" SET NOT NULL,
  ALTER COLUMN "readReceiptsEnabled" SET NOT NULL,
  ALTER COLUMN "typingIndicatorsEnabled" SET NOT NULL,
  ALTER COLUMN "recordingIndicatorsEnabled" SET NOT NULL,
  ALTER COLUMN "directMessageAudience" SET NOT NULL,
  ALTER COLUMN "groupInviteAudience" SET NOT NULL,
  ALTER COLUMN "notificationMessagePreviewEnabled" SET NOT NULL;

CREATE UNIQUE INDEX "ResumeVersion_resumeId_versionNumber_key"
  ON "ResumeVersion"("resumeId", "versionNumber");

COMMIT;
