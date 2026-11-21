-- Generated from the production TypeScript Prisma delegate inventory and schema.
-- See docs/POSTGRES_RUNTIME_PERMISSION_MATRIX.md for source methodology and limitations.
GRANT SELECT ON TABLE
  :"application_schema"."AIAuditLog",
  :"application_schema"."AIConsent",
  :"application_schema"."AIConversation",
  :"application_schema"."AIConversationMessage",
  :"application_schema"."AICopilotLog",
  :"application_schema"."AIFeatureFlag",
  :"application_schema"."AIFeedback",
  :"application_schema"."AILearningSignal",
  :"application_schema"."AIModelConfiguration",
  :"application_schema"."AIPrompt",
  :"application_schema"."AIProviderConfiguration",
  :"application_schema"."AIRecommendationFeedback",
  :"application_schema"."AIRequest",
  :"application_schema"."AIUsageLedger",
  :"application_schema"."AIUserMemory",
  :"application_schema"."AccountViolation",
  :"application_schema"."Achievement",
  :"application_schema"."AdMetricsDaily",
  :"application_schema"."AdPayment",
  :"application_schema"."AdminAuditEvent",
  :"application_schema"."AiAutomationLog",
  :"application_schema"."AiTaskOutput",
  :"application_schema"."Answer",
  :"application_schema"."ApiCredential",
  :"application_schema"."AppSetting",
  :"application_schema"."ApprovalPolicy",
  :"application_schema"."ApprovalRequest",
  :"application_schema"."AuthAuditLog",
  :"application_schema"."AuthProviderAccount",
  :"application_schema"."AuthSession",
  :"application_schema"."Bounty",
  :"application_schema"."BudgetRule",
  :"application_schema"."CMSConfig",
  :"application_schema"."CareerDailyAction",
  :"application_schema"."Cart",
  :"application_schema"."CartItem",
  :"application_schema"."Category",
  :"application_schema"."ChannelMembership",
  :"application_schema"."ChannelSubscription",
  :"application_schema"."ClientHiringStatus",
  :"application_schema"."ClubInvite",
  :"application_schema"."ClubJoinRequest",
  :"application_schema"."ClubMembership",
  :"application_schema"."CommunityAd",
  :"application_schema"."CommunityBusinessPage",
  :"application_schema"."CommunityBusinessPageAdmin",
  :"application_schema"."CommunityBusinessPageFollower",
  :"application_schema"."CommunityChannel",
  :"application_schema"."CommunityClub",
  :"application_schema"."CommunityEvent",
  :"application_schema"."CommunityMessage",
  :"application_schema"."CommunityNotificationSubscription",
  :"application_schema"."CommunityPoll",
  :"application_schema"."CommunityPollVote",
  :"application_schema"."CommunityPost",
  :"application_schema"."CommunityPostComment",
  :"application_schema"."CommunityPostCommentLike",
  :"application_schema"."CommunityPostFeedback",
  :"application_schema"."CommunityPostHidden",
  :"application_schema"."CommunityPostReaction",
  :"application_schema"."CommunityPostReport",
  :"application_schema"."CommunityStory",
  :"application_schema"."CommunityStoryLike",
  :"application_schema"."CommunityStoryReply",
  :"application_schema"."CommunityStoryView",
  :"application_schema"."ComplianceAppeal",
  :"application_schema"."ComplianceCase",
  :"application_schema"."ComplianceDecisionLog",
  :"application_schema"."ComplianceEvidence",
  :"application_schema"."ConfigChange",
  :"application_schema"."ConfigSnapshot",
  :"application_schema"."ContentLanguageDetection",
  :"application_schema"."ContentPolicy",
  :"application_schema"."ContentTranslation",
  :"application_schema"."ContentTranslationAuditLog",
  :"application_schema"."ContentTranslationGlossaryEntry",
  :"application_schema"."Contract",
  :"application_schema"."Conversation",
  :"application_schema"."ConversationInvite",
  :"application_schema"."ConversationJoinRequest",
  :"application_schema"."ConversationMemberRestriction",
  :"application_schema"."ConversationParticipant",
  :"application_schema"."ConversationPinnedMessage",
  :"application_schema"."ConversationSettings",
  :"application_schema"."CostCenter",
  :"application_schema"."CreatorChallenge",
  :"application_schema"."CreatorChallengeEntry",
  :"application_schema"."CreatorChallengeVote",
  :"application_schema"."CreditNote",
  :"application_schema"."DeliveryReplayJob",
  :"application_schema"."DemandForecast",
  :"application_schema"."DeveloperApp",
  :"application_schema"."DeveloperAppRedirectUri",
  :"application_schema"."DeveloperAuditLog",
  :"application_schema"."DeveloperLinkRequest",
  :"application_schema"."DeveloperPlatformConfig",
  :"application_schema"."DeveloperUser",
  :"application_schema"."DeviceToken",
  :"application_schema"."DirectMessage",
  :"application_schema"."Escrow",
  :"application_schema"."EventDelivery",
  :"application_schema"."EventRegistration",
  :"application_schema"."Favorite",
  :"application_schema"."FeatureAudience",
  :"application_schema"."FeatureExposure",
  :"application_schema"."FeatureFlag",
  :"application_schema"."FeatureFlagAuditLog",
  :"application_schema"."FeatureRule",
  :"application_schema"."FeedIntentSignal",
  :"application_schema"."FeedModePreference",
  :"application_schema"."FileUsage",
  :"application_schema"."ForumComment",
  :"application_schema"."ForumLike",
  :"application_schema"."ForumThread",
  :"application_schema"."FoundingPartner",
  :"application_schema"."FoundingPartnerAuditLog",
  :"application_schema"."FoundingPartnerDistribution",
  :"application_schema"."FoundingPartnerDistributionRun",
  :"application_schema"."FoundingPartnerEnrollmentPayment",
  :"application_schema"."FoundingPartnerProfitPeriod",
  :"application_schema"."FoundingPartnerProfitSource",
  :"application_schema"."FoundingPartnerProgram",
  :"application_schema"."FriendStreak",
  :"application_schema"."FxLock",
  :"application_schema"."FxManualOverride",
  :"application_schema"."FxProvider",
  :"application_schema"."FxRate",
  :"application_schema"."FxSnapshot",
  :"application_schema"."FxSyncJob",
  :"application_schema"."GcoinConfig",
  :"application_schema"."GcoinConversionRequest",
  :"application_schema"."GcoinEarningEvent",
  :"application_schema"."GcoinSettings",
  :"application_schema"."GcoinTransaction",
  :"application_schema"."GcoinWallet",
  :"application_schema"."Gig",
  :"application_schema"."GroupModerationAction",
  :"application_schema"."HiringRecommendationState",
  :"application_schema"."HoldAction",
  :"application_schema"."HumanVerificationAnalytics",
  :"application_schema"."HumanVerificationAttempt",
  :"application_schema"."HumanVerificationAuditLog",
  :"application_schema"."HumanVerificationChallenge",
  :"application_schema"."HumanVerificationSettings",
  :"application_schema"."InsightEvent",
  :"application_schema"."IntegrationEndpoint",
  :"application_schema"."InvoiceRecord",
  :"application_schema"."Job",
  :"application_schema"."JourneyFlow",
  :"application_schema"."JourneyRun",
  :"application_schema"."JourneyStep",
  :"application_schema"."JourneyStepRun",
  :"application_schema"."KYCAuditEvent",
  :"application_schema"."KYCConsent",
  :"application_schema"."KYCDocument",
  :"application_schema"."KYCSubmission",
  :"application_schema"."LanguageConfig",
  :"application_schema"."LiveConfig",
  :"application_schema"."LiveGift",
  :"application_schema"."LiveInvite",
  :"application_schema"."LiveParticipant",
  :"application_schema"."LiveReactionCounter",
  :"application_schema"."LiveReport",
  :"application_schema"."LiveSession",
  :"application_schema"."LoginApprovalAttempt",
  :"application_schema"."LoginTrustedDevice",
  :"application_schema"."LtvPrediction",
  :"application_schema"."ManagedAssignment",
  :"application_schema"."ManagedEscalationRule",
  :"application_schema"."ManagedMilestone",
  :"application_schema"."ManagedProject",
  :"application_schema"."MarketplaceAuditLog",
  :"application_schema"."MarketplaceInquiry",
  :"application_schema"."MarketplaceListing",
  :"application_schema"."MarketplaceListingMedia",
  :"application_schema"."MarketplaceOrder",
  :"application_schema"."MarketplaceReport",
  :"application_schema"."Mention",
  :"application_schema"."MentionRecipient",
  :"application_schema"."MessageReaction",
  :"application_schema"."MessengerVoiceConfig",
  :"application_schema"."ModerationAction",
  :"application_schema"."ModerationAppeal",
  :"application_schema"."ModerationAuditLog",
  :"application_schema"."ModerationCase",
  :"application_schema"."MonetizationApplication",
  :"application_schema"."MonetizationProfile",
  :"application_schema"."Notification",
  :"application_schema"."NotificationAnalyticsCounter",
  :"application_schema"."NotificationAudit",
  :"application_schema"."NotificationCampaign",
  :"application_schema"."NotificationCampaignDelivery",
  :"application_schema"."NotificationDelivery",
  :"application_schema"."NotificationDigest",
  :"application_schema"."NotificationDigestItem",
  :"application_schema"."NotificationDigestSchedule",
  :"application_schema"."NotificationEvent",
  :"application_schema"."NotificationEventPreference",
  :"application_schema"."NotificationFocusSession",
  :"application_schema"."NotificationGlobalPreference",
  :"application_schema"."NotificationLifecycleEvent",
  :"application_schema"."NotificationOpsConfig",
  :"application_schema"."NotificationOpsTemplate",
  :"application_schema"."NotificationPreference",
  :"application_schema"."NotificationRetryJob",
  :"application_schema"."NotificationSyncState",
  :"application_schema"."NotificationTemplate",
  :"application_schema"."OAuthAuthorizationCode",
  :"application_schema"."OAuthConsent",
  :"application_schema"."OAuthExchangeCode",
  :"application_schema"."OAuthToken",
  :"application_schema"."OpportunityMatch",
  :"application_schema"."OpportunityRadarSnapshot",
  :"application_schema"."Order",
  :"application_schema"."OrderPaymentIntent",
  :"application_schema"."OrderPaymentSettlement",
  :"application_schema"."PasskeyChallenge",
  :"application_schema"."PasskeyCredential",
  :"application_schema"."PasswordResetToken",
  :"application_schema"."PaymentSettlement",
  :"application_schema"."PayoutProviderAccount",
  :"application_schema"."PermissionDecisionLog",
  :"application_schema"."PodActivity",
  :"application_schema"."PodMember",
  :"application_schema"."PolicyNamespace",
  :"application_schema"."PolicyResource",
  :"application_schema"."PolicyRule",
  :"application_schema"."PortfolioProof",
  :"application_schema"."PostCollection",
  :"application_schema"."PostCollectionItem",
  :"application_schema"."PostPrediction",
  :"application_schema"."PreloaderConfig",
  :"application_schema"."PresenceLease",
  :"application_schema"."PrivateOpportunityAccess",
  :"application_schema"."ProfessionalAvailability",
  :"application_schema"."ProfessionalScore",
  :"application_schema"."Profile",
  :"application_schema"."ProfileView",
  :"application_schema"."ProjectPod",
  :"application_schema"."Proposal",
  :"application_schema"."PurchaseApproval",
  :"application_schema"."PurchaseOrder",
  :"application_schema"."PurchaseRequest",
  :"application_schema"."QuestCatalog",
  :"application_schema"."QuestCompletionLog",
  :"application_schema"."Question",
  :"application_schema"."QuietHourRule",
  :"application_schema"."Reaction",
  :"application_schema"."RealtimeIncident",
  :"application_schema"."ReleaseRollout",
  :"application_schema"."ResumeAnalysis",
  :"application_schema"."ResumeDocument",
  :"application_schema"."ResumeVersion",
  :"application_schema"."Review",
  :"application_schema"."RiskRule",
  :"application_schema"."RiskScoreSnapshot",
  :"application_schema"."RiskSignal",
  :"application_schema"."RollbackRun",
  :"application_schema"."SavedPipelineItem",
  :"application_schema"."ScrolithMatchInteraction",
  :"application_schema"."ScrolithMatchPreference",
  :"application_schema"."ScrollComment",
  :"application_schema"."ScrollConfig",
  :"application_schema"."ScrollEngagement",
  :"application_schema"."ScrollFeedback",
  :"application_schema"."ScrollHidden",
  :"application_schema"."ScrollPostingRestriction",
  :"application_schema"."ScrollReport",
  :"application_schema"."ScrollSeries",
  :"application_schema"."ScrollSeriesItem",
  :"application_schema"."ScrollTag",
  :"application_schema"."ScrollVideo",
  :"application_schema"."SecurityAlert",
  :"application_schema"."Settings",
  :"application_schema"."SkillGapReport",
  :"application_schema"."SocketSession",
  :"application_schema"."SpendAuthorization",
  :"application_schema"."StaffPermission",
  :"application_schema"."StaffRole",
  :"application_schema"."StaffRolePermission",
  :"application_schema"."StaffUser",
  :"application_schema"."SupportTicket",
  :"application_schema"."SupportTicketCategory",
  :"application_schema"."SupportTicketReply",
  :"application_schema"."TalentPool",
  :"application_schema"."TalentPoolMember",
  :"application_schema"."TextOverride",
  :"application_schema"."TimeEntry",
  :"application_schema"."Topic",
  :"application_schema"."TopicAlias",
  :"application_schema"."TopicFollow",
  :"application_schema"."TrackingSession",
  :"application_schema"."Transaction",
  :"application_schema"."TranslationKey",
  :"application_schema"."TranslationValue",
  :"application_schema"."TrustProfile",
  :"application_schema"."User",
  :"application_schema"."UserAchievement",
  :"application_schema"."UserBlock",
  :"application_schema"."UserFollow",
  :"application_schema"."UserPermissionOverride",
  :"application_schema"."UserQuest",
  :"application_schema"."UserSettings",
  :"application_schema"."UserStreak",
  :"application_schema"."VendorRequirement",
  :"application_schema"."VoiceCall",
  :"application_schema"."VoiceCallParticipant",
  :"application_schema"."VoiceNote",
  :"application_schema"."Wallet",
  :"application_schema"."WalletFundingIntent",
  :"application_schema"."WebhookDeliveryLog",
  :"application_schema"."WeeklyLeaderboard",
  :"application_schema"."WithdrawalRequest",
  :"application_schema"."community_config",
  :"application_schema"."engagement_milestone_state",
  :"application_schema"."engagement_notification_rule",
  :"application_schema"."engagement_signal",
  :"application_schema"."feed_recipe",
  :"application_schema"."file_variants",
  :"application_schema"."files",
  :"application_schema"."fx_quotes",
  :"application_schema"."managed_upload_objects",
  :"application_schema"."reco_config",
  :"application_schema"."reco_feedback_log",
  :"application_schema"."reco_impression_log",
  :"application_schema"."reco_manual_rule",
  :"application_schema"."scrolitha_action_plan",
  :"application_schema"."scrolitha_audit_log",
  :"application_schema"."scrolitha_config",
  :"application_schema"."scrolitha_conversation",
  :"application_schema"."scrolitha_feedback",
  :"application_schema"."scrolitha_message",
  :"application_schema"."scrolitha_skill",
  :"application_schema"."scrolitha_user_preference",
  :"application_schema"."search_ranking_rule"
TO :"runtime_role";

GRANT INSERT ON TABLE
  :"application_schema"."AIAuditLog",
  :"application_schema"."AIConsent",
  :"application_schema"."AIConversation",
  :"application_schema"."AIConversationMessage",
  :"application_schema"."AICopilotLog",
  :"application_schema"."AIFeatureFlag",
  :"application_schema"."AIFeedback",
  :"application_schema"."AILearningSignal",
  :"application_schema"."AIModelConfiguration",
  :"application_schema"."AIPrompt",
  :"application_schema"."AIProviderConfiguration",
  :"application_schema"."AIRecommendationFeedback",
  :"application_schema"."AIRequest",
  :"application_schema"."AIUsageLedger",
  :"application_schema"."AIUserMemory",
  :"application_schema"."AccountViolation",
  :"application_schema"."Achievement",
  :"application_schema"."AdMetricsDaily",
  :"application_schema"."AdPayment",
  :"application_schema"."AdminAuditEvent",
  :"application_schema"."AiTaskOutput",
  :"application_schema"."Answer",
  :"application_schema"."ApiCredential",
  :"application_schema"."AppSetting",
  :"application_schema"."ApprovalPolicy",
  :"application_schema"."ApprovalRequest",
  :"application_schema"."AuthAuditLog",
  :"application_schema"."AuthProviderAccount",
  :"application_schema"."AuthSession",
  :"application_schema"."Bounty",
  :"application_schema"."BudgetRule",
  :"application_schema"."CMSConfig",
  :"application_schema"."CareerDailyAction",
  :"application_schema"."Cart",
  :"application_schema"."CartItem",
  :"application_schema"."Category",
  :"application_schema"."ChannelMembership",
  :"application_schema"."ChannelSubscription",
  :"application_schema"."ClientHiringStatus",
  :"application_schema"."ClubInvite",
  :"application_schema"."ClubJoinRequest",
  :"application_schema"."ClubMembership",
  :"application_schema"."CommunityAd",
  :"application_schema"."CommunityBusinessPage",
  :"application_schema"."CommunityBusinessPageFollower",
  :"application_schema"."CommunityChannel",
  :"application_schema"."CommunityClub",
  :"application_schema"."CommunityEvent",
  :"application_schema"."CommunityMessage",
  :"application_schema"."CommunityNotificationSubscription",
  :"application_schema"."CommunityPoll",
  :"application_schema"."CommunityPollVote",
  :"application_schema"."CommunityPost",
  :"application_schema"."CommunityPostComment",
  :"application_schema"."CommunityPostCommentLike",
  :"application_schema"."CommunityPostFeedback",
  :"application_schema"."CommunityPostHidden",
  :"application_schema"."CommunityPostReaction",
  :"application_schema"."CommunityPostReport",
  :"application_schema"."CommunityStory",
  :"application_schema"."CommunityStoryLike",
  :"application_schema"."CommunityStoryReply",
  :"application_schema"."CommunityStoryView",
  :"application_schema"."ComplianceAppeal",
  :"application_schema"."ComplianceCase",
  :"application_schema"."ComplianceDecisionLog",
  :"application_schema"."ComplianceEvidence",
  :"application_schema"."ConfigChange",
  :"application_schema"."ConfigSnapshot",
  :"application_schema"."ContentLanguageDetection",
  :"application_schema"."ContentPolicy",
  :"application_schema"."ContentTranslation",
  :"application_schema"."ContentTranslationAuditLog",
  :"application_schema"."ContentTranslationGlossaryEntry",
  :"application_schema"."Contract",
  :"application_schema"."Conversation",
  :"application_schema"."ConversationInvite",
  :"application_schema"."ConversationJoinRequest",
  :"application_schema"."ConversationMemberRestriction",
  :"application_schema"."ConversationParticipant",
  :"application_schema"."ConversationPinnedMessage",
  :"application_schema"."ConversationSettings",
  :"application_schema"."CostCenter",
  :"application_schema"."CreatorChallenge",
  :"application_schema"."CreatorChallengeEntry",
  :"application_schema"."CreatorChallengeVote",
  :"application_schema"."CreditNote",
  :"application_schema"."DeliveryReplayJob",
  :"application_schema"."DeveloperApp",
  :"application_schema"."DeveloperAppRedirectUri",
  :"application_schema"."DeveloperAuditLog",
  :"application_schema"."DeveloperLinkRequest",
  :"application_schema"."DeveloperPlatformConfig",
  :"application_schema"."DeveloperUser",
  :"application_schema"."DeviceToken",
  :"application_schema"."DirectMessage",
  :"application_schema"."Escrow",
  :"application_schema"."EventDelivery",
  :"application_schema"."EventRegistration",
  :"application_schema"."Favorite",
  :"application_schema"."FeatureAudience",
  :"application_schema"."FeatureExposure",
  :"application_schema"."FeatureFlag",
  :"application_schema"."FeatureFlagAuditLog",
  :"application_schema"."FeatureRule",
  :"application_schema"."FeedIntentSignal",
  :"application_schema"."FeedModePreference",
  :"application_schema"."FileUsage",
  :"application_schema"."ForumComment",
  :"application_schema"."ForumLike",
  :"application_schema"."ForumThread",
  :"application_schema"."FoundingPartner",
  :"application_schema"."FoundingPartnerAuditLog",
  :"application_schema"."FoundingPartnerDistribution",
  :"application_schema"."FoundingPartnerDistributionRun",
  :"application_schema"."FoundingPartnerEnrollmentPayment",
  :"application_schema"."FoundingPartnerProfitPeriod",
  :"application_schema"."FoundingPartnerProfitSource",
  :"application_schema"."FoundingPartnerProgram",
  :"application_schema"."FriendStreak",
  :"application_schema"."FxLock",
  :"application_schema"."FxManualOverride",
  :"application_schema"."FxProvider",
  :"application_schema"."FxRate",
  :"application_schema"."FxSnapshot",
  :"application_schema"."FxSyncJob",
  :"application_schema"."GcoinConversionRequest",
  :"application_schema"."GcoinEarningEvent",
  :"application_schema"."GcoinSettings",
  :"application_schema"."GcoinTransaction",
  :"application_schema"."GcoinWallet",
  :"application_schema"."Gig",
  :"application_schema"."GroupModerationAction",
  :"application_schema"."HiringRecommendationState",
  :"application_schema"."HoldAction",
  :"application_schema"."HumanVerificationAnalytics",
  :"application_schema"."HumanVerificationAttempt",
  :"application_schema"."HumanVerificationAuditLog",
  :"application_schema"."HumanVerificationChallenge",
  :"application_schema"."HumanVerificationSettings",
  :"application_schema"."InsightEvent",
  :"application_schema"."IntegrationEndpoint",
  :"application_schema"."InvoiceRecord",
  :"application_schema"."Job",
  :"application_schema"."JourneyFlow",
  :"application_schema"."JourneyRun",
  :"application_schema"."JourneyStep",
  :"application_schema"."JourneyStepRun",
  :"application_schema"."KYCAuditEvent",
  :"application_schema"."KYCConsent",
  :"application_schema"."KYCDocument",
  :"application_schema"."KYCSubmission",
  :"application_schema"."LanguageConfig",
  :"application_schema"."LiveConfig",
  :"application_schema"."LiveGift",
  :"application_schema"."LiveInvite",
  :"application_schema"."LiveParticipant",
  :"application_schema"."LiveReactionCounter",
  :"application_schema"."LiveReport",
  :"application_schema"."LiveSession",
  :"application_schema"."LoginApprovalAttempt",
  :"application_schema"."LoginTrustedDevice",
  :"application_schema"."ManagedAssignment",
  :"application_schema"."ManagedEscalationRule",
  :"application_schema"."ManagedMilestone",
  :"application_schema"."ManagedProject",
  :"application_schema"."MarketplaceAuditLog",
  :"application_schema"."MarketplaceInquiry",
  :"application_schema"."MarketplaceListing",
  :"application_schema"."MarketplaceListingMedia",
  :"application_schema"."MarketplaceOrder",
  :"application_schema"."MarketplaceReport",
  :"application_schema"."Mention",
  :"application_schema"."MentionRecipient",
  :"application_schema"."MessageReaction",
  :"application_schema"."MessengerVoiceConfig",
  :"application_schema"."ModerationAction",
  :"application_schema"."ModerationAuditLog",
  :"application_schema"."MonetizationApplication",
  :"application_schema"."MonetizationProfile",
  :"application_schema"."Notification",
  :"application_schema"."NotificationAnalyticsCounter",
  :"application_schema"."NotificationAudit",
  :"application_schema"."NotificationCampaign",
  :"application_schema"."NotificationCampaignDelivery",
  :"application_schema"."NotificationDelivery",
  :"application_schema"."NotificationDigest",
  :"application_schema"."NotificationDigestItem",
  :"application_schema"."NotificationDigestSchedule",
  :"application_schema"."NotificationEvent",
  :"application_schema"."NotificationEventPreference",
  :"application_schema"."NotificationFocusSession",
  :"application_schema"."NotificationGlobalPreference",
  :"application_schema"."NotificationOpsConfig",
  :"application_schema"."NotificationOpsTemplate",
  :"application_schema"."NotificationPreference",
  :"application_schema"."NotificationRetryJob",
  :"application_schema"."NotificationSyncState",
  :"application_schema"."NotificationTemplate",
  :"application_schema"."OAuthAuthorizationCode",
  :"application_schema"."OAuthConsent",
  :"application_schema"."OAuthExchangeCode",
  :"application_schema"."OAuthToken",
  :"application_schema"."OpportunityMatch",
  :"application_schema"."Order",
  :"application_schema"."OrderPaymentIntent",
  :"application_schema"."OrderPaymentSettlement",
  :"application_schema"."PasskeyChallenge",
  :"application_schema"."PasskeyCredential",
  :"application_schema"."PasswordResetToken",
  :"application_schema"."PaymentSettlement",
  :"application_schema"."PayoutProviderAccount",
  :"application_schema"."PermissionDecisionLog",
  :"application_schema"."PodActivity",
  :"application_schema"."PodMember",
  :"application_schema"."PolicyNamespace",
  :"application_schema"."PolicyResource",
  :"application_schema"."PolicyRule",
  :"application_schema"."PostCollection",
  :"application_schema"."PostCollectionItem",
  :"application_schema"."PostPrediction",
  :"application_schema"."PreloaderConfig",
  :"application_schema"."PresenceLease",
  :"application_schema"."PrivateOpportunityAccess",
  :"application_schema"."ProfessionalAvailability",
  :"application_schema"."ProfessionalScore",
  :"application_schema"."Profile",
  :"application_schema"."ProfileView",
  :"application_schema"."ProjectPod",
  :"application_schema"."Proposal",
  :"application_schema"."PurchaseApproval",
  :"application_schema"."PurchaseOrder",
  :"application_schema"."PurchaseRequest",
  :"application_schema"."QuestCatalog",
  :"application_schema"."QuestCompletionLog",
  :"application_schema"."Question",
  :"application_schema"."QuietHourRule",
  :"application_schema"."Reaction",
  :"application_schema"."RealtimeIncident",
  :"application_schema"."ReleaseRollout",
  :"application_schema"."ResumeAnalysis",
  :"application_schema"."ResumeDocument",
  :"application_schema"."ResumeVersion",
  :"application_schema"."Review",
  :"application_schema"."RiskRule",
  :"application_schema"."RiskScoreSnapshot",
  :"application_schema"."RiskSignal",
  :"application_schema"."RollbackRun",
  :"application_schema"."SavedPipelineItem",
  :"application_schema"."ScrolithMatchInteraction",
  :"application_schema"."ScrolithMatchPreference",
  :"application_schema"."ScrollComment",
  :"application_schema"."ScrollConfig",
  :"application_schema"."ScrollEngagement",
  :"application_schema"."ScrollFeedback",
  :"application_schema"."ScrollHidden",
  :"application_schema"."ScrollPostingRestriction",
  :"application_schema"."ScrollReport",
  :"application_schema"."ScrollSeries",
  :"application_schema"."ScrollSeriesItem",
  :"application_schema"."ScrollTag",
  :"application_schema"."ScrollVideo",
  :"application_schema"."SecurityAlert",
  :"application_schema"."Settings",
  :"application_schema"."SkillGapReport",
  :"application_schema"."SocketSession",
  :"application_schema"."SpendAuthorization",
  :"application_schema"."StaffPermission",
  :"application_schema"."StaffRole",
  :"application_schema"."StaffRolePermission",
  :"application_schema"."StaffUser",
  :"application_schema"."SupportTicket",
  :"application_schema"."SupportTicketCategory",
  :"application_schema"."SupportTicketReply",
  :"application_schema"."TalentPool",
  :"application_schema"."TalentPoolMember",
  :"application_schema"."TextOverride",
  :"application_schema"."TimeEntry",
  :"application_schema"."Topic",
  :"application_schema"."TopicAlias",
  :"application_schema"."TopicFollow",
  :"application_schema"."TrackingSession",
  :"application_schema"."Transaction",
  :"application_schema"."TranslationKey",
  :"application_schema"."TranslationValue",
  :"application_schema"."TrustProfile",
  :"application_schema"."User",
  :"application_schema"."UserAchievement",
  :"application_schema"."UserBlock",
  :"application_schema"."UserFollow",
  :"application_schema"."UserPermissionOverride",
  :"application_schema"."UserQuest",
  :"application_schema"."UserSettings",
  :"application_schema"."UserStreak",
  :"application_schema"."VendorRequirement",
  :"application_schema"."VoiceCall",
  :"application_schema"."VoiceCallParticipant",
  :"application_schema"."VoiceNote",
  :"application_schema"."Wallet",
  :"application_schema"."WalletFundingIntent",
  :"application_schema"."WebhookDeliveryLog",
  :"application_schema"."WeeklyLeaderboard",
  :"application_schema"."WithdrawalRequest",
  :"application_schema"."community_config",
  :"application_schema"."engagement_milestone_state",
  :"application_schema"."engagement_notification_rule",
  :"application_schema"."engagement_signal",
  :"application_schema"."feed_recipe",
  :"application_schema"."file_variants",
  :"application_schema"."files",
  :"application_schema"."fx_quotes",
  :"application_schema"."managed_upload_objects",
  :"application_schema"."reco_config",
  :"application_schema"."reco_feedback_log",
  :"application_schema"."reco_impression_log",
  :"application_schema"."reco_manual_rule",
  :"application_schema"."scrolitha_action_plan",
  :"application_schema"."scrolitha_audit_log",
  :"application_schema"."scrolitha_config",
  :"application_schema"."scrolitha_conversation",
  :"application_schema"."scrolitha_feedback",
  :"application_schema"."scrolitha_message",
  :"application_schema"."scrolitha_skill",
  :"application_schema"."scrolitha_user_preference",
  :"application_schema"."search_ranking_rule"
TO :"runtime_role";

GRANT DELETE ON TABLE
  :"application_schema"."AIConversation",
  :"application_schema"."AIConversationMessage",
  :"application_schema"."AIRequest",
  :"application_schema"."AIUserMemory",
  :"application_schema"."AppSetting",
  :"application_schema"."AuthSession",
  :"application_schema"."Cart",
  :"application_schema"."CartItem",
  :"application_schema"."Category",
  :"application_schema"."ChannelMembership",
  :"application_schema"."ClubMembership",
  :"application_schema"."CommunityAd",
  :"application_schema"."CommunityBusinessPage",
  :"application_schema"."CommunityBusinessPageFollower",
  :"application_schema"."CommunityClub",
  :"application_schema"."CommunityEvent",
  :"application_schema"."CommunityNotificationSubscription",
  :"application_schema"."CommunityPostComment",
  :"application_schema"."CommunityPostCommentLike",
  :"application_schema"."CommunityPostReaction",
  :"application_schema"."CommunityStory",
  :"application_schema"."CommunityStoryLike",
  :"application_schema"."CommunityStoryReply",
  :"application_schema"."ContentTranslationGlossaryEntry",
  :"application_schema"."ConversationPinnedMessage",
  :"application_schema"."DeviceToken",
  :"application_schema"."EventRegistration",
  :"application_schema"."Favorite",
  :"application_schema"."FileUsage",
  :"application_schema"."ForumComment",
  :"application_schema"."ForumLike",
  :"application_schema"."ForumThread",
  :"application_schema"."Gig",
  :"application_schema"."Job",
  :"application_schema"."MarketplaceListingMedia",
  :"application_schema"."MessageReaction",
  :"application_schema"."NotificationAudit",
  :"application_schema"."NotificationDelivery",
  :"application_schema"."NotificationDigest",
  :"application_schema"."NotificationDigestItem",
  :"application_schema"."NotificationEvent",
  :"application_schema"."NotificationEventPreference",
  :"application_schema"."NotificationGlobalPreference",
  :"application_schema"."NotificationLifecycleEvent",
  :"application_schema"."NotificationPreference",
  :"application_schema"."OAuthExchangeCode",
  :"application_schema"."OpportunityMatch",
  :"application_schema"."PasskeyChallenge",
  :"application_schema"."PasswordResetToken",
  :"application_schema"."PostCollectionItem",
  :"application_schema"."PreloaderConfig",
  :"application_schema"."Reaction",
  :"application_schema"."ResumeAnalysis",
  :"application_schema"."ResumeDocument",
  :"application_schema"."SavedPipelineItem",
  :"application_schema"."ScrollEngagement",
  :"application_schema"."ScrollSeries",
  :"application_schema"."ScrollSeriesItem",
  :"application_schema"."ScrollTag",
  :"application_schema"."ScrollVideo",
  :"application_schema"."StaffRolePermission",
  :"application_schema"."SupportTicketCategory",
  :"application_schema"."TextOverride",
  :"application_schema"."TopicFollow",
  :"application_schema"."UserBlock",
  :"application_schema"."UserFollow",
  :"application_schema"."files",
  :"application_schema"."managed_upload_objects",
  :"application_schema"."reco_manual_rule",
  :"application_schema"."scrolitha_skill"
TO :"runtime_role";

GRANT UPDATE ("resolvedAt") ON TABLE :"application_schema"."AccountViolation" TO :"runtime_role";
GRANT UPDATE ("description", "isActive", "rules", "tier", "title", "updatedAt") ON TABLE :"application_schema"."Achievement" TO :"runtime_role";
GRANT UPDATE ("clicks", "impressions", "spend") ON TABLE :"application_schema"."AdMetricsDaily" TO :"runtime_role";
GRANT UPDATE ("amount", "currency", "status") ON TABLE :"application_schema"."AdPayment" TO :"runtime_role";
GRANT UPDATE ("aiActivityHistoryEnabled", "aiFeaturesEnabled", "aiSuggestionsAllowed", "consentVersion", "externalProviderProcessingAllowed", "personalizationAllowed", "privateMessageAnalysisAllowed", "productImprovementDataAllowed", "updatedAt") ON TABLE :"application_schema"."AIConsent" TO :"runtime_role";
GRANT UPDATE ("archived", "lastMessageAt", "messageCount", "pinned", "title", "updatedAt") ON TABLE :"application_schema"."AIConversation" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "updatedBy", "value", "version") ON TABLE :"application_schema"."AIFeatureFlag" TO :"runtime_role";
GRANT UPDATE ("displayName", "enabled", "maxTokens", "updatedAt") ON TABLE :"application_schema"."AIModelConfiguration" TO :"runtime_role";
GRANT UPDATE ("inputTemplate", "status", "systemInstructions", "updatedAt", "version") ON TABLE :"application_schema"."AIPrompt" TO :"runtime_role";
GRANT UPDATE ("config", "enabled", "updatedAt", "updatedBy") ON TABLE :"application_schema"."AIProviderConfiguration" TO :"runtime_role";
GRANT UPDATE ("human_override_state", "metadata", "updated_at") ON TABLE :"application_schema"."AiTaskOutput" TO :"runtime_role";
GRANT UPDATE ("favoriteCommunities", "mutedEntityIds", "mutedTopics", "preferredIndustries", "preferredLanguages", "preferredTopics", "signalWeights", "updatedAt", "version") ON TABLE :"application_schema"."AIUserMemory" TO :"runtime_role";
GRANT UPDATE ("isAccepted", "updatedAt") ON TABLE :"application_schema"."Answer" TO :"runtime_role";
GRANT UPDATE ("last_used_at", "metadata", "name", "scopes", "status", "updated_at") ON TABLE :"application_schema"."ApiCredential" TO :"runtime_role";
GRANT UPDATE ("action_key", "description", "entity_type", "is_active", "is_system_policy", "label", "min_approvals", "mode", "module_key", "updated_at", "updated_by_staff_id") ON TABLE :"application_schema"."ApprovalPolicy" TO :"runtime_role";
GRANT UPDATE ("decided_at", "decided_by_staff_id", "decision_reason", "status", "updated_at") ON TABLE :"application_schema"."ApprovalRequest" TO :"runtime_role";
GRANT UPDATE ("data", "updatedAt") ON TABLE :"application_schema"."AppSetting" TO :"runtime_role";
GRANT UPDATE ("revokeReason", "revokedAt") ON TABLE :"application_schema"."AuthSession" TO :"runtime_role";
GRANT UPDATE ("awardedAnswerId", "awardedAt", "status", "updatedAt") ON TABLE :"application_schema"."Bounty" TO :"runtime_role";
GRANT UPDATE ("alert_threshold_percent", "approval_threshold", "cost_center_id", "currency", "department", "hard_stop", "interval", "is_active", "limit_amount", "metadata", "project_code", "updated_at") ON TABLE :"application_schema"."BudgetRule" TO :"runtime_role";
GRANT UPDATE ("updatedAt") ON TABLE :"application_schema"."Cart" TO :"runtime_role";
GRANT UPDATE ("quantity", "updatedAt") ON TABLE :"application_schema"."CartItem" TO :"runtime_role";
GRANT UPDATE ("description", "icon", "isActive", "name", "order", "parentId", "slug", "type", "updatedAt") ON TABLE :"application_schema"."Category" TO :"runtime_role";
GRANT UPDATE ("cancelAtPeriodEnd", "endsAt", "planId", "status", "updatedAt") ON TABLE :"application_schema"."ChannelSubscription" TO :"runtime_role";
GRANT UPDATE ("expiresAt", "focusAreas", "hiringTypes", "isActive", "status", "timing", "updatedAt", "visibility") ON TABLE :"application_schema"."ClientHiringStatus" TO :"runtime_role";
GRANT UPDATE ("invitedAt", "invitedById", "note", "respondedAt", "role", "status") ON TABLE :"application_schema"."ClubInvite" TO :"runtime_role";
GRANT UPDATE ("answers", "note", "requestedAt", "reviewNote", "reviewedAt", "reviewedById", "status") ON TABLE :"application_schema"."ClubJoinRequest" TO :"runtime_role";
GRANT UPDATE ("invitedById", "role", "status", "updatedAt") ON TABLE :"application_schema"."ClubMembership" TO :"runtime_role";
GRANT UPDATE ("updatedAt") ON TABLE :"application_schema"."community_config" TO :"runtime_role";
GRANT UPDATE ("adminReviewNotes", "archiveReason", "archivedAt", "archivedById", "currency", "impressions", "paymentTransactionId", "remainingBudget", "status", "targeting", "updatedAt") ON TABLE :"application_schema"."CommunityAd" TO :"runtime_role";
GRANT UPDATE ("coverFileId", "logoFileId", "status", "statusReason", "statusUpdatedAt", "statusUpdatedBy", "updatedAt") ON TABLE :"application_schema"."CommunityBusinessPage" TO :"runtime_role";
GRANT UPDATE ("businessPageId", "description", "isPublic", "lastActivity", "memberCount", "name", "type", "updatedAt") ON TABLE :"application_schema"."CommunityChannel" TO :"runtime_role";
GRANT UPDATE ("avatarImage", "category", "coverImage", "description", "faqs", "joinMode", "location", "memberCount", "membersCanInvite", "name", "postPermission", "postingGuidelines", "slug", "summary", "updatedAt", "visibility") ON TABLE :"application_schema"."CommunityClub" TO :"runtime_role";
GRANT UPDATE ("attendeeCount", "image", "updatedAt") ON TABLE :"application_schema"."CommunityEvent" TO :"runtime_role";
GRANT UPDATE ("enabled", "updatedAt") ON TABLE :"application_schema"."CommunityNotificationSubscription" TO :"runtime_role";
GRANT UPDATE ("optionId", "updatedAt") ON TABLE :"application_schema"."CommunityPollVote" TO :"runtime_role";
GRANT UPDATE ("aiInsightEnabled", "aiInsightGenerated", "aiInsightText", "aiScore", "attachments", "contentHash", "detectedLanguageCodes", "isHighlighted", "isMixedLanguage", "isPinned", "languageDetectedAt", "languageDetectionStatus", "languageManuallySet", "likesCount", "sourceLanguage", "sourceLanguageConfidence", "status", "translationVersion", "updatedAt") ON TABLE :"application_schema"."CommunityPost" TO :"runtime_role";
GRANT UPDATE ("attachments", "content", "deletedAt", "status", "updatedAt") ON TABLE :"application_schema"."CommunityPostComment" TO :"runtime_role";
GRANT UPDATE ("signal", "updatedAt") ON TABLE :"application_schema"."CommunityPostFeedback" TO :"runtime_role";
GRANT UPDATE ("type") ON TABLE :"application_schema"."CommunityPostReaction" TO :"runtime_role";
GRANT UPDATE ("details", "reason", "status", "updatedAt") ON TABLE :"application_schema"."CommunityPostReport" TO :"runtime_role";
GRANT UPDATE ("commentsCount", "updatedAt") ON TABLE :"application_schema"."CommunityStory" TO :"runtime_role";
GRANT UPDATE ("createdAt") ON TABLE :"application_schema"."CommunityStoryView" TO :"runtime_role";
GRANT UPDATE ("metadata", "resolution_note", "status", "updated_at") ON TABLE :"application_schema"."ComplianceAppeal" TO :"runtime_role";
GRANT UPDATE ("hold_state", "status", "updated_at") ON TABLE :"application_schema"."ComplianceCase" TO :"runtime_role";
GRANT UPDATE ("confidence", "detectorKey", "metadata", "sourceLocale", "updatedAt") ON TABLE :"application_schema"."ContentLanguageDetection" TO :"runtime_role";
GRANT UPDATE ("action", "contentType", "description", "isActive", "isSystemPolicy", "key", "label", "metadata", "severity", "thresholds", "updatedAt", "updatedByStaffId") ON TABLE :"application_schema"."ContentPolicy" TO :"runtime_role";
GRANT UPDATE ("engineKey", "errorMessage", "glossaryApplied", "latencyMs", "metadata", "modelVersion", "sourceLocale", "status", "translatedContent", "translatedTitle", "updatedAt") ON TABLE :"application_schema"."ContentTranslation" TO :"runtime_role";
GRANT UPDATE ("caseSensitive", "enabled", "locale", "priority", "replacementText", "sourceText", "targetLocale", "updatedAt", "updatedById") ON TABLE :"application_schema"."ContentTranslationGlossaryEntry" TO :"runtime_role";
GRANT UPDATE ("milestones", "status", "updatedAt") ON TABLE :"application_schema"."Contract" TO :"runtime_role";
GRANT UPDATE ("lastMessageAt", "lastMessageSenderId", "lastMessageText", "updatedAt") ON TABLE :"application_schema"."Conversation" TO :"runtime_role";
GRANT UPDATE ("acceptedAt", "inviteeUserId", "status", "useCount") ON TABLE :"application_schema"."ConversationInvite" TO :"runtime_role";
GRANT UPDATE ("message", "reviewedAt", "reviewedById", "status", "updatedAt") ON TABLE :"application_schema"."ConversationJoinRequest" TO :"runtime_role";
GRANT UPDATE ("deletedAt", "isArchived", "isMuted", "isStarred", "label", "lastReadAt", "role") ON TABLE :"application_schema"."ConversationParticipant" TO :"runtime_role";
GRANT UPDATE ("allowAudio", "allowContacts", "allowCopy", "allowDelete", "allowEditing", "allowEvents", "allowExternalLinks", "allowFiles", "allowForward", "allowGifs", "allowImages", "allowLocation", "allowPolls", "allowReactions", "allowStickers", "allowVideos", "allowVoice", "maxMentionsPerMessage", "policyJson", "updatedAt") ON TABLE :"application_schema"."ConversationSettings" TO :"runtime_role";
GRANT UPDATE ("approval_threshold", "code", "currency", "department", "is_active", "metadata", "monthly_budget", "name", "project_code", "quarterly_budget", "spend_cap", "updated_at") ON TABLE :"application_schema"."CostCenter" TO :"runtime_role";
GRANT UPDATE ("category", "contentTypes", "description", "endAt", "entryLimitPerUser", "finalizedAt", "isActive", "key", "maxWinners", "reward", "rules", "startAt", "status", "title", "updatedAt", "updatedById", "weekKey", "winningEntryIds") ON TABLE :"application_schema"."CreatorChallenge" TO :"runtime_role";
GRANT UPDATE ("isWinner", "position", "status", "updatedAt", "voteCount") ON TABLE :"application_schema"."CreatorChallengeEntry" TO :"runtime_role";
GRANT UPDATE ("entryId", "updatedAt") ON TABLE :"application_schema"."CreatorChallengeVote" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "approvedByAdminId", "clientSecretHash", "disabledAt", "lastSecretRotatedAt", "status", "updatedAt") ON TABLE :"application_schema"."DeveloperApp" TO :"runtime_role";
GRANT UPDATE ("isActive", "updatedAt") ON TABLE :"application_schema"."DeveloperAppRedirectUri" TO :"runtime_role";
GRANT UPDATE ("status", "updatedAt", "verifiedAt") ON TABLE :"application_schema"."DeveloperLinkRequest" TO :"runtime_role";
GRANT UPDATE ("accessTokenTtlSeconds", "authorizationCodeTtlSeconds", "autoApproveEnabled", "autoApproveRules", "developerBaseUrl", "rateLimitPerMinute", "refreshTokenTtlSeconds", "requireManualApprovalForSensitiveScope", "sensitiveScopes", "updatedAt", "updatedByAdminId") ON TABLE :"application_schema"."DeveloperPlatformConfig" TO :"runtime_role";
GRANT UPDATE ("developerEmail", "lastSyncedAt", "linkStatus", "linkedAt", "syncSnapshot", "updatedAt", "userId") ON TABLE :"application_schema"."DeveloperUser" TO :"runtime_role";
GRANT UPDATE ("appVersion", "capabilities", "deviceId", "deviceName", "lastSeenAt", "lastSyncAt", "notificationCapable", "platform", "pushStatus", "updatedAt", "userId") ON TABLE :"application_schema"."DeviceToken" TO :"runtime_role";
GRANT UPDATE ("attachments", "conversationId", "deletedAt", "editedAt", "text") ON TABLE :"application_schema"."DirectMessage" TO :"runtime_role";
GRANT UPDATE ("emitted_at", "notification_id", "status", "suppressed_reason", "updated_at") ON TABLE :"application_schema"."engagement_milestone_state" TO :"runtime_role";
GRANT UPDATE ("ai_assistance_enabled", "body_template", "category", "cooldown_seconds", "deep_link_template", "event_type", "frequency_window_seconds", "in_app_enabled", "is_enabled", "max_notifications_per_window", "metadata", "name", "priority", "push_enabled", "rollout_percentage", "template_key", "thresholds", "title_template", "updated_at", "updated_by_id") ON TABLE :"application_schema"."engagement_notification_rule" TO :"runtime_role";
GRANT UPDATE ("aggregate_count", "owner_id") ON TABLE :"application_schema"."engagement_signal" TO :"runtime_role";
GRANT UPDATE ("commission", "fundedAt", "refundedAt", "releasedAt", "status", "updatedAt") ON TABLE :"application_schema"."Escrow" TO :"runtime_role";
GRANT UPDATE ("replayedAt") ON TABLE :"application_schema"."EventDelivery" TO :"runtime_role";
GRANT UPDATE ("appVersions", "countryScope", "isActive", "key", "label", "metadata", "platformScope", "roleScope", "updatedAt") ON TABLE :"application_schema"."FeatureAudience" TO :"runtime_role";
GRANT UPDATE ("category", "defaultValue", "description", "isActive", "key", "killSwitch", "label", "updatedAt") ON TABLE :"application_schema"."FeatureFlag" TO :"runtime_role";
GRANT UPDATE ("audienceId", "conditions", "endAt", "isActive", "priority", "rolloutPercent", "startAt", "updatedAt", "value") ON TABLE :"application_schema"."FeatureRule" TO :"runtime_role";
GRANT UPDATE ("description", "is_active", "is_system_recipe", "key", "label", "mode", "query_take_cap", "query_take_multiplier", "updated_at", "updated_by_staff_id", "weights") ON TABLE :"application_schema"."feed_recipe" TO :"runtime_role";
GRANT UPDATE ("mode", "updatedAt") ON TABLE :"application_schema"."FeedModePreference" TO :"runtime_role";
GRANT UPDATE ("checksum", "height", "mime_type", "size_bytes", "status", "storage_key", "storage_provider", "updated_at") ON TABLE :"application_schema"."file_variants" TO :"runtime_role";
GRANT UPDATE ("duration", "filename", "height", "mime_type", "original_name", "owner_id", "ownerRole", "processing_completed_at", "processing_error_code", "processing_started_at", "processing_status", "processing_version", "size", "storage_key", "storage_provider", "thumbnail_url", "url", "variants_manifest", "videoPerceptualHash", "videoPerceptualHashVersion", "visibility", "width") ON TABLE :"application_schema"."files" TO :"runtime_role";
GRANT UPDATE ("isLocked", "isPinned", "status", "updatedAt") ON TABLE :"application_schema"."ForumThread" TO :"runtime_role";
GRANT UPDATE ("deactivatedAt", "deactivatedReason", "reactivatedAt", "status", "updatedAt") ON TABLE :"application_schema"."FoundingPartner" TO :"runtime_role";
GRANT UPDATE ("creditedAt", "fxRate", "status", "updatedAt", "walletAmount", "walletCurrency", "walletTransactionId") ON TABLE :"application_schema"."FoundingPartnerDistribution" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "approvedById", "completedAt", "executedAt", "executedById", "failureReason", "status", "updatedAt") ON TABLE :"application_schema"."FoundingPartnerDistributionRun" TO :"runtime_role";
GRANT UPDATE ("chargedAmount", "chargedCurrency", "fxRate", "fxRateSource", "fxSnapshotId", "partnerId", "providerIntentId", "providerPayload", "providerReferenceId", "settledAt", "sourceAmount", "sourceCurrency", "status", "updatedAt") ON TABLE :"application_schema"."FoundingPartnerEnrollmentPayment" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "approvedById", "clearedProfit", "closedAt", "distributedAt", "notes", "partnerPool", "status", "updatedAt") ON TABLE :"application_schema"."FoundingPartnerProfitPeriod" TO :"runtime_role";
GRANT UPDATE ("adjustments", "clearedAmount", "notes", "updatedAt") ON TABLE :"application_schema"."FoundingPartnerProfitSource" TO :"runtime_role";
GRANT UPDATE ("enrolledCount", "status", "updatedAt") ON TABLE :"application_schema"."FoundingPartnerProgram" TO :"runtime_role";
GRANT UPDATE ("acceptedAt", "endedAt", "initiatedByUserId", "invitedAt", "respondedAt", "status", "updatedAt") ON TABLE :"application_schema"."FriendStreak" TO :"runtime_role";
GRANT UPDATE ("consumed_at", "status", "updated_at") ON TABLE :"application_schema"."fx_quotes" TO :"runtime_role";
GRANT UPDATE ("approvedById", "status", "updatedAt") ON TABLE :"application_schema"."FxManualOverride" TO :"runtime_role";
GRANT UPDATE ("baseUrl", "enabled", "kind", "name", "priority", "settingsJson", "updatedAt") ON TABLE :"application_schema"."FxProvider" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "approvedById", "isFrozen", "status") ON TABLE :"application_schema"."FxSnapshot" TO :"runtime_role";
GRANT UPDATE ("error", "finishedAt", "meta", "recordsInserted", "snapshotId", "status") ON TABLE :"application_schema"."FxSyncJob" TO :"runtime_role";
GRANT UPDATE ("processedAt", "processedBy", "status") ON TABLE :"application_schema"."GcoinConversionRequest" TO :"runtime_role";
GRANT UPDATE ("reactionActive", "reversalCount", "reversedAt") ON TABLE :"application_schema"."GcoinEarningEvent" TO :"runtime_role";
GRANT UPDATE ("adminFeePercent", "autoApproveConversions", "coinPerLikesUnit", "coinPerRepostsUnit", "coinPerSharesUnit", "coinPerViewsUnit", "conversionEnabled", "conversionRate", "likesUnit", "minWithdrawal", "repostsUnit", "sharesUnit", "transferFeeType", "transferFeeValue", "updatedAt", "userTransfersEnabled", "viewsUnit") ON TABLE :"application_schema"."GcoinSettings" TO :"runtime_role";
GRANT UPDATE ("balance", "fraudScore", "lifetimeEarned", "status", "updatedAt") ON TABLE :"application_schema"."GcoinWallet" TO :"runtime_role";
GRANT UPDATE ("adminReason", "adminStatus", "categoryId", "deliveryTime", "description", "documents", "extras", "faqs", "image", "images", "isActive", "isFeatured", "isRecommended", "isTopSelected", "meta", "packages", "price", "pricingMode", "requirements", "revisions", "slug", "status", "subcategory", "tags", "title", "updatedAt", "userId", "videos") ON TABLE :"application_schema"."Gig" TO :"runtime_role";
GRANT UPDATE ("activatedAt", "dismissCount", "impressionCount", "lastClickedAt", "lastDismissedAt", "lastShownAt", "sessionImpressionCount", "sessionKey", "snoozeUntil", "updatedAt") ON TABLE :"application_schema"."HiringRecommendationState" TO :"runtime_role";
GRANT UPDATE ("metadata", "released_at", "status", "updated_at") ON TABLE :"application_schema"."HoldAction" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "value") ON TABLE :"application_schema"."HumanVerificationAnalytics" TO :"runtime_role";
GRANT UPDATE ("attemptCount", "solveTimeMs", "solvedAt", "status", "usedAt", "verificationConsumedAt", "verificationExpiresAt", "verificationTokenHash") ON TABLE :"application_schema"."HumanVerificationChallenge" TO :"runtime_role";
GRANT UPDATE ("data", "updatedAt", "updatedBy") ON TABLE :"application_schema"."HumanVerificationSettings" TO :"runtime_role";
GRANT UPDATE ("dead_letter_enabled", "event_types", "metadata", "name", "retry_policy", "secret_hash", "status", "target_url", "type", "updated_at") ON TABLE :"application_schema"."IntegrationEndpoint" TO :"runtime_role";
GRANT UPDATE ("approved_at", "document_payload", "metadata", "split_breakdown", "status", "updated_at") ON TABLE :"application_schema"."InvoiceRecord" TO :"runtime_role";
GRANT UPDATE ("adminReason", "adminStatus", "attachments", "budget", "categoryId", "clientId", "description", "duration", "experienceLevel", "isActive", "isFeatured", "isRecommended", "isTopSelected", "isVisible", "proposalsCount", "status", "subcategory", "tags", "title", "type", "updatedAt", "visibility") ON TABLE :"application_schema"."Job" TO :"runtime_role";
GRANT UPDATE ("audienceConfig", "audienceType", "description", "isActive", "isSystemFlow", "key", "label", "metadata", "triggerType", "updatedAt", "updatedByStaffId") ON TABLE :"application_schema"."JourneyFlow" TO :"runtime_role";
GRANT UPDATE ("completedAt", "lastError", "results", "status", "updatedAt") ON TABLE :"application_schema"."JourneyRun" TO :"runtime_role";
GRANT UPDATE ("actionUrl", "channel", "conditionConfig", "delayMinutes", "description", "flowId", "isActive", "key", "label", "metadata", "orderIndex", "templateId", "updatedAt") ON TABLE :"application_schema"."JourneyStep" TO :"runtime_role";
GRANT UPDATE ("attemptCount", "errorMessage", "executedAt", "result", "status", "updatedAt") ON TABLE :"application_schema"."JourneyStepRun" TO :"runtime_role";
GRANT UPDATE ("contentType", "fileUrl", "height", "metadataStripped", "normalizedAt", "objectKey", "promotedAt", "quarantineObjectKey", "quarantineStatus", "rejectionReason", "scanDefinitionVersion", "scanEngine", "scanStatus", "scannedAt", "sha256", "sizeBytes", "status", "storageClass", "submissionId", "type", "updatedAt", "visibility", "width") ON TABLE :"application_schema"."KYCDocument" TO :"runtime_role";
GRANT UPDATE ("consentAcceptedAt", "consentPolicyVersion", "decisionReasonCode", "personalInfo", "rejectionReason", "resubmissionCount", "retentionPolicyKey", "reviewedAt", "reviewedBy", "status", "updatedAt") ON TABLE :"application_schema"."KYCSubmission" TO :"runtime_role";
GRANT UPDATE ("defaultLocale", "dictionaryCacheSeconds", "enabledLocales", "overridesCacheSeconds", "rtlLocales", "updatedAt", "updatedByAdminId") ON TABLE :"application_schema"."LanguageConfig" TO :"runtime_role";
GRANT UPDATE ("defaultVisibility", "enableConference", "enableGifts", "enableRecording", "enabled", "maxGiftGcoin", "maxGuests", "maxParticipants", "minGiftGcoin", "rateLimitChatPerMinute", "rateLimitReactionsPerMinute", "updatedAt", "updatedById") ON TABLE :"application_schema"."LiveConfig" TO :"runtime_role";
GRANT UPDATE ("inviterId", "respondedAt", "status", "updatedAt") ON TABLE :"application_schema"."LiveInvite" TO :"runtime_role";
GRANT UPDATE ("cameraState", "joinedAt", "leftAt", "micState", "role", "status", "updatedAt") ON TABLE :"application_schema"."LiveParticipant" TO :"runtime_role";
GRANT UPDATE ("note", "reviewedAt", "reviewedById", "status", "updatedAt") ON TABLE :"application_schema"."LiveReport" TO :"runtime_role";
GRANT UPDATE ("endedAt", "likesCount", "lovesCount", "metadata", "peakViewerCount", "recordingFileId", "startedAt", "status", "updatedAt", "viewerCount") ON TABLE :"application_schema"."LiveSession" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "approvedByUserId", "consumedAt", "status", "updatedAt") ON TABLE :"application_schema"."LoginApprovalAttempt" TO :"runtime_role";
GRANT UPDATE ("appVersion", "browserName", "deviceModel", "deviceType", "isTrusted", "lastSeenAt", "osVersion", "platform", "publicKey", "updatedAt") ON TABLE :"application_schema"."LoginTrustedDevice" TO :"runtime_role";
GRANT UPDATE ("content_type", "data", "size_bytes", "updated_at") ON TABLE :"application_schema"."managed_upload_objects" TO :"runtime_role";
GRANT UPDATE ("code", "is_active", "metadata", "name", "target_role", "threshold", "trigger_type", "updated_at") ON TABLE :"application_schema"."ManagedEscalationRule" TO :"runtime_role";
GRANT UPDATE ("approved_at", "description", "due_at", "managed_project_id", "metadata", "qa_status", "risk_flag", "status", "title", "updated_at") ON TABLE :"application_schema"."ManagedMilestone" TO :"runtime_role";
GRANT UPDATE ("coordinator_staff_id", "entity_id", "entity_type", "metadata", "risk_level", "sla_status", "status", "title", "updated_at") ON TABLE :"application_schema"."ManagedProject" TO :"runtime_role";
GRANT UPDATE ("approvedAt", "brand", "categoryId", "condition", "contactPreference", "currency", "deliveryOptions", "description", "featured", "hideFromFriendsAndFollowers", "latitude", "location", "longitude", "meetupPreferences", "negotiable", "paymentMethods", "pinned", "price", "promoted", "quantity", "rejectedAt", "rejectionReason", "removedAt", "reportCount", "reservedAt", "reviewStatus", "saveCount", "slug", "soldAt", "status", "subcategoryId", "tags", "title", "updatedAt", "viewCount") ON TABLE :"application_schema"."MarketplaceListing" TO :"runtime_role";
GRANT UPDATE ("resolution", "resolvedAt", "resolvedById", "status", "updatedAt") ON TABLE :"application_schema"."MarketplaceReport" TO :"runtime_role";
GRANT UPDATE ("notificationId", "status") ON TABLE :"application_schema"."MentionRecipient" TO :"runtime_role";
GRANT UPDATE ("blockedUserIds", "enabledConferenceCalls", "enabledVideoCalls", "enabledVoiceCalls", "enabledVoiceNotes", "maxParticipants", "maxVoiceNoteDurationSeconds", "updatedAt", "updatedById") ON TABLE :"application_schema"."MessengerVoiceConfig" TO :"runtime_role";
GRANT UPDATE ("resolutionNotes", "resolvedAt", "resolvedByStaffId", "status", "updatedAt") ON TABLE :"application_schema"."ModerationAppeal" TO :"runtime_role";
GRANT UPDATE ("adminNote", "reapplyAllowedAt", "reviewedAt", "reviewedByAdminId", "status", "updatedAt") ON TABLE :"application_schema"."MonetizationApplication" TO :"runtime_role";
GRANT UPDATE ("disabledAt", "disabledReason", "enabledAt", "isEnabled", "updatedAt") ON TABLE :"application_schema"."MonetizationProfile" TO :"runtime_role";
GRANT UPDATE ("isRead") ON TABLE :"application_schema"."Notification" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "value") ON TABLE :"application_schema"."NotificationAnalyticsCounter" TO :"runtime_role";
GRANT UPDATE ("body", "cancelledAt", "channels", "confirmedAt", "confirmedBy", "deepLink", "name", "priority", "reason", "scheduleType", "scheduledAt", "sentAt", "stats", "status", "targeting", "title", "updatedAt", "updatedBy") ON TABLE :"application_schema"."NotificationCampaign" TO :"runtime_role";
GRANT UPDATE ("attemptCount", "deliveredAt", "status", "updatedAt") ON TABLE :"application_schema"."NotificationDelivery" TO :"runtime_role";
GRANT UPDATE ("emailStatus", "inAppNotificationId", "readAt", "sentAt", "status", "updatedAt") ON TABLE :"application_schema"."NotificationDigest" TO :"runtime_role";
GRANT UPDATE ("dailyHour", "dailyMinute", "emailEnabled", "enabled", "eveningHour", "eveningMinute", "inAppEnabled", "includeRead", "lastRunAt", "lastRunKey", "mode", "morningHour", "morningMinute", "pushReadyAlert", "timezone", "updatedAt", "weeklyDay", "weeklyHour", "weeklyMinute") ON TABLE :"application_schema"."NotificationDigestSchedule" TO :"runtime_role";
GRANT UPDATE ("category", "deliveryMode", "emailEnabled", "inAppEnabled", "metadata", "minPriority", "muted", "pushEnabled", "updatedAt") ON TABLE :"application_schema"."NotificationEventPreference" TO :"runtime_role";
GRANT UPDATE ("active", "updatedAt") ON TABLE :"application_schema"."NotificationFocusSession" TO :"runtime_role";
GRANT UPDATE ("allowEmergencySystem", "allowMandatorySecurity", "badgeEnabled", "enableVibration", "groupSimilar", "marketingEnabled", "metadata", "pauseOptional", "playSounds", "productUpdatesEnabled", "showPreviews", "syncReadState", "timezone", "updatedAt", "version") ON TABLE :"application_schema"."NotificationGlobalPreference" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "updatedBy", "value", "version") ON TABLE :"application_schema"."NotificationOpsConfig" TO :"runtime_role";
GRANT UPDATE ("body", "htmlBody", "locale", "metadata", "name", "publishedAt", "status", "subject", "title", "updatedAt", "updatedBy", "variables") ON TABLE :"application_schema"."NotificationOpsTemplate" TO :"runtime_role";
GRANT UPDATE ("deliveryMode", "digestEnabled", "emailEnabled", "inAppEnabled", "metadata", "minPriority", "previewEnabled", "pushEnabled", "smsEnabled", "soundEnabled", "updatedAt", "version", "vibrationEnabled") ON TABLE :"application_schema"."NotificationPreference" TO :"runtime_role";
GRANT UPDATE ("attemptCount", "cancelledAt", "completedAt", "history", "lastError", "nextAttemptAt", "status", "updatedAt") ON TABLE :"application_schema"."NotificationRetryJob" TO :"runtime_role";
GRANT UPDATE ("badgeCount", "lastDeviceId", "lastEventAt", "metadata", "unreadCount", "updatedAt", "version") ON TABLE :"application_schema"."NotificationSyncState" TO :"runtime_role";
GRANT UPDATE ("actionUrlTemplate", "bodyTemplate", "category", "defaultMeta", "description", "emailEnabled", "emailSubjectTemplate", "emailTextTemplate", "inAppEnabled", "isActive", "isSystemTemplate", "key", "label", "pushBodyTemplate", "pushEnabled", "pushTitleTemplate", "titleTemplate", "type", "updatedAt", "updatedByStaffId") ON TABLE :"application_schema"."NotificationTemplate" TO :"runtime_role";
GRANT UPDATE ("revokedAt", "usedAt") ON TABLE :"application_schema"."OAuthAuthorizationCode" TO :"runtime_role";
GRANT UPDATE ("revokedAt", "scopes", "updatedAt") ON TABLE :"application_schema"."OAuthConsent" TO :"runtime_role";
GRANT UPDATE ("usedAt") ON TABLE :"application_schema"."OAuthExchangeCode" TO :"runtime_role";
GRANT UPDATE ("accessTokenExpiresAt", "accessTokenHash", "ip", "lastUsedAt", "revokedAt", "userAgent") ON TABLE :"application_schema"."OAuthToken" TO :"runtime_role";
GRANT UPDATE ("status", "stripeIntentId", "transactionId", "updatedAt") ON TABLE :"application_schema"."Order" TO :"runtime_role";
GRANT UPDATE ("fxLockId", "providerCheckoutUrl", "providerPayload", "providerReferenceId", "status", "updatedAt") ON TABLE :"application_schema"."OrderPaymentIntent" TO :"runtime_role";
GRANT UPDATE ("consumed_at") ON TABLE :"application_schema"."PasskeyChallenge" TO :"runtime_role";
GRANT UPDATE ("backed_up", "counter", "device_type", "label", "last_used_at", "revoked_at", "updated_at") ON TABLE :"application_schema"."PasskeyCredential" TO :"runtime_role";
GRANT UPDATE ("usedAt") ON TABLE :"application_schema"."PasswordResetToken" TO :"runtime_role";
GRANT UPDATE ("accountType", "chargesEnabled", "country", "currency", "disabledReason", "isDisabledByAdmin", "lastSyncedAt", "payoutsEnabled", "requirementsDue", "status", "updatedAt") ON TABLE :"application_schema"."PayoutProviderAccount" TO :"runtime_role";
GRANT UPDATE ("description", "isActive", "isSystemNamespace", "label", "updatedAt") ON TABLE :"application_schema"."PolicyNamespace" TO :"runtime_role";
GRANT UPDATE ("description", "isActive", "label", "updatedAt") ON TABLE :"application_schema"."PolicyResource" TO :"runtime_role";
GRANT UPDATE ("conditions", "description", "effect", "isActive", "isSystemRule", "key", "label", "namespaceId", "permissionKey", "priority", "resourceId", "updatedAt", "updatedByStaffId") ON TABLE :"application_schema"."PolicyRule" TO :"runtime_role";
GRANT UPDATE ("commentSuggestions", "engagementScore", "hashtagSuggestions", "notes", "toxicityScore", "updatedAt") ON TABLE :"application_schema"."PostPrediction" TO :"runtime_role";
GRANT UPDATE ("accentColor", "animationSpeed", "backgroundColor", "backgroundFileId", "backgroundType", "blurPx", "customCss", "gradientFrom", "gradientTo", "headlineText", "isActive", "loaderType", "logoFileId", "maxDurationMs", "minDurationMs", "name", "overlayOpacity", "position", "showOnApiLoading", "showOnInitialLoad", "showOnRouteChange", "status", "subText", "textColor", "updatedAt", "updatedByAdminId") ON TABLE :"application_schema"."PreloaderConfig" TO :"runtime_role";
GRANT UPDATE ("expiresAt", "lastSeenAt", "metadata", "namespace", "releasedAt", "rooms", "status", "updatedAt", "userId") ON TABLE :"application_schema"."PresenceLease" TO :"runtime_role";
GRANT UPDATE ("entity_id", "entity_type", "metadata", "pool_id", "updated_at", "visibility_scope") ON TABLE :"application_schema"."PrivateOpportunityAccess" TO :"runtime_role";
GRANT UPDATE ("availabilityTypes", "availableFrom", "expiresAt", "isActive", "services", "status", "timing", "updatedAt", "visibility", "workPreference") ON TABLE :"application_schema"."ProfessionalAvailability" TO :"runtime_role";
GRANT UPDATE ("breakdown", "riskFlags", "score", "updatedAt") ON TABLE :"application_schema"."ProfessionalScore" TO :"runtime_role";
GRANT UPDATE ("updatedAt") ON TABLE :"application_schema"."Profile" TO :"runtime_role";
GRANT UPDATE ("clientViewCount", "clientViewedAt", "contractId", "interviewLocation", "interviewMode", "interviewNotes", "interviewScheduledAt", "rejectionReason", "status", "topApplicantAt", "updatedAt") ON TABLE :"application_schema"."Proposal" TO :"runtime_role";
GRANT UPDATE ("approved_at", "finance_status", "rejected_at", "status", "updated_at") ON TABLE :"application_schema"."PurchaseRequest" TO :"runtime_role";
GRANT UPDATE ("description", "difficulty", "isActive", "isWeekly", "reward", "roleScope", "rotationWeight", "title", "updatedAt", "updatedById", "verificationRules") ON TABLE :"application_schema"."QuestCatalog" TO :"runtime_role";
GRANT UPDATE ("acceptedAnswerId", "status", "updatedAt") ON TABLE :"application_schema"."Question" TO :"runtime_role";
GRANT UPDATE ("isActive", "updatedAt") ON TABLE :"application_schema"."QuietHourRule" TO :"runtime_role";
GRANT UPDATE ("reactionKey", "updatedAt") ON TABLE :"application_schema"."Reaction" TO :"runtime_role";
GRANT UPDATE ("details", "lastSeenAt", "notes", "occurrences", "resolvedAt", "resolvedByStaffId", "severity", "status", "updatedAt") ON TABLE :"application_schema"."RealtimeIncident" TO :"runtime_role";
GRANT UPDATE ("cold_start", "diversity", "enabled", "gating", "mode", "notes", "penalties", "updated_at", "updated_by", "weights") ON TABLE :"application_schema"."reco_config" TO :"runtime_role";
GRANT UPDATE ("count", "updated_at") ON TABLE :"application_schema"."reco_impression_log" TO :"runtime_role";
GRANT UPDATE ("action", "end_at", "entity_id", "entity_type", "is_active", "metadata", "note", "priority", "start_at", "surface", "updated_at", "updated_by", "value") ON TABLE :"application_schema"."reco_manual_rule" TO :"runtime_role";
GRANT UPDATE ("analysisResult", "errorMessage", "overallScore", "roleFitScore", "status", "updatedAt") ON TABLE :"application_schema"."ResumeAnalysis" TO :"runtime_role";
GRANT UPDATE ("aiOutput", "editableData", "includePhoto", "pdfStorageKey", "pdfUrl", "photoUrl", "status", "targetIndustry", "targetRole", "template", "title", "updatedAt") ON TABLE :"application_schema"."ResumeDocument" TO :"runtime_role";
GRANT UPDATE ("comment", "editedAt", "rating", "title", "updatedAt") ON TABLE :"application_schema"."Review" TO :"runtime_role";
GRANT UPDATE ("action", "code", "entity_type", "is_active", "metadata", "mode", "name", "signal_type", "threshold", "updated_at") ON TABLE :"application_schema"."RiskRule" TO :"runtime_role";
GRANT UPDATE ("expiresAt", "metadata", "reason", "resolvedAt", "resolvedByStaffId", "severity", "signalType", "source", "status", "updatedAt") ON TABLE :"application_schema"."RiskSignal" TO :"runtime_role";
GRANT UPDATE ("meta", "note", "sourceSurface") ON TABLE :"application_schema"."SavedPipelineItem" TO :"runtime_role";
GRANT UPDATE ("confirmation_status", "confirmed_at", "error_code", "error_message", "executed_at", "params_redacted", "result_payload", "status", "updated_at") ON TABLE :"application_schema"."scrolitha_action_plan" TO :"runtime_role";
GRANT UPDATE ("admin_action_cap_per_minute", "deny_listed_tools", "enabled", "low_risk_auto_execute", "metadata", "prompt_blocklist", "require_confirmation_by_default", "safe_mode", "updated_at", "updated_by", "user_rate_limit_per_minute") ON TABLE :"application_schema"."scrolitha_config" TO :"runtime_role";
GRANT UPDATE ("summary", "updated_at") ON TABLE :"application_schema"."scrolitha_conversation" TO :"runtime_role";
GRANT UPDATE ("description", "inputs_schema", "is_active", "key", "name", "roleScope", "steps_schema", "success_criteria", "updated_at", "updated_by", "version") ON TABLE :"application_schema"."scrolitha_skill" TO :"runtime_role";
GRANT UPDATE ("metadata", "updated_at") ON TABLE :"application_schema"."scrolitha_user_preference" TO :"runtime_role";
GRANT UPDATE ("action", "updatedAt") ON TABLE :"application_schema"."ScrolithMatchInteraction" TO :"runtime_role";
GRANT UPDATE ("data", "updatedAt") ON TABLE :"application_schema"."ScrolithMatchPreference" TO :"runtime_role";
GRANT UPDATE ("content", "deletedAt", "status", "updatedAt") ON TABLE :"application_schema"."ScrollComment" TO :"runtime_role";
GRANT UPDATE ("aiLabelRequired", "allowedFilterPresets", "autoModeration", "defaultVisibility", "descriptionPreviewCharacters", "enabled", "headlinePreviewCharacters", "impressionThresholdSeconds", "maxDurationSeconds", "monetizationEnabled", "updatedAt", "updatedById") ON TABLE :"application_schema"."ScrollConfig" TO :"runtime_role";
GRANT UPDATE ("signal", "updatedAt") ON TABLE :"application_schema"."ScrollFeedback" TO :"runtime_role";
GRANT UPDATE ("liftedAt", "liftedByAdminId", "updatedAt") ON TABLE :"application_schema"."ScrollPostingRestriction" TO :"runtime_role";
GRANT UPDATE ("reviewNote", "reviewedAt", "reviewedById", "status") ON TABLE :"application_schema"."ScrollReport" TO :"runtime_role";
GRANT UPDATE ("updatedAt") ON TABLE :"application_schema"."ScrollSeries" TO :"runtime_role";
GRANT UPDATE ("commentsCount", "impressions", "lastImpressionIncrementAt", "likesCount", "sharesCount", "status", "updatedAt") ON TABLE :"application_schema"."ScrollVideo" TO :"runtime_role";
GRANT UPDATE ("action", "description", "is_active", "key", "label", "metadata", "priority", "query_pattern", "scope", "target_id", "target_type", "updated_at", "updated_by_staff_id", "value") ON TABLE :"application_schema"."search_ranking_rule" TO :"runtime_role";
GRANT UPDATE ("dismissed_by_staff_id", "resolved_at", "status", "updated_at") ON TABLE :"application_schema"."SecurityAlert" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "walletFundingLimits", "walletFundingProviders") ON TABLE :"application_schema"."Settings" TO :"runtime_role";
GRANT UPDATE ("authSource", "connectedAt", "disconnectReason", "disconnectedAt", "handshakeQuery", "isAuthenticated", "lastSeenAt", "metadata", "namespace", "role", "rooms", "transport", "updatedAt", "userId") ON TABLE :"application_schema"."SocketSession" TO :"runtime_role";
GRANT UPDATE ("group_name", "label") ON TABLE :"application_schema"."StaffPermission" TO :"runtime_role";
GRANT UPDATE ("description", "isActive", "isSystemRole", "name", "updatedAt") ON TABLE :"application_schema"."StaffRole" TO :"runtime_role";
GRANT UPDATE ("email", "forcePasswordReset", "fullName", "lastLoginAt", "passwordHash", "require2FA", "roleId", "status", "updatedAt", "username") ON TABLE :"application_schema"."StaffUser" TO :"runtime_role";
GRANT UPDATE ("isReadByAdmin", "isReadByUser", "priority", "status", "updatedAt") ON TABLE :"application_schema"."SupportTicket" TO :"runtime_role";
GRANT UPDATE ("isActive", "name", "updatedAt") ON TABLE :"application_schema"."SupportTicketCategory" TO :"runtime_role";
GRANT UPDATE ("description", "is_active", "metadata", "name", "slug", "updated_at", "visibility") ON TABLE :"application_schema"."TalentPool" TO :"runtime_role";
GRANT UPDATE ("internal_notes", "invited_by_staff_id", "membership_type", "scorecard", "status", "tags", "updated_at") ON TABLE :"application_schema"."TalentPoolMember" TO :"runtime_role";
GRANT UPDATE ("updatedAt") ON TABLE :"application_schema"."TextOverride" TO :"runtime_role";
GRANT UPDATE ("status", "updatedAt") ON TABLE :"application_schema"."TimeEntry" TO :"runtime_role";
GRANT UPDATE ("followerCount", "kind", "label", "updatedAt", "usageCount") ON TABLE :"application_schema"."Topic" TO :"runtime_role";
GRANT UPDATE ("endedAt", "status") ON TABLE :"application_schema"."TrackingSession" TO :"runtime_role";
GRANT UPDATE ("status", "updatedAt") ON TABLE :"application_schema"."Transaction" TO :"runtime_role";
GRANT UPDATE ("description", "isActive", "namespace", "updatedAt") ON TABLE :"application_schema"."TranslationKey" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "updatedByAdminId", "value") ON TABLE :"application_schema"."TranslationValue" TO :"runtime_role";
GRANT UPDATE ("activeViolationCount", "fraudScoreSnapshot", "isVerifiedSnapshot", "kycStatusSnapshot", "lastComputedAt", "metadata", "moderationCaseCount", "resolvedCaseCount", "riskLevel", "score", "signalCount", "updatedAt", "updatedByStaffId", "userId") ON TABLE :"application_schema"."TrustProfile" TO :"runtime_role";
GRANT UPDATE ("authSessionVersion", "avatar", "country", "currency_preference_updated_at", "email", "followOnboardingCompletedAt", "followOnboardingRequired", "isActive", "isOnline", "isVerified", "kycStatus", "lastLoginAt", "lastSeenAt", "loginApprovalWaivedById", "loginApprovalWaivedReason", "loginApprovalWaivedUntil", "name", "passwordHash", "preferred_currency", "profilePhotoFileId", "refreshToken", "role", "updatedAt", "username") ON TABLE :"application_schema"."User" TO :"runtime_role";
GRANT UPDATE ("effect", "expiresAt", "isActive", "permissionKey", "reason", "resourceId", "resourceType", "updatedAt", "updatedByStaffId", "userId") ON TABLE :"application_schema"."UserPermissionOverride" TO :"runtime_role";
GRANT UPDATE ("completedAt", "lastEventAt", "progress", "rewardGranted", "startedAt", "status", "updatedAt") ON TABLE :"application_schema"."UserQuest" TO :"runtime_role";
GRANT UPDATE ("updatedAt", "videoCallsAdminReason", "videoCallsEnabled", "videoCallsUpdatedAt", "videoCallsUpdatedById") ON TABLE :"application_schema"."UserSettings" TO :"runtime_role";
GRANT UPDATE ("bestStreakDays", "currentStreakDays", "lastActiveDate", "updatedAt") ON TABLE :"application_schema"."UserStreak" TO :"runtime_role";
GRANT UPDATE ("code", "is_active", "metadata", "name", "require_contract_acceptance", "required_compliance_checks", "required_documents", "required_kyc_tier", "updated_at") ON TABLE :"application_schema"."VendorRequirement" TO :"runtime_role";
GRANT UPDATE ("callType", "endedAt", "metadata", "status", "updatedAt") ON TABLE :"application_schema"."VoiceCall" TO :"runtime_role";
GRANT UPDATE ("invitedAt", "joinedAt", "leftAt", "status", "updatedAt") ON TABLE :"application_schema"."VoiceCallParticipant" TO :"runtime_role";
GRANT UPDATE ("balance", "escrowBalance", "frozen", "pendingClearance", "updatedAt") ON TABLE :"application_schema"."Wallet" TO :"runtime_role";
GRANT UPDATE ("fxLockId", "providerCheckoutUrl", "providerPayload", "providerReferenceId", "status", "updatedAt") ON TABLE :"application_schema"."WalletFundingIntent" TO :"runtime_role";
GRANT UPDATE ("attempts", "delivered_at", "last_error", "next_attempt_at", "signature", "status", "updated_at") ON TABLE :"application_schema"."WebhookDeliveryLog" TO :"runtime_role";
GRANT UPDATE ("builtAt", "entries", "updatedAt") ON TABLE :"application_schema"."WeeklyLeaderboard" TO :"runtime_role";
GRANT UPDATE ("details", "fxLockId", "processedAt", "status", "updatedAt") ON TABLE :"application_schema"."WithdrawalRequest" TO :"runtime_role";
