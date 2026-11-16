-- Preserve ad payment and Gcoin earning evidence when ads/posts are removed
-- from the user-facing product. Paid ads are archived by the application;
-- unpaid ads may still be hard-deleted. A restrictive FK closes the race where
-- a payment is recorded while an ad deletion is in flight.

BEGIN;

ALTER TABLE "CommunityAd"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

ALTER TABLE "AdPayment" DROP CONSTRAINT "AdPayment_adId_fkey";
ALTER TABLE "AdPayment" ADD CONSTRAINT "AdPayment_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "CommunityAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GcoinEarningEvent"
  ADD COLUMN "reactionActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversalCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GcoinEarningEvent" DROP CONSTRAINT "GcoinEarningEvent_postId_fkey";
ALTER TABLE "GcoinEarningEvent" ADD CONSTRAINT "GcoinEarningEvent_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
