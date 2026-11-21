-- Durable first-party auth-session revocation and version-bound OAuth exchanges.
-- Existing JWTs do not contain a session id/version and are intentionally rejected
-- after this migration is deployed with the new auth code, requiring one re-login.
-- This migration is additive: it does not rewrite or delete application data.

BEGIN;

ALTER TABLE "User"
  ADD COLUMN "authSessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Existing approval challenges predate session-version binding. Expire any
-- outstanding request so it cannot mint a session after this security upgrade.
ALTER TABLE "LoginApprovalAttempt"
  ADD COLUMN "authSessionVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "LoginApprovalAttempt"
  SET "status" = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "status" IN ('PENDING', 'APPROVED') AND "consumedAt" IS NULL;

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenIdHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_tokenIdHash_key"
  ON "AuthSession"("tokenIdHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx"
  ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx"
  ON "AuthSession"("expiresAt");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OAuthExchangeCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "authSessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthExchangeCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthExchangeCode_codeHash_key"
  ON "OAuthExchangeCode"("codeHash");
CREATE INDEX "OAuthExchangeCode_userId_expiresAt_idx"
  ON "OAuthExchangeCode"("userId", "expiresAt");
CREATE INDEX "OAuthExchangeCode_expiresAt_idx"
  ON "OAuthExchangeCode"("expiresAt");

ALTER TABLE "OAuthExchangeCode"
  ADD CONSTRAINT "OAuthExchangeCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
