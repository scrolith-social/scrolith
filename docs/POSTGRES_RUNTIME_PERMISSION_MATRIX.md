# PostgreSQL runtime permission matrix

Source reviewed: Scrolith backend base commit `15ca15c9b1ce462a8a140090cf45c0354d762ce6` plus the local database-role release-candidate changes, Prisma schema `geezle-backend/prisma/schema.prisma`, and all 803 non-test TypeScript files under `geezle-backend/src` (355 Prisma models). This matrix is the reviewed grant contract for `scrolith_runtime`; it is not row-level authorization.

* Runtime grants are generated from production Prisma delegate operations across the pinned backend source. The current explicit policy grants table-level SELECT on 335 of 355 Prisma model tables; 20 receive no SELECT. The selected models cover read operations and Prisma mutation predicates/RETURNING. INSERT is granted on 325 tables only where the source inventory found a supported create/upsert path. DELETE is granted on 70 tables only where a direct delete path exists; financial/history and identity-parent tables are excluded. The policy has column-level UPDATE grants on 227 tables, aggregated from the generated field inventory and the explicit, source-reviewed exceptions in the production finalizer. No table-level UPDATE, TRUNCATE, REFERENCES, or TRIGGER is granted to runtime. Runtime receives USAGE/SELECT but not UPDATE on identity sequences needed by INSERT paths. These are table-level read/insert/delete permissions, not row-level authorization; API authorization remains required. The migration ledger and policy marker are excluded.

* Prisma model callsite counts are static inventory evidence, not a proof of every dynamically built query shape. The matrix shows the effective union of the generated column lists and finalizer exceptions. PostgreSQL integration checks exercise representative supported writes and denied financial-field/destructive operations. New or changed model writes must update this matrix and grant file, then pass the role test.

* `Gig` retains a runtime DELETE grant for the supported removal operation, but the Prisma `Order.gigId` foreign key is `ON DELETE RESTRICT`. Application removal hard-deletes only a gig with no orders. If orders exist, it deactivates the gig (`isActive=false`, `status=PAUSED`) and reports that order history was retained. If an order commits during the count/delete race, PostgreSQL rejects the delete and the application takes the same deactivation path. This keeps existing unreferenced-gig cleanup while preserving historical order linkage.

| Table | SELECT | INSERT | UPDATE columns | DELETE | Read evidence |
|---|---:|---:|---|---:|---|
| `User` | Yes | Yes (verified production write path) | authSessionVersion, avatar, country, currency_preference_updated_at, email, followOnboardingCompletedAt, followOnboardingRequired, isActive, isOnline, isVerified, kycStatus, languagePreferencesConfirmed, languagePreferencesUpdatedAt, lastLoginAt, lastSeenAt, loginApprovalWaivedById, loginApprovalWaivedReason, loginApprovalWaivedUntil, name, passwordHash, preferred_currency, profilePhotoFileId, refreshToken, role, understoodLanguages, updatedAt, username | No | Direct query; language preference save and follow onboarding completion
| `Profile` | Yes | Yes (verified production write path) | bio, certifications, city, country, countryCode, coverPhotoUrl, dateOfBirth, educationItems, experienceItems, formattedAddress, gender, githubUrl, hourlyRate, introVideoUrl, languages, latitude, linkedinUrl, location, locationSource, longitude, placeId, portfolio, portfolioUrl, postalCode, region, showBirthMonthDayPublic, skills, state, title, updatedAt, websiteUrl | No | `updateUserProfile`; approved `applyApprovedProfileImprovements`
| `ProfessionalAvailability` | Yes | Yes (verified production write path) | availabilityTypes, availableFrom, expiresAt, isActive, services, status, timing, updatedAt, visibility, workPreference | No | Direct query
| `ClientHiringStatus` | Yes | Yes (verified production write path) | expiresAt, focusAreas, hiringTypes, isActive, status, timing, updatedAt, visibility | No | Direct query
| `HiringRecommendationState` | Yes | Yes (verified production write path) | activatedAt, dismissCount, impressionCount, lastClickedAt, lastDismissedAt, lastShownAt, sessionImpressionCount, sessionKey, snoozeUntil, updatedAt | No | Direct query
| `ResumeDocument` | Yes | Yes (verified production write path) | aiOutput, editableData, includePhoto, pdfStorageKey, pdfUrl, photoUrl, status, targetIndustry, targetRole, template, title, updatedAt | Yes (verified production delete path) | Direct query
| `ResumeVersion` | Yes | Yes (verified production write path) | — | No | Direct query
| `ResumeAnalysis` | Yes | Yes (verified production write path) | analysisResult, errorMessage, overallScore, roleFitScore, status, updatedAt | Yes (verified production delete path) | Direct query
| `ProfileView` | Yes | Yes (verified production write path) | — | No | Direct query
| `UserSettings` | Yes | Yes (verified production write path) | updatedAt, videoCallsAdminReason, videoCallsEnabled, videoCallsUpdatedAt, videoCallsUpdatedById | No | Direct query
| `Gig` | Yes | Yes (verified production write path) | adminReason, adminStatus, categoryId, deliveryTime, description, documents, extras, faqs, image, images, isActive, isFeatured, isRecommended, isTopSelected, meta, packages, price, pricingMode, requirements, revisions, slug, status, subcategory, tags, title, updatedAt, userId, videos | Yes (verified production delete path) | Direct query
| `Job` | Yes | Yes (verified production write path) | adminReason, adminStatus, attachments, budget, categoryId, clientId, description, duration, experienceLevel, isActive, isFeatured, isRecommended, isTopSelected, isVisible, proposalsCount, status, subcategory, tags, title, type, updatedAt, visibility | Yes (verified production delete path) | Direct query
| `Proposal` | Yes | Yes (verified production write path) | clientViewCount, clientViewedAt, contractId, interviewLocation, interviewMode, interviewNotes, interviewScheduledAt, rejectionReason, status, topApplicantAt, updatedAt | No | Direct query
| `Contract` | Yes | Yes (verified production write path) | milestones, status, updatedAt | No | Direct query
| `TimeEntry` | Yes | Yes (verified production write path) | status, updatedAt | No | Direct query
| `TrackingSession` | Yes | Yes (verified production write path) | endedAt, status | No | Direct query
| `Category` | Yes | Yes (verified production write path) | description, icon, isActive, name, order, parentId, slug, type, updatedAt | Yes (verified production delete path) | Direct query
| `Order` | Yes | Yes (verified production write path) | status, stripeIntentId, transactionId, updatedAt | No | Direct query
| `Review` | Yes | Yes (verified production write path) | comment, editedAt, rating, title, updatedAt | No | Direct query
| `KYCSubmission` | Yes | Yes (verified production write path) | consentAcceptedAt, consentPolicyVersion, decisionReasonCode, personalInfo, rejectionReason, resubmissionCount, retentionPolicyKey, reviewedAt, reviewedBy, status, updatedAt | No | Direct query
| `KYCDocument` | Yes | Yes (verified production write path) | contentType, fileUrl, height, metadataStripped, normalizedAt, objectKey, promotedAt, quarantineObjectKey, quarantineStatus, rejectionReason, scanDefinitionVersion, scanEngine, scannedAt, scanStatus, sha256, sizeBytes, status, storageClass, submissionId, type, updatedAt, visibility, width | No | Direct query
| `KYCConsent` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `KYCAuditEvent` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `AppSetting` | Yes | Yes (verified production write path) | data, updatedAt | Yes (verified production delete path) | Direct query
| `FxProvider` | Yes | Yes (verified production write path) | baseUrl, enabled, kind, name, priority, settingsJson, updatedAt | No | Direct query
| `FxSnapshot` | Yes | Yes (verified production write path) | approvedAt, approvedById, isFrozen, status | No | Direct query
| `FxRate` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `FxManualOverride` | Yes | Yes (verified production write path) | approvedById, status, updatedAt | No | Direct query
| `FxSyncJob` | Yes | Yes (verified production write path) | error, finishedAt, meta, recordsInserted, snapshotId, status | No | Direct query
| `FxLock` | Yes | Yes (verified production write path) | — | No | Direct query
| `fx_quotes` | Yes | Yes (verified production write path) | consumed_at, status, updated_at | No | Direct query
| `DeveloperPlatformConfig` | Yes | Yes (verified production write path) | accessTokenTtlSeconds, authorizationCodeTtlSeconds, autoApproveEnabled, autoApproveRules, developerBaseUrl, rateLimitPerMinute, refreshTokenTtlSeconds, requireManualApprovalForSensitiveScope, sensitiveScopes, updatedAt, updatedByAdminId | No | Mutation/RETURNING only
| `DeveloperUser` | Yes | Yes (verified production write path) | developerEmail, lastSyncedAt, linkedAt, linkStatus, syncSnapshot, updatedAt, userId | No | Direct query
| `DeveloperLinkRequest` | Yes | Yes (verified production write path) | status, updatedAt, verifiedAt | No | Direct query
| `DeveloperApp` | Yes | Yes (verified production write path) | approvedAt, approvedByAdminId, clientSecretHash, disabledAt, lastSecretRotatedAt, status, updatedAt | No | Direct query
| `DeveloperAppRedirectUri` | Yes | Yes (verified production write path) | isActive, updatedAt | No | Direct query
| `OAuthAuthorizationCode` | Yes | Yes (verified production write path) | revokedAt, usedAt | No | Direct query
| `OAuthToken` | Yes | Yes (verified production write path) | accessTokenExpiresAt, accessTokenHash, ip, lastUsedAt, revokedAt, userAgent | No | Direct query
| `OAuthConsent` | Yes | Yes (verified production write path) | revokedAt, scopes, updatedAt | No | Direct query
| `DeveloperAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `ProfessionalScore` | Yes | Yes (verified production write path) | breakdown, riskFlags, score, updatedAt | No | Direct query
| `InsightEvent` | Yes | Yes (verified production write path) | — | No | Direct query
| `Achievement` | Yes | Yes (verified production write path) | description, isActive, rules, tier, title, updatedAt | No | Direct query
| `UserAchievement` | Yes | Yes (verified production write path) | — | No | Direct query
| `UserStreak` | Yes | Yes (verified production write path) | bestStreakDays, currentStreakDays, lastActiveDate, updatedAt | No | Direct query
| `CareerDailyAction` | Yes | Yes (verified production write path) | — | No | Direct query
| `FriendStreak` | Yes | Yes (verified production write path) | acceptedAt, endedAt, initiatedByUserId, invitedAt, respondedAt, status, updatedAt | No | Direct query
| `CreatorChallenge` | Yes | Yes (verified production write path) | category, contentTypes, description, endAt, entryLimitPerUser, finalizedAt, isActive, key, maxWinners, reward, rules, startAt, status, title, updatedAt, updatedById, weekKey, winningEntryIds | No | Direct query
| `CreatorChallengeEntry` | Yes | Yes (verified production write path) | isWinner, position, status, updatedAt, voteCount | No | Direct query
| `CreatorChallengeVote` | Yes | Yes (verified production write path) | entryId, updatedAt | No | Direct query
| `OpportunityMatch` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `ScrolithMatchInteraction` | Yes | Yes (verified production write path) | action, updatedAt | No | Direct query
| `ScrolithMatchPreference` | Yes | Yes (verified production write path) | data, updatedAt | No | Direct query
| `WeeklyLeaderboard` | Yes | Yes (verified production write path) | builtAt, entries, updatedAt | No | Direct query
| `PostPrediction` | Yes | Yes (verified production write path) | commentSuggestions, engagementScore, hashtagSuggestions, notes, toxicityScore, updatedAt | No | Direct query
| `AICopilotLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `SkillGapReport` | Yes | Yes (verified production write path) | — | No | Direct query
| `FeedModePreference` | Yes | Yes (verified production write path) | mode, updatedAt | No | Direct query
| `Topic` | Yes | Yes (verified production write path) | followerCount, kind, label, updatedAt, usageCount | No | Direct query
| `TopicAlias` | Yes | Yes (verified production write path) | — | No | Direct query
| `TopicFollow` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `FeedIntentSignal` | Yes | Yes (verified production write path) | — | No | Direct query
| `SavedPipelineItem` | Yes | Yes (verified production write path) | meta, note, sourceSurface | Yes (verified production delete path) | Direct query
| `QuestCatalog` | Yes | Yes (verified production write path) | description, difficulty, isActive, isWeekly, reward, roleScope, rotationWeight, title, updatedAt, updatedById, verificationRules | No | Direct query
| `UserQuest` | Yes | Yes (verified production write path) | completedAt, lastEventAt, progress, rewardGranted, startedAt, status, updatedAt | No | Direct query
| `QuestCompletionLog` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `PortfolioProof` | Yes | No | — | No | Direct query
| `ProofAttestation` | No | No | — | No | Mutation/RETURNING only
| `ProofAuditLog` | No | No | — | No | Mutation/RETURNING only
| `ProjectPod` | Yes | Yes (verified production write path) | — | No | Direct query
| `PodMember` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `PodMilestone` | No | No | — | No | Mutation/RETURNING only
| `PodActivity` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `Question` | Yes | Yes (verified production write path) | acceptedAnswerId, status, updatedAt | No | Direct query
| `Answer` | Yes | Yes (verified production write path) | isAccepted, updatedAt | No | Mutation/RETURNING only
| `Vote` | No | No | — | No | Mutation/RETURNING only
| `Bounty` | Yes | Yes (verified production write path) | awardedAnswerId, awardedAt, status, updatedAt | No | Mutation/RETURNING only
| `ChannelSubscriptionPlan` | No | No | — | No | Mutation/RETURNING only
| `ChannelSubscription` | Yes | Yes (verified production write path) | cancelAtPeriodEnd, endsAt, planId, status, updatedAt | No | Mutation/RETURNING only
| `EventOfficeHour` | No | No | — | No | Mutation/RETURNING only
| `UserAnalyticsDaily` | No | No | — | No | Mutation/RETURNING only
| `EntityAnalyticsDaily` | No | No | — | No | Mutation/RETURNING only
| `ModerationCase` | Yes | No | — | No | Direct query
| `ModerationAction` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `TranslationKey` | Yes | Yes (verified production write path) | description, isActive, namespace, updatedAt | No | Direct query
| `TranslationValue` | Yes | Yes (verified production write path) | updatedAt, updatedByAdminId, value | No | Direct query
| `TextOverride` | Yes | Yes (verified production write path) | updatedAt | Yes (verified production delete path) | Direct query
| `LanguageConfig` | Yes | Yes (verified production write path) | defaultLocale, dictionaryCacheSeconds, enabledLocales, overridesCacheSeconds, rtlLocales, updatedAt, updatedByAdminId | No | Direct query
| `ContentTranslationGlossaryEntry` | Yes | Yes (verified production write path) | caseSensitive, enabled, locale, priority, replacementText, sourceText, targetLocale, updatedAt, updatedById | Yes (verified production delete path) | Direct query
| `ContentLanguageDetection` | Yes | Yes (verified production write path) | confidence, detectorKey, metadata, sourceLocale, updatedAt | No | Direct query
| `ContentTranslation` | Yes | Yes (verified production write path) | engineKey, errorMessage, glossaryApplied, latencyMs, metadata, modelVersion, sourceLocale, status, translatedContent, translatedTitle, updatedAt | No | Direct query
| `ContentTranslationAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `reco_config` | Yes | Yes (verified production write path) | cold_start, diversity, enabled, gating, mode, notes, penalties, updated_at, updated_by, weights | No | Direct query
| `reco_manual_rule` | Yes | Yes (verified production write path) | action, end_at, entity_id, entity_type, is_active, metadata, note, priority, start_at, surface, updated_at, updated_by, value | Yes (verified production delete path) | Direct query
| `reco_impression_log` | Yes | Yes (verified production write path) | count, updated_at | No | Direct query
| `reco_feedback_log` | Yes | Yes (verified production write path) | — | No | Direct query
| `search_ranking_rule` | Yes | Yes (verified production write path) | action, description, is_active, key, label, metadata, priority, query_pattern, scope, target_id, target_type, updated_at, updated_by_staff_id, value | No | Direct query
| `feed_recipe` | Yes | Yes (verified production write path) | description, is_active, is_system_recipe, key, label, mode, query_take_cap, query_take_multiplier, updated_at, updated_by_staff_id, weights | No | Direct query
| `NotificationTemplate` | Yes | Yes (verified production write path) | actionUrlTemplate, bodyTemplate, category, defaultMeta, description, emailEnabled, emailSubjectTemplate, emailTextTemplate, inAppEnabled, isActive, isSystemTemplate, key, label, pushBodyTemplate, pushEnabled, pushTitleTemplate, titleTemplate, type, updatedAt, updatedByStaffId | No | Direct query
| `JourneyFlow` | Yes | Yes (verified production write path) | audienceConfig, audienceType, description, isActive, isSystemFlow, key, label, metadata, triggerType, updatedAt, updatedByStaffId | No | Direct query
| `JourneyStep` | Yes | Yes (verified production write path) | actionUrl, channel, conditionConfig, delayMinutes, description, flowId, isActive, key, label, metadata, orderIndex, templateId, updatedAt | No | Direct query
| `JourneyRun` | Yes | Yes (verified production write path) | completedAt, lastError, results, status, updatedAt | No | Direct query
| `JourneyStepRun` | Yes | Yes (verified production write path) | attemptCount, errorMessage, executedAt, result, status, updatedAt | No | Direct query
| `QuietHourRule` | Yes | Yes (verified production write path) | isActive, updatedAt | No | Direct query
| `scrolitha_conversation` | Yes | Yes (verified production write path) | summary, updated_at | No | Direct query
| `scrolitha_message` | Yes | Yes (verified production write path) | — | No | Direct query
| `scrolitha_skill` | Yes | Yes (verified production write path) | description, inputs_schema, is_active, key, name, roleScope, steps_schema, success_criteria, updated_at, updated_by, version | Yes (verified production delete path) | Direct query
| `scrolitha_action_plan` | Yes | Yes (verified production write path) | confirmation_status, confirmed_at, error_code, error_message, executed_at, params_redacted, result_payload, status, updated_at | No | Direct query
| `scrolitha_audit_log` | Yes | Yes (verified production write path) | — | No | Direct query
| `scrolitha_config` | Yes | Yes (verified production write path) | admin_action_cap_per_minute, deny_listed_tools, enabled, low_risk_auto_execute, metadata, prompt_blocklist, require_confirmation_by_default, safe_mode, updated_at, updated_by, user_rate_limit_per_minute | No | Mutation/RETURNING only
| `scrolitha_user_preference` | Yes | Yes (verified production write path) | metadata, updated_at | No | Direct query
| `scrolitha_feedback` | Yes | Yes (verified production write path) | — | No | Direct query
| `Favorite` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `MarketplaceListing` | Yes | Yes (verified production write path) | approvedAt, brand, categoryId, condition, contactPreference, currency, deliveryOptions, description, featured, hideFromFriendsAndFollowers, latitude, location, longitude, meetupPreferences, negotiable, paymentMethods, pinned, price, promoted, quantity, rejectedAt, rejectionReason, removedAt, reportCount, reservedAt, reviewStatus, saveCount, slug, soldAt, status, subcategoryId, tags, title, updatedAt, viewCount | No | Direct query
| `MarketplaceListingMedia` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `MarketplaceInquiry` | Yes | Yes (verified production write path) | — | No | Direct query
| `MarketplaceReport` | Yes | Yes (verified production write path) | resolution, resolvedAt, resolvedById, status, updatedAt | No | Direct query
| `MarketplaceOrder` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `MarketplaceAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `PostCollection` | Yes | Yes (verified production write path) | — | No | Direct query
| `PostCollectionItem` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `Cart` | Yes | Yes (verified production write path) | updatedAt | Yes (verified production delete path) | Direct query
| `CartItem` | Yes | Yes (verified production write path) | quantity, updatedAt | Yes (verified production delete path) | Direct query
| `Escrow` | Yes | Yes (verified production write path) | commission, fundedAt, refundedAt, releasedAt, status, updatedAt | No | Direct query
| `Wallet` | Yes | Yes (verified production write path) | balance, escrowBalance, frozen, pendingClearance, updatedAt | No | Direct query
| `FoundingPartnerProgram` | Yes | Yes (verified production write path) | enrolledCount, status, updatedAt | No | Direct query
| `FoundingPartner` | Yes | Yes (verified production write path) | deactivatedAt, deactivatedReason, reactivatedAt, status, updatedAt | No | Direct query
| `FoundingPartnerEnrollmentPayment` | Yes | Yes (verified production write path) | chargedAmount, chargedCurrency, fxRate, fxRateSource, fxSnapshotId, partnerId, providerIntentId, providerPayload, providerReferenceId, settledAt, sourceAmount, sourceCurrency, status, updatedAt | No | Direct query
| `FoundingPartnerProfitPeriod` | Yes | Yes (verified production write path) | approvedAt, approvedById, clearedProfit, closedAt, distributedAt, notes, partnerPool, status, updatedAt | No | Direct query
| `FoundingPartnerProfitSource` | Yes | Yes (verified production write path) | adjustments, clearedAmount, notes, updatedAt | No | Mutation/RETURNING only
| `FoundingPartnerDistributionRun` | Yes | Yes (verified production write path) | approvedAt, approvedById, completedAt, executedAt, executedById, failureReason, status, updatedAt | No | Direct query
| `FoundingPartnerDistribution` | Yes | Yes (verified production write path) | creditedAt, fxRate, status, updatedAt, walletAmount, walletCurrency, walletTransactionId | No | Direct query
| `FoundingPartnerAuditLog` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `Transaction` | Yes | Yes (verified production write path) | description, metadata, status, updatedAt | No | Direct query
| `WalletFundingIntent` | Yes | Yes (verified production write path) | expiresAt, fxLockId, providerCheckoutUrl, providerPayload, providerReferenceId, status, updatedAt | No | Direct query
| `PaymentSettlement` | Yes | Yes (verified production write path) | — | No | Direct query
| `OrderPaymentIntent` | Yes | Yes (verified production write path) | fxLockId, providerCheckoutUrl, providerPayload, providerReferenceId, status, updatedAt | No | Direct query
| `OrderPaymentSettlement` | Yes | Yes (verified production write path) | — | No | Direct query
| `GcoinSettings` | Yes | Yes (verified production write path) | adminFeePercent, autoApproveConversions, coinPerLikesUnit, coinPerRepostsUnit, coinPerSharesUnit, coinPerViewsUnit, conversionEnabled, conversionRate, likesUnit, minWithdrawal, repostsUnit, sharesUnit, transferFeeType, transferFeeValue, updatedAt, userTransfersEnabled, viewsUnit | No | Direct query
| `GcoinWallet` | Yes | Yes (verified production write path) | balance, fraudScore, lifetimeEarned, status, updatedAt | No | Direct query
| `GcoinTransaction` | Yes | Yes (verified production write path) | — | No | Direct query
| `GcoinConfig` | Yes | No | — | No | Direct query
| `GcoinConversionRequest` | Yes | Yes (verified production write path) | processedAt, processedBy, status | No | Direct query
| `WithdrawalRequest` | Yes | Yes (verified production write path) | details, fxLockId, processedAt, status, updatedAt | No | Direct query
| `SupportTicketCategory` | Yes | Yes (verified production write path) | isActive, name, updatedAt | Yes (verified production delete path) | Direct query
| `SupportTicket` | Yes | Yes (verified production write path) | isReadByAdmin, isReadByUser, priority, status, updatedAt | No | Direct query
| `SupportTicketReply` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `Settings` | Yes | Yes (verified production write path) | updatedAt, walletFundingLimits, walletFundingProviders | No | Direct query
| `CMSConfig` | Yes | Yes (verified production write path) | — | No | Direct query
| `files` | Yes | Yes (verified production write path) | duration, filename, height, mime_type, original_name, owner_id, ownerRole, processing_completed_at, processing_error_code, processing_started_at, processing_status, processing_version, size, storage_key, storage_provider, thumbnail_url, url, variants_manifest, videoPerceptualHash, videoPerceptualHashVersion, visibility, width | Yes (verified production delete path) | Direct query
| `file_variants` | Yes | Yes (verified production write path) | checksum, height, mime_type, size_bytes, status, storage_key, storage_provider, updated_at | No | Direct query
| `managed_upload_objects` | Yes | Yes (verified production write path) | content_type, data, size_bytes, updated_at | Yes (verified production delete path) | Direct query
| `FileUsage` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `AuthProviderAccount` | Yes | Yes (verified production write path) | — | No | Direct query
| `ForumThread` | Yes | Yes (verified production write path) | isLocked, isPinned, status, updatedAt | Yes (verified production delete path) | Direct query
| `ForumComment` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `ForumLike` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityClub` | Yes | Yes (verified production write path) | avatarImage, category, coverImage, description, faqs, joinMode, location, memberCount, membersCanInvite, name, postingGuidelines, postPermission, slug, summary, updatedAt, visibility | Yes (verified production delete path) | Direct query
| `ClubMembership` | Yes | Yes (verified production write path) | invitedById, role, status, updatedAt | Yes (verified production delete path) | Direct query
| `ClubJoinRequest` | Yes | Yes (verified production write path) | answers, note, requestedAt, reviewedAt, reviewedById, reviewNote, status | No | Direct query
| `ClubInvite` | Yes | Yes (verified production write path) | invitedAt, invitedById, note, respondedAt, role, status | No | Direct query
| `CommunityEvent` | Yes | Yes (verified production write path) | attendeeCount, image, updatedAt | Yes (verified production delete path) | Direct query
| `EventRegistration` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityChannel` | Yes | Yes (verified production write path) | businessPageId, description, isPublic, lastActivity, memberCount, name, type, updatedAt | No | Direct query
| `ChannelMembership` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityMessage` | Yes | Yes (verified production write path) | — | No | Direct query
| `Conversation` | Yes | Yes (verified production write path) | lastMessageAt, lastMessageSenderId, lastMessageText, updatedAt | No | Direct query
| `ConversationParticipant` | Yes | Yes (verified production write path) | deletedAt, isArchived, isMuted, isStarred, label, lastReadAt, role | No | Direct query
| `ConversationInvite` | Yes | Yes (verified production write path) | acceptedAt, inviteeUserId, status, useCount | No | Direct query
| `ConversationSettings` | Yes | Yes (verified production write path) | allowAudio, allowContacts, allowCopy, allowDelete, allowEditing, allowEvents, allowExternalLinks, allowFiles, allowForward, allowGifs, allowImages, allowLocation, allowPolls, allowReactions, allowStickers, allowVideos, allowVoice, maxMentionsPerMessage, policyJson, updatedAt | No | Direct query
| `ConversationJoinRequest` | Yes | Yes (verified production write path) | message, reviewedAt, reviewedById, status, updatedAt | No | Direct query
| `ConversationMemberRestriction` | Yes | Yes (verified production write path) | — | No | Direct query
| `GroupModerationAction` | Yes | Yes (verified production write path) | — | No | Direct query
| `ConversationPinnedMessage` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `DirectMessage` | Yes | Yes (verified production write path) | attachments, conversationId, deletedAt, editedAt, text | No | Direct query
| `MessageReaction` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `DirectMessageRecord` | No | No | — | No | Mutation/RETURNING only
| `VoiceCall` | Yes | Yes (verified production write path) | callType, endedAt, metadata, status, updatedAt | No | Direct query
| `VoiceCallParticipant` | Yes | Yes (verified production write path) | invitedAt, joinedAt, leftAt, status, updatedAt | No | Direct query
| `VoiceNote` | Yes | Yes (verified production write path) | — | No | Direct query
| `MessengerVoiceConfig` | Yes | Yes (verified production write path) | blockedUserIds, enabledConferenceCalls, enabledVideoCalls, enabledVoiceCalls, enabledVoiceNotes, maxParticipants, maxVoiceNoteDurationSeconds, updatedAt, updatedById | No | Mutation/RETURNING only
| `Reaction` | Yes | Yes (verified production write path) | reactionKey, updatedAt | Yes (verified production delete path) | Direct query
| `ReactionSummary` | No | No | — | No | Mutation/RETURNING only
| `CommunityPost` | Yes | Yes (verified production write path) | aiInsightEnabled, aiInsightGenerated, aiInsightText, aiScore, attachments, contentHash, detectedLanguageCodes, isHighlighted, isMixedLanguage, isPinned, languageDetectedAt, languageDetectionStatus, languageManuallySet, likesCount, sourceLanguage, sourceLanguageConfidence, status, translationVersion, updatedAt | No | Direct query
| `CommunityPostHidden` | Yes | Yes (verified production write path) | — | No | Direct query
| `CommunityPostFeedback` | Yes | Yes (verified production write path) | signal, updatedAt | No | Direct query
| `CommunityPostReport` | Yes | Yes (verified production write path) | details, reason, status, updatedAt | No | Direct query
| `CommunityNotificationSubscription` | Yes | Yes (verified production write path) | enabled, updatedAt | Yes (verified production delete path) | Direct query
| `CommunityPostComment` | Yes | Yes (verified production write path) | attachments, content, deletedAt, status, updatedAt | Yes (verified production delete path) | Direct query
| `CommunityPostCommentLike` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityPostReaction` | Yes | Yes (verified production write path) | type | Yes (verified production delete path) | Direct query
| `Mention` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `MentionRecipient` | Yes | Yes (verified production write path) | notificationId, status | No | Mutation/RETURNING only
| `ScrollVideo` | Yes | Yes (verified production write path) | commentsCount, impressions, lastImpressionIncrementAt, likesCount, sharesCount, status, updatedAt | Yes (verified production delete path) | Direct query
| `ScrollSeries` | Yes | Yes (verified production write path) | updatedAt | Yes (verified production delete path) | Direct query
| `ScrollSeriesItem` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `ScrollComment` | Yes | Yes (verified production write path) | content, deletedAt, status, updatedAt | No | Direct query
| `ScrollTag` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `ScrollEngagement` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `ScrollHidden` | Yes | Yes (verified production write path) | — | No | Direct query
| `ScrollFeedback` | Yes | Yes (verified production write path) | signal, updatedAt | No | Direct query
| `ScrollReport` | Yes | Yes (verified production write path) | reviewedAt, reviewedById, reviewNote, status | No | Direct query
| `ScrollPostingRestriction` | Yes | Yes (verified production write path) | liftedAt, liftedByAdminId, updatedAt | No | Direct query
| `ScrollConfig` | Yes | Yes (verified production write path) | aiLabelRequired, allowedFilterPresets, autoModeration, defaultVisibility, descriptionPreviewCharacters, enabled, headlinePreviewCharacters, impressionThresholdSeconds, maxDurationSeconds, monetizationEnabled, updatedAt, updatedById | No | Mutation/RETURNING only
| `LiveSession` | Yes | Yes (verified production write path) | endedAt, likesCount, lovesCount, metadata, peakViewerCount, recordingFileId, startedAt, status, updatedAt, viewerCount | No | Direct query
| `LiveParticipant` | Yes | Yes (verified production write path) | cameraState, joinedAt, leftAt, micState, role, status, updatedAt | No | Direct query
| `LiveInvite` | Yes | Yes (verified production write path) | inviterId, respondedAt, status, updatedAt | No | Direct query
| `LiveGift` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `LiveReactionCounter` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `LiveReport` | Yes | Yes (verified production write path) | note, reviewedAt, reviewedById, status, updatedAt | No | Direct query
| `LiveConfig` | Yes | Yes (verified production write path) | defaultVisibility, enableConference, enabled, enableGifts, enableRecording, maxGiftGcoin, maxGuests, maxParticipants, minGiftGcoin, rateLimitChatPerMinute, rateLimitReactionsPerMinute, updatedAt, updatedById | No | Mutation/RETURNING only
| `CommunityStory` | Yes | Yes (verified production write path) | commentsCount, updatedAt | Yes (verified production delete path) | Direct query
| `CommunityStoryLike` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityStoryView` | Yes | Yes (verified production write path) | createdAt | No | Mutation/RETURNING only
| `CommunityStoryReply` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityPoll` | Yes | Yes (verified production write path) | — | No | Direct query
| `CommunityPollOption` | No | No | — | No | Mutation/RETURNING only
| `CommunityPollVote` | Yes | Yes (verified production write path) | optionId, updatedAt | No | Direct query
| `CommunityBusinessPage` | Yes | Yes (verified production write path) | coverFileId, logoFileId, status, statusReason, statusUpdatedAt, statusUpdatedBy, updatedAt | Yes (verified production delete path) | Direct query
| `CommunityBusinessPageFollower` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `CommunityBusinessPageAdmin` | Yes | No | — | No | Direct query
| `GcoinEarningEvent` | Yes | Yes (verified production write path) | reactionActive, reversalCount, reversedAt | No | Direct query
| `CommunityAd` | Yes | Yes (verified production write path) | adminReviewNotes, archivedAt, archivedById, archiveReason, currency, impressions, paymentTransactionId, remainingBudget, status, targeting, updatedAt | Yes (verified production delete path) | Direct query
| `AdMetricsDaily` | Yes | Yes (verified production write path) | clicks, impressions, spend | No | Direct query
| `AdPayment` | Yes | Yes (verified production write path) | amount, currency, status | No | Direct query
| `UserFollow` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `UserBlock` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `Notification` | Yes | Yes (verified production write path) | isRead | No | Direct query
| `NotificationEvent` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `NotificationDelivery` | Yes | Yes (verified production write path) | attemptCount, deliveredAt, status, updatedAt | Yes (verified production delete path) | Direct query
| `NotificationPreference` | Yes | Yes (verified production write path) | deliveryMode, digestEnabled, emailEnabled, inAppEnabled, metadata, minPriority, previewEnabled, pushEnabled, smsEnabled, soundEnabled, updatedAt, version, vibrationEnabled | Yes (verified production delete path) | Direct query
| `NotificationEventPreference` | Yes | Yes (verified production write path) | category, deliveryMode, emailEnabled, inAppEnabled, metadata, minPriority, muted, pushEnabled, updatedAt | Yes (verified production delete path) | Direct query
| `NotificationGlobalPreference` | Yes | Yes (verified production write path) | allowEmergencySystem, allowMandatorySecurity, badgeEnabled, enableVibration, groupSimilar, marketingEnabled, metadata, pauseOptional, playSounds, productUpdatesEnabled, showPreviews, syncReadState, timezone, updatedAt, version | Yes (verified production delete path) | Direct query
| `NotificationFocusSession` | Yes | Yes (verified production write path) | active, updatedAt | No | Direct query
| `NotificationDigestSchedule` | Yes | Yes (verified production write path) | dailyHour, dailyMinute, emailEnabled, enabled, eveningHour, eveningMinute, inAppEnabled, includeRead, lastRunAt, lastRunKey, mode, morningHour, morningMinute, pushReadyAlert, timezone, updatedAt, weeklyDay, weeklyHour, weeklyMinute | No | Direct query
| `NotificationDigest` | Yes | Yes (verified production write path) | emailStatus, inAppNotificationId, readAt, sentAt, status, updatedAt | Yes (verified production delete path) | Direct query
| `NotificationDigestItem` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `NotificationSuppression` | No | No | — | No | Mutation/RETURNING only
| `NotificationAudit` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `NotificationAnalyticsCounter` | Yes | Yes (verified production write path) | updatedAt, value | No | Direct query
| `NotificationOpsTemplate` | Yes | Yes (verified production write path) | body, htmlBody, locale, metadata, name, publishedAt, status, subject, title, updatedAt, updatedBy, variables | No | Direct query
| `NotificationCampaign` | Yes | Yes (verified production write path) | body, cancelledAt, channels, confirmedAt, confirmedBy, deepLink, name, priority, reason, scheduledAt, scheduleType, sentAt, stats, status, targeting, title, updatedAt, updatedBy | No | Direct query
| `NotificationCampaignDelivery` | Yes | Yes (verified production write path) | — | No | Direct query
| `NotificationRetryJob` | Yes | Yes (verified production write path) | attemptCount, cancelledAt, completedAt, history, lastError, nextAttemptAt, status, updatedAt | No | Direct query
| `NotificationOpsConfig` | Yes | Yes (verified production write path) | updatedAt, updatedBy, value, version | No | Direct query
| `engagement_notification_rule` | Yes | Yes (verified production write path) | ai_assistance_enabled, body_template, category, cooldown_seconds, deep_link_template, event_type, frequency_window_seconds, in_app_enabled, is_enabled, max_notifications_per_window, metadata, name, priority, push_enabled, rollout_percentage, template_key, thresholds, title_template, updated_at, updated_by_id | No | Direct query
| `engagement_signal` | Yes | Yes (verified production write path) | aggregate_count, owner_id | No | Direct query
| `engagement_milestone_state` | Yes | Yes (verified production write path) | emitted_at, notification_id, status, suppressed_reason, updated_at | No | Direct query
| `MonetizationApplication` | Yes | Yes (verified production write path) | adminNote, reapplyAllowedAt, reviewedAt, reviewedByAdminId, status, updatedAt | No | Direct query
| `MonetizationProfile` | Yes | Yes (verified production write path) | disabledAt, disabledReason, enabledAt, isEnabled, updatedAt | No | Direct query
| `AccountViolation` | Yes | Yes (verified production write path) | resolvedAt | No | Direct query
| `PayoutProviderAccount` | Yes | Yes (verified production write path) | accountType, chargesEnabled, country, currency, disabledReason, isDisabledByAdmin, lastSyncedAt, payoutsEnabled, requirementsDue, status, updatedAt | No | Direct query
| `StaffRole` | Yes | Yes (verified production write path) | description, isActive, isSystemRole, name, updatedAt | No | Direct query
| `StaffPermission` | Yes | Yes (verified production write path) | group_name, label | No | Direct query
| `StaffRolePermission` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Mutation/RETURNING only
| `StaffUser` | Yes | Yes (verified production write path) | email, forcePasswordReset, fullName, lastLoginAt, passwordHash, require2FA, roleId, status, updatedAt, username | No | Direct query
| `PolicyNamespace` | Yes | Yes (verified production write path) | description, isActive, isSystemNamespace, label, updatedAt | No | Direct query
| `PolicyResource` | Yes | Yes (verified production write path) | description, isActive, label, updatedAt | No | Direct query
| `PolicyRule` | Yes | Yes (verified production write path) | conditions, description, effect, isActive, isSystemRule, key, label, namespaceId, permissionKey, priority, resourceId, updatedAt, updatedByStaffId | No | Direct query
| `UserPermissionOverride` | Yes | Yes (verified production write path) | effect, expiresAt, isActive, permissionKey, reason, resourceId, resourceType, updatedAt, updatedByStaffId, userId | No | Direct query
| `PermissionDecisionLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `AdminAuditEvent` | Yes | Yes (verified production write path) | — | No | Direct query
| `ApprovalPolicy` | Yes | Yes (verified production write path) | action_key, description, entity_type, is_active, is_system_policy, label, min_approvals, mode, module_key, updated_at, updated_by_staff_id | No | Direct query
| `ApprovalRequest` | Yes | Yes (verified production write path) | decided_at, decided_by_staff_id, decision_reason, status, updated_at | No | Direct query
| `SecurityAlert` | Yes | Yes (verified production write path) | dismissed_by_staff_id, resolved_at, status, updated_at | No | Direct query
| `CostCenter` | Yes | Yes (verified production write path) | approval_threshold, code, currency, department, is_active, metadata, monthly_budget, name, project_code, quarterly_budget, spend_cap, updated_at | No | Direct query
| `BudgetRule` | Yes | Yes (verified production write path) | alert_threshold_percent, approval_threshold, cost_center_id, currency, department, hard_stop, interval, is_active, limit_amount, metadata, project_code, updated_at | No | Direct query
| `PurchaseRequest` | Yes | Yes (verified production write path) | approved_at, finance_status, rejected_at, status, updated_at | No | Direct query
| `PurchaseApproval` | Yes | Yes (verified production write path) | — | No | Direct query
| `PurchaseOrder` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `SpendAuthorization` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `InvoiceRecord` | Yes | Yes (verified production write path) | approved_at, document_payload, metadata, split_breakdown, status, updated_at | No | Direct query
| `InvoiceLineItem` | No | No | — | No | Mutation/RETURNING only
| `CreditNote` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `ComplianceCase` | Yes | Yes (verified production write path) | hold_state, status, updated_at | No | Direct query
| `ComplianceEvidence` | Yes | Yes (verified production write path) | — | No | Direct query
| `ComplianceDecisionLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `ComplianceAppeal` | Yes | Yes (verified production write path) | metadata, resolution_note, status, updated_at | No | Direct query
| `RiskRule` | Yes | Yes (verified production write path) | action, code, entity_type, is_active, metadata, mode, name, signal_type, threshold, updated_at | No | Direct query
| `RiskScoreSnapshot` | Yes | Yes (verified production write path) | — | No | Direct query
| `HoldAction` | Yes | Yes (verified production write path) | metadata, released_at, status, updated_at | No | Direct query
| `TalentPool` | Yes | Yes (verified production write path) | description, is_active, metadata, name, slug, updated_at, visibility | No | Direct query
| `TalentPoolMember` | Yes | Yes (verified production write path) | internal_notes, invited_by_staff_id, membership_type, scorecard, status, tags, updated_at | No | Direct query
| `PrivateOpportunityAccess` | Yes | Yes (verified production write path) | entity_id, entity_type, metadata, pool_id, updated_at, visibility_scope | No | Direct query
| `VendorRequirement` | Yes | Yes (verified production write path) | code, is_active, metadata, name, require_contract_acceptance, required_compliance_checks, required_documents, required_kyc_tier, updated_at | No | Direct query
| `IntegrationEndpoint` | Yes | Yes (verified production write path) | dead_letter_enabled, event_types, metadata, name, retry_policy, secret_hash, status, target_url, type, updated_at | No | Direct query
| `WebhookDeliveryLog` | Yes | Yes (verified production write path) | attempts, delivered_at, last_error, next_attempt_at, signature, status, updated_at | No | Direct query
| `ApiCredential` | Yes | Yes (verified production write path) | last_used_at, metadata, name, scopes, status, updated_at | No | Direct query
| `AiTaskOutput` | Yes | Yes (verified production write path) | human_override_state, metadata, updated_at | No | Direct query
| `ManagedProject` | Yes | Yes (verified production write path) | coordinator_staff_id, entity_id, entity_type, metadata, risk_level, sla_status, status, title, updated_at | No | Direct query
| `ManagedMilestone` | Yes | Yes (verified production write path) | approved_at, description, due_at, managed_project_id, metadata, qa_status, risk_flag, status, title, updated_at | No | Direct query
| `ManagedAssignment` | Yes | Yes (verified production write path) | — | No | Mutation/RETURNING only
| `ManagedEscalationRule` | Yes | Yes (verified production write path) | code, is_active, metadata, name, target_role, threshold, trigger_type, updated_at | No | Direct query
| `FeatureFlag` | Yes | Yes (verified production write path) | category, defaultValue, description, isActive, key, killSwitch, label, updatedAt | No | Direct query
| `FeatureAudience` | Yes | Yes (verified production write path) | appVersions, countryScope, isActive, key, label, metadata, platformScope, roleScope, updatedAt | No | Direct query
| `FeatureRule` | Yes | Yes (verified production write path) | audienceId, conditions, endAt, isActive, priority, rolloutPercent, startAt, updatedAt, value | No | Direct query
| `FeatureExposure` | Yes | Yes (verified production write path) | — | No | Direct query
| `FeatureFlagAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `ConfigSnapshot` | Yes | Yes (verified production write path) | — | No | Direct query
| `ConfigChange` | Yes | Yes (verified production write path) | — | No | Direct query
| `RollbackRun` | Yes | Yes (verified production write path) | — | No | Direct query
| `ReleaseRollout` | Yes | Yes (verified production write path) | — | No | Direct query
| `SocketSession` | Yes | Yes (verified production write path) | authSource, connectedAt, disconnectedAt, disconnectReason, handshakeQuery, isAuthenticated, lastSeenAt, metadata, namespace, role, rooms, transport, updatedAt, userId | No | Direct query
| `PresenceLease` | Yes | Yes (verified production write path) | expiresAt, lastSeenAt, metadata, namespace, releasedAt, rooms, status, updatedAt, userId | No | Direct query
| `EventDelivery` | Yes | Yes (verified production write path) | replayedAt | No | Direct query
| `RealtimeIncident` | Yes | Yes (verified production write path) | details, lastSeenAt, notes, occurrences, resolvedAt, resolvedByStaffId, severity, status, updatedAt | No | Direct query
| `DeliveryReplayJob` | Yes | Yes (verified production write path) | — | No | Direct query
| `ContentPolicy` | Yes | Yes (verified production write path) | action, contentType, description, isActive, isSystemPolicy, key, label, metadata, severity, thresholds, updatedAt, updatedByStaffId | No | Direct query
| `ModerationAppeal` | Yes | No | resolutionNotes, resolvedAt, resolvedByStaffId, status, updatedAt | No | Direct query
| `TrustProfile` | Yes | Yes (verified production write path) | activeViolationCount, fraudScoreSnapshot, isVerifiedSnapshot, kycStatusSnapshot, lastComputedAt, metadata, moderationCaseCount, resolvedCaseCount, riskLevel, score, signalCount, updatedAt, updatedByStaffId, userId | No | Direct query
| `RiskSignal` | Yes | Yes (verified production write path) | expiresAt, metadata, reason, resolvedAt, resolvedByStaffId, severity, signalType, source, status, updatedAt | No | Direct query
| `ModerationAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `PasswordResetToken` | Yes | Yes (verified production write path) | usedAt | Yes (verified production delete path) | Direct query
| `AuthSession` | Yes | Yes (verified production write path) | revokedAt, revokeReason | Yes (verified production delete path) | Direct query
| `OAuthExchangeCode` | Yes | Yes (verified production write path) | usedAt | Yes (verified production delete path) | Direct query
| `AuthAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `LoginTrustedDevice` | Yes | Yes (verified production write path) | appVersion, browserName, deviceModel, deviceType, isTrusted, lastSeenAt, osVersion, platform, publicKey, updatedAt | No | Direct query
| `LoginApprovalAttempt` | Yes | Yes (verified production write path) | approvedAt, approvedByUserId, consumedAt, status, updatedAt | No | Direct query
| `PasskeyCredential` | Yes | Yes (verified production write path) | backed_up, counter, device_type, label, last_used_at, revoked_at, updated_at | No | Direct query
| `PasskeyChallenge` | Yes | Yes (verified production write path) | consumed_at | Yes (verified production delete path) | Direct query
| `DeviceToken` | Yes | Yes (verified production write path) | appVersion, capabilities, deviceId, deviceName, lastSeenAt, lastSyncAt, notificationCapable, platform, pushStatus, updatedAt, userId | Yes (verified production delete path) | Direct query
| `NotificationLifecycleEvent` | Yes | No | — | Yes (verified production delete path) | Direct query
| `NotificationSyncState` | Yes | Yes (verified production write path) | badgeCount, lastDeviceId, lastEventAt, metadata, unreadCount, updatedAt, version | No | Direct query
| `AiAutomationLog` | Yes | No | — | No | Direct query
| `LtvPrediction` | Yes | No | — | No | Direct query
| `DemandForecast` | Yes | No | — | No | Direct query
| `OpportunityRadarSnapshot` | Yes | No | — | No | Direct query
| `MarketInsightSnapshot` | No | No | — | No | Mutation/RETURNING only
| `community_config` | Yes | Yes (verified production write path) | updatedAt | No | Direct query
| `PreloaderConfig` | Yes | Yes (verified production write path) | accentColor, animationSpeed, backgroundColor, backgroundFileId, backgroundType, blurPx, customCss, gradientFrom, gradientTo, headlineText, isActive, loaderType, logoFileId, maxDurationMs, minDurationMs, name, overlayOpacity, position, showOnApiLoading, showOnInitialLoad, showOnRouteChange, status, subText, textColor, updatedAt, updatedByAdminId | Yes (verified production delete path) | Direct query
| `HumanVerificationSettings` | Yes | Yes (verified production write path) | data, updatedAt, updatedBy | No | Direct query
| `HumanVerificationPolicy` | No | No | — | No | Mutation/RETURNING only
| `HumanVerificationChallenge` | Yes | Yes (verified production write path) | attemptCount, solvedAt, solveTimeMs, status, usedAt, verificationConsumedAt, verificationExpiresAt, verificationTokenHash | No | Direct query
| `HumanVerificationAttempt` | Yes | Yes (verified production write path) | — | No | Direct query
| `HumanVerificationAnalytics` | Yes | Yes (verified production write path) | updatedAt, value | No | Direct query
| `HumanVerificationAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `AIProviderConfiguration` | Yes | Yes (verified production write path) | config, enabled, updatedAt, updatedBy | No | Direct query
| `AIModelConfiguration` | Yes | Yes (verified production write path) | displayName, enabled, maxTokens, updatedAt | No | Direct query
| `AICapability` | No | No | — | No | Mutation/RETURNING only
| `AIPrompt` | Yes | Yes (verified production write path) | inputTemplate, status, systemInstructions, updatedAt, version | No | Mutation/RETURNING only
| `AIPromptVersion` | No | No | — | No | Mutation/RETURNING only
| `AIRequest` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `AIResponseMetadata` | No | No | — | No | Mutation/RETURNING only
| `AIUsageLedger` | Yes | Yes (verified production write path) | — | No | Direct query
| `AIConsent` | Yes | Yes (verified production write path) | aiActivityHistoryEnabled, aiFeaturesEnabled, aiSuggestionsAllowed, consentVersion, externalProviderProcessingAllowed, personalizationAllowed, privateMessageAnalysisAllowed, productImprovementDataAllowed, updatedAt | No | Direct query
| `AISafetyDecision` | No | No | — | No | Mutation/RETURNING only
| `AIFeatureFlag` | Yes | Yes (verified production write path) | updatedAt, updatedBy, value, version | No | Direct query
| `AIAuditLog` | Yes | Yes (verified production write path) | — | No | Direct query
| `AIProviderHealthSnapshot` | No | No | — | No | Mutation/RETURNING only
| `AIConversation` | Yes | Yes (verified production write path) | archived, lastMessageAt, messageCount, pinned, title, updatedAt | Yes (verified production delete path) | Direct query
| `AIConversationMessage` | Yes | Yes (verified production write path) | — | Yes (verified production delete path) | Direct query
| `AIFeedback` | Yes | Yes (verified production write path) | — | No | Direct query
| `AIUserMemory` | Yes | Yes (verified production write path) | favoriteCommunities, mutedEntityIds, mutedTopics, preferredIndustries, preferredLanguages, preferredTopics, signalWeights, updatedAt, version | Yes (verified production delete path) | Direct query
| `AIRecommendationFeedback` | Yes | Yes (verified production write path) | — | No | Direct query
| `AILearningSignal` | Yes | Yes (verified production write path) | — | No | Direct query

## Additional and non-Prisma access

- The system backup service dynamically enumerates and reads all application tables and restores them with `TRUNCATE ... RESTART IDENTITY CASCADE` and inserts. That operation is removed from the ordinary runtime database identity and uses a separate optional `scrolith_backup` login/URL with SELECT, INSERT, TRUNCATE and sequence privileges only. The policy marker and Prisma ledger are excluded.
- Implicit Prisma many-to-many relation tables are maintained by Prisma nested `connect/disconnect/set` operations; the production SQL grants them only where the relation-write inventory confirms a supported operation.
- Raw SQL outside backup services is read-only health, locking, or reporting SQL; its model/table permissions are included in the direct SELECT/UPDATE sets where present. No raw financial DELETE/TRUNCATE path is permitted.
- Column-level UPDATE applies to table updates through Prisma and SQL. PostgreSQL still requires SELECT on columns used by predicates and returned values; table-level SELECT is retained.
- Database permissions do not replace API-level authorization, idempotency, validation, or ledger transaction invariants.



## Separate system-backup identity

The administrator-only system backup/restore service no longer uses the runtime Prisma connection for bulk table access. It uses SCROLITH_SYSTEM_BACKUP_DATABASE_URL and a dedicated PostgreSQL identity, scrolith_backup. Production connection configuration requires that role, database scrolith, an Azure PostgreSQL FQDN, sslmode=verify-full, and a mounted CA file (SCROLITH_SYSTEM_BACKUP_CA_FILE); it never falls back to DATABASE_URL and never disables TLS after failure. Local development fallback is loopback-only.

Migration defaults grant this optional role SELECT, INSERT, TRUNCATE on migration-created application tables and USAGE, SELECT, UPDATE on their sequences so it can create complete backups and perform the existing replace/restore workflow. It receives no table UPDATE/DELETE, schema CREATE, migration-ledger access, or policy-marker access. This is intentionally powerful: TRUNCATE ... CASCADE can erase broad application data. The role remains NOLOGIN throughout this procedure; it is not an ordinary runtime privilege and must not be enabled or placed in the API container without a separately approved architecture and credential review. The admin backup/restore endpoints fail closed in production until this role is separately configured and enabled. Co-locating its credential in the API process would reduce the isolation benefit; a dedicated operator/backup process is preferred.

## Limits and maintenance

This inventory is static evidence, not proof of every query generated by every optional route or provider adapter. Before adding or changing a model write, update this matrix and the production grant file, then run the PostgreSQL 17 operation tests. The production role intentionally fails closed when a new table/field has not been added to its explicit grant set.
