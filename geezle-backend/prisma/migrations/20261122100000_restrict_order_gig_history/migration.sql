-- Preserve the historical order-to-gig relationship when a catalog gig is removed.
-- Application delete flows archive linked gigs; this FK also closes the race
-- between the order check and a concurrent order creation.

BEGIN;

ALTER TABLE "Order" DROP CONSTRAINT "Order_gigId_fkey";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_gigId_fkey"
  FOREIGN KEY ("gigId") REFERENCES "Gig"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
