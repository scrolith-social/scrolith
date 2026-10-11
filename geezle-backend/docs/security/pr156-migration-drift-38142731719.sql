-- DropForeignKey
ALTER TABLE "LoginApprovalAttempt" DROP CONSTRAINT "LoginApprovalAttempt_approvedByUserId_fkey";

-- DropIndex
DROP INDEX "Conversation_type_memberCount_idx";

-- DropIndex
DROP INDEX "Conversation_type_visibility_lastMessageAt_idx";

-- DropIndex
DROP INDEX "ConversationJoinRequest_status_createdAt_idx";

-- DropIndex
DROP INDEX "ConversationParticipant_conversationId_lastDeliveredAt_idx";

-- DropIndex
DROP INDEX "ConversationParticipant_conversationId_lastReadAt_idx";

-- DropIndex
DROP INDEX "ConversationParticipant_deletedAt_idx";

-- DropIndex
DROP INDEX "ConversationParticipant_isStarred_idx";

-- DropIndex
DROP INDEX "GroupModerationAction_createdAt_idx";

-- DropIndex
DROP INDEX "LoginApprovalAttempt_requestedDeviceId_idx";

-- DropIndex
DROP INDEX "Notification_title_trgm_placeholder_idx";

-- DropIndex
DROP INDEX "User_languagePreferencesConfirmed_idx";

-- DropIndex
DROP INDEX "User_loginApprovalWaivedUntil_idx";

-- DropIndex
DROP INDEX "User_twoFactorEnabled_idx";

-- DropIndex
DROP INDEX "UserSettings_videoCallsEnabled_idx";

-- AlterTable
ALTER TABLE "AICapability" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIConsent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIConversation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIFeatureFlag" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIModelConfiguration" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIPrompt" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIProviderConfiguration" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIUserMemory" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClientHiringStatus" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClubMembership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "visibility" SET NOT NULL,
ALTER COLUMN "joinPolicy" SET NOT NULL,
ALTER COLUMN "messagingMode" SET NOT NULL;

-- AlterTable
ALTER TABLE "ConversationJoinRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConversationParticipant" ALTER COLUMN "role" SET NOT NULL,
ALTER COLUMN "notifications" SET NOT NULL;

-- AlterTable
ALTER TABLE "ConversationSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FeatureAudience" ALTER COLUMN "roleScope" DROP DEFAULT,
ALTER COLUMN "countryScope" DROP DEFAULT,
ALTER COLUMN "platformScope" DROP DEFAULT,
ALTER COLUMN "appVersions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HiringRecommendationState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HumanVerificationAnalytics" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HumanVerificationPolicy" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HumanVerificationSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LoginApprovalAttempt" DROP COLUMN "approvedByUserId",
DROP COLUMN "deviceMetadata",
DROP COLUMN "requestedDeviceId",
DROP COLUMN "requestedIp",
DROP COLUMN "requestedUserAgent",
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "newDeviceId" TEXT NOT NULL,
ADD COLUMN     "requestIp" TEXT,
ADD COLUMN     "userAgent" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "challenge" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LoginTrustedDevice" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationAnalyticsCounter" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationCampaign" ALTER COLUMN "channels" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationDelivery" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationDigest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationDigestSchedule" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationEventPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationFocusSession" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationGlobalPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationOpsConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationOpsTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationRetryJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationSyncState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasskeyCredential" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PresenceLease" ALTER COLUMN "rooms" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfessionalAvailability" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Reaction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReactionSummary" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResumeAnalysis" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResumeDocument" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SocketSession" ALTER COLUMN "rooms" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Topic" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "presenceVisibility" SET NOT NULL,
ALTER COLUMN "lastSeenVisibility" SET NOT NULL,
ALTER COLUMN "readReceiptsEnabled" SET NOT NULL,
ALTER COLUMN "typingIndicatorsEnabled" SET NOT NULL,
ALTER COLUMN "recordingIndicatorsEnabled" SET NOT NULL,
ALTER COLUMN "directMessageAudience" SET NOT NULL,
ALTER COLUMN "groupInviteAudience" SET NOT NULL,
ALTER COLUMN "notificationMessagePreviewEnabled" SET NOT NULL;

-- AlterTable
ALTER TABLE "fx_quotes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "QuestCatalog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "roleScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" TEXT NOT NULL DEFAULT 'standard',
    "verificationRules" JSONB,
    "reward" JSONB,
    "isWeekly" BOOLEAN NOT NULL DEFAULT false,
    "rotationWeight" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER NOT NULL DEFAULT 1,
    "meta" JSONB,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestCompletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "userQuestId" TEXT,
    "verification" JSONB,
    "reward" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestCompletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioProof" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "relatedGigId" TEXT,
    "relatedOrderId" TEXT,
    "fileId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "integrityHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofAttestation" (
    "id" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "attestedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "attestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofAuditLog" (
    "id" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "linkedContractId" TEXT,
    "linkedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodMember" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodMilestone" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "assignedToUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodActivity" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "bountyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bountyCurrency" TEXT,
    "acceptedAnswerId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isAccepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sponsorUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'open',
    "awardedAnswerId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSubscriptionPlan" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "monthlyPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSubscription" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventOfficeHour" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventOfficeHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "authorId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "policy" JSONB,
    "reason" TEXT,
    "createdByType" TEXT NOT NULL DEFAULT 'ai',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityStoryLike" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityStoryLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestCatalog_key_key" ON "QuestCatalog"("key");

-- CreateIndex
CREATE INDEX "QuestCatalog_isActive_isWeekly_idx" ON "QuestCatalog"("isActive", "isWeekly");

-- CreateIndex
CREATE INDEX "QuestCatalog_difficulty_idx" ON "QuestCatalog"("difficulty");

-- CreateIndex
CREATE INDEX "UserQuest_userId_status_assignedAt_idx" ON "UserQuest"("userId", "status", "assignedAt");

-- CreateIndex
CREATE INDEX "UserQuest_questId_status_idx" ON "UserQuest"("questId", "status");

-- CreateIndex
CREATE INDEX "UserQuest_expiresAt_idx" ON "UserQuest"("expiresAt");

-- CreateIndex
CREATE INDEX "QuestCompletionLog_userId_createdAt_idx" ON "QuestCompletionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestCompletionLog_questId_createdAt_idx" ON "QuestCompletionLog"("questId", "createdAt");

-- CreateIndex
CREATE INDEX "PortfolioProof_userId_status_createdAt_idx" ON "PortfolioProof"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PortfolioProof_visibility_idx" ON "PortfolioProof"("visibility");

-- CreateIndex
CREATE INDEX "PortfolioProof_relatedGigId_idx" ON "PortfolioProof"("relatedGigId");

-- CreateIndex
CREATE INDEX "PortfolioProof_relatedOrderId_idx" ON "PortfolioProof"("relatedOrderId");

-- CreateIndex
CREATE INDEX "ProofAttestation_status_createdAt_idx" ON "ProofAttestation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProofAttestation_proofId_clientUserId_key" ON "ProofAttestation"("proofId", "clientUserId");

-- CreateIndex
CREATE INDEX "ProofAuditLog_proofId_createdAt_idx" ON "ProofAuditLog"("proofId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofAuditLog_actorUserId_createdAt_idx" ON "ProofAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectPod_ownerUserId_status_updatedAt_idx" ON "ProjectPod"("ownerUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectPod_linkedContractId_idx" ON "ProjectPod"("linkedContractId");

-- CreateIndex
CREATE INDEX "ProjectPod_linkedOrderId_idx" ON "ProjectPod"("linkedOrderId");

-- CreateIndex
CREATE INDEX "PodMember_userId_status_idx" ON "PodMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PodMember_podId_userId_key" ON "PodMember"("podId", "userId");

-- CreateIndex
CREATE INDEX "PodMilestone_podId_status_dueAt_idx" ON "PodMilestone"("podId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "PodActivity_podId_createdAt_idx" ON "PodActivity"("podId", "createdAt");

-- CreateIndex
CREATE INDEX "PodActivity_actorUserId_createdAt_idx" ON "PodActivity"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Question_acceptedAnswerId_key" ON "Question"("acceptedAnswerId");

-- CreateIndex
CREATE INDEX "Question_authorId_status_createdAt_idx" ON "Question"("authorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Question_category_createdAt_idx" ON "Question"("category", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_questionId_createdAt_idx" ON "Answer"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_authorId_createdAt_idx" ON "Answer"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Vote_entityType_entityId_createdAt_idx" ON "Vote"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Vote_userId_createdAt_idx" ON "Vote"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_entityType_entityId_userId_key" ON "Vote"("entityType", "entityId", "userId");

-- CreateIndex
CREATE INDEX "Bounty_questionId_status_createdAt_idx" ON "Bounty"("questionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Bounty_sponsorUserId_createdAt_idx" ON "Bounty"("sponsorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSubscriptionPlan_active_idx" ON "ChannelSubscriptionPlan"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSubscriptionPlan_channelId_key" ON "ChannelSubscriptionPlan"("channelId");

-- CreateIndex
CREATE INDEX "ChannelSubscription_status_endsAt_idx" ON "ChannelSubscription"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSubscription_channelId_userId_key" ON "ChannelSubscription"("channelId", "userId");

-- CreateIndex
CREATE INDEX "EventOfficeHour_eventId_startsAt_idx" ON "EventOfficeHour"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "EventOfficeHour_hostUserId_startsAt_idx" ON "EventOfficeHour"("hostUserId", "startsAt");

-- CreateIndex
CREATE INDEX "UserAnalyticsDaily_day_idx" ON "UserAnalyticsDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "UserAnalyticsDaily_userId_day_key" ON "UserAnalyticsDaily"("userId", "day");

-- CreateIndex
CREATE INDEX "EntityAnalyticsDaily_entityType_day_idx" ON "EntityAnalyticsDaily"("entityType", "day");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAnalyticsDaily_entityType_entityId_day_key" ON "EntityAnalyticsDaily"("entityType", "entityId", "day");

-- CreateIndex
CREATE INDEX "ModerationCase_contentType_status_createdAt_idx" ON "ModerationCase"("contentType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_authorId_createdAt_idx" ON "ModerationCase"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_caseId_createdAt_idx" ON "ModerationAction"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_actorUserId_createdAt_idx" ON "ModerationAction"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityStoryLike_storyId_idx" ON "CommunityStoryLike"("storyId");

-- CreateIndex
CREATE INDEX "CommunityStoryLike_userId_idx" ON "CommunityStoryLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityStoryLike_storyId_userId_key" ON "CommunityStoryLike"("storyId", "userId");

-- CreateIndex
CREATE INDEX "LoginApprovalAttempt_newDeviceId_idx" ON "LoginApprovalAttempt"("newDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_resumeId_versionNumber_key" ON "ResumeVersion"("resumeId", "versionNumber");

-- AddForeignKey
ALTER TABLE "QuestCatalog" ADD CONSTRAINT "QuestCatalog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestCatalog" ADD CONSTRAINT "QuestCatalog_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuest" ADD CONSTRAINT "UserQuest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuest" ADD CONSTRAINT "UserQuest_questId_fkey" FOREIGN KEY ("questId") REFERENCES "QuestCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestCompletionLog" ADD CONSTRAINT "QuestCompletionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestCompletionLog" ADD CONSTRAINT "QuestCompletionLog_questId_fkey" FOREIGN KEY ("questId") REFERENCES "QuestCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestCompletionLog" ADD CONSTRAINT "QuestCompletionLog_userQuestId_fkey" FOREIGN KEY ("userQuestId") REFERENCES "UserQuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioProof" ADD CONSTRAINT "PortfolioProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioProof" ADD CONSTRAINT "PortfolioProof_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioProof" ADD CONSTRAINT "PortfolioProof_relatedGigId_fkey" FOREIGN KEY ("relatedGigId") REFERENCES "Gig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioProof" ADD CONSTRAINT "PortfolioProof_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttestation" ADD CONSTRAINT "ProofAttestation_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "PortfolioProof"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttestation" ADD CONSTRAINT "ProofAttestation_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttestation" ADD CONSTRAINT "ProofAttestation_attestedByUserId_fkey" FOREIGN KEY ("attestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAuditLog" ADD CONSTRAINT "ProofAuditLog_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "PortfolioProof"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAuditLog" ADD CONSTRAINT "ProofAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPod" ADD CONSTRAINT "ProjectPod_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPod" ADD CONSTRAINT "ProjectPod_linkedContractId_fkey" FOREIGN KEY ("linkedContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPod" ADD CONSTRAINT "ProjectPod_linkedOrderId_fkey" FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMember" ADD CONSTRAINT "PodMember_podId_fkey" FOREIGN KEY ("podId") REFERENCES "ProjectPod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMember" ADD CONSTRAINT "PodMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMember" ADD CONSTRAINT "PodMember_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMilestone" ADD CONSTRAINT "PodMilestone_podId_fkey" FOREIGN KEY ("podId") REFERENCES "ProjectPod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMilestone" ADD CONSTRAINT "PodMilestone_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodMilestone" ADD CONSTRAINT "PodMilestone_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodActivity" ADD CONSTRAINT "PodActivity_podId_fkey" FOREIGN KEY ("podId") REFERENCES "ProjectPod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodActivity" ADD CONSTRAINT "PodActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_acceptedAnswerId_fkey" FOREIGN KEY ("acceptedAnswerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bounty" ADD CONSTRAINT "Bounty_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bounty" ADD CONSTRAINT "Bounty_sponsorUserId_fkey" FOREIGN KEY ("sponsorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bounty" ADD CONSTRAINT "Bounty_awardedAnswerId_fkey" FOREIGN KEY ("awardedAnswerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSubscriptionPlan" ADD CONSTRAINT "ChannelSubscriptionPlan_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSubscription" ADD CONSTRAINT "ChannelSubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSubscription" ADD CONSTRAINT "ChannelSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSubscription" ADD CONSTRAINT "ChannelSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ChannelSubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventOfficeHour" ADD CONSTRAINT "EventOfficeHour_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventOfficeHour" ADD CONSTRAINT "EventOfficeHour_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAnalyticsDaily" ADD CONSTRAINT "UserAnalyticsDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityStoryLike" ADD CONSTRAINT "CommunityStoryLike_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "CommunityStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityStoryLike" ADD CONSTRAINT "CommunityStoryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginApprovalAttempt" ADD CONSTRAINT "LoginApprovalAttempt_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CommunityNotificationSubscription_userId_targetType_targetId_ke" RENAME TO "CommunityNotificationSubscription_userId_targetType_targetI_key";

-- RenameIndex
ALTER INDEX "ContentTranslation_entityType_entityId_targetLocale_contentHash" RENAME TO "ContentTranslation_entityType_entityId_targetLocale_content_key";

-- RenameIndex
ALTER INDEX "FoundingPartnerEnrollmentPayment_provider_providerReferenceId_k" RENAME TO "FoundingPartnerEnrollmentPayment_provider_providerReference_key";

-- RenameIndex
ALTER INDEX "FxManualOverride_fromCurrency_toCurrency_status_effectiveFrom_i" RENAME TO "FxManualOverride_fromCurrency_toCurrency_status_effectiveFr_idx";

-- RenameIndex
ALTER INDEX "engagement_milestone_state_claim_key" RENAME TO "engagement_milestone_state_rule_id_entity_type_entity_id_ow_key";

-- RenameIndex
ALTER INDEX "engagement_milestone_state_owner_lookup_idx" RENAME TO "engagement_milestone_state_owner_id_event_type_created_at_idx";

-- RenameIndex
ALTER INDEX "engagement_milestone_state_status_lookup_idx" RENAME TO "engagement_milestone_state_status_created_at_idx";

-- RenameIndex
ALTER INDEX "engagement_signal_event_lookup_idx" RENAME TO "engagement_signal_event_type_entity_type_entity_id_occurred_idx";

-- RenameIndex
ALTER INDEX "engagement_signal_owner_lookup_idx" RENAME TO "engagement_signal_owner_id_event_type_occurred_at_idx";

-- RenameIndex
ALTER INDEX "reco_feedback_log_entity_surface_action_created_at_idx" RENAME TO "reco_feedback_log_entity_type_entity_id_surface_action_crea_idx";

-- RenameIndex
ALTER INDEX "reco_feedback_log_viewer_created_at_idx" RENAME TO "reco_feedback_log_viewer_id_created_at_idx";

-- RenameIndex
ALTER INDEX "reco_impression_log_entity_surface_day_idx" RENAME TO "reco_impression_log_entity_type_entity_id_surface_shown_at__idx";

-- RenameIndex
ALTER INDEX "reco_impression_log_unique_key" RENAME TO "reco_impression_log_viewer_id_entity_type_entity_id_surface_key";

-- RenameIndex
ALTER INDEX "reco_impression_log_viewer_day_idx" RENAME TO "reco_impression_log_viewer_id_shown_at_day_idx";
