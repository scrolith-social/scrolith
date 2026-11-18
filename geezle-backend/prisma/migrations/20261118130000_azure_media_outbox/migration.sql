ALTER TABLE "files" ADD COLUMN "media_scan_required" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "azure_media_jobs" (
  "id" TEXT PRIMARY KEY,
  "file_id" TEXT NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "generation" INTEGER NOT NULL CHECK ("generation" >= 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image_variants','video_metadata')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','RUNNING','RETRY','DONE','REJECTED','DEAD','STALE')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "fence" INTEGER NOT NULL DEFAULT 0 CHECK ("fence" >= 0),
  "lease_until" TIMESTAMP(3),
  "next_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_dispatched_at" TIMESTAMP(3),
  "error_code" TEXT,
  "source_sha256" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "azure_media_jobs_file_id_generation_kind_key" UNIQUE ("file_id","generation","kind")
);
CREATE INDEX "azure_media_jobs_status_next_at_idx" ON "azure_media_jobs"("status","next_at");
