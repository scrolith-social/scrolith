import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export const azureMediaEnabled = () => process.env.MEDIA_PROCESSING_MODE === 'azure_queue';
export const LEASE_SECONDS = 180;
export const MAX_ATTEMPTS = 5;
export const azureMediaKind = (mime: string) => !azureMediaEnabled() ? null
  : mime.startsWith('image/') && process.env.MEDIA_IMAGE_PROCESSING_ENABLED === 'true' ? 'image_variants'
  : mime.startsWith('video/') && process.env.MEDIA_VIDEO_PROCESSING_ENABLED === 'true' ? 'video_metadata' : null;
export type Job = {
  id: string; file_id: string; generation: number; kind: 'image_variants' | 'video_metadata';
  status: string; attempts: number; fence: number;
};
export type MediaFile = {
  id: string; owner_id: string | null; mime_type: string; size: string; storage_key: string;
  storage_provider: string; processing_version: number; visibility: string;
};
export type ClaimedJob = { job: Job; file: MediaFile };
export type VariantRow = {
  kind: string; label: string; width: number; height: number; format: string;
  mimeType: string; storageKey: string; size: number; checksum: string;
};

/** Called in the SAME Prisma transaction as the upload row. No queue network calls here. */
export async function recordAzureMediaRequest(tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> }, file: {
  id: string; mimeType: string; processingVersion?: number; storageProvider: string;
}) {
  if (!azureMediaEnabled()) return;
  if (file.storageProvider !== 'azure_blob') throw new Error('AZURE_MEDIA_STORAGE_REQUIRED');
  const kind = azureMediaKind(file.mimeType);
  if (!kind) return;
  await tx.$executeRaw`INSERT INTO azure_media_jobs (id,file_id,generation,kind)
    VALUES (${randomUUID()},${file.id},${file.processingVersion ?? 0},${kind})
    ON CONFLICT (file_id,generation,kind) DO NOTHING`;
}

export class AzureMediaOutbox {
  constructor(readonly pool: Pool) {}

  async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally { tx.release(); }
  }

  /** Re-send unacknowledged and expired jobs. Send-before-mark deliberately allows duplicates. */
  async dispatch(send: (id: string) => Promise<void>): Promise<number> {
    const rows = await this.pool.query<Job>(`SELECT * FROM azure_media_jobs
      WHERE status IN ('PENDING','RETRY','RUNNING') AND next_at <= clock_timestamp()
        AND (lease_until IS NULL OR lease_until < clock_timestamp())
        AND (last_dispatched_at IS NULL OR last_dispatched_at < clock_timestamp() - interval '3 minutes')
      ORDER BY created_at LIMIT 50`);
    let count = 0;
    for (const row of rows.rows) {
      await send(row.id);
      await this.pool.query('UPDATE azure_media_jobs SET last_dispatched_at=clock_timestamp() WHERE id=$1', [row.id]);
      count++;
    }
    return count;
  }

  async claim(id: string): Promise<ClaimedJob | 'terminal' | 'busy' | 'unknown'> {
    return this.transaction(async tx => {
      const result = await tx.query<Job>('SELECT * FROM azure_media_jobs WHERE id=$1 FOR UPDATE', [id]);
      const job = result.rows[0];
      if (!job) return 'unknown';
      if (['DONE','REJECTED','DEAD','STALE'].includes(job.status)) return 'terminal';
      const eligible = await tx.query(`SELECT 1 FROM azure_media_jobs WHERE id=$1
        AND next_at <= clock_timestamp() AND (lease_until IS NULL OR lease_until < clock_timestamp())`, [id]);
      if (!eligible.rowCount) return 'busy';
      const file = (await tx.query<MediaFile>('SELECT * FROM files WHERE id=$1 FOR UPDATE', [job.file_id])).rows[0];
      if (!file || file.processing_version !== job.generation || file.storage_provider !== 'azure_blob') {
        await tx.query("UPDATE azure_media_jobs SET status='STALE',error_code='SOURCE_CHANGED',lease_until=NULL WHERE id=$1", [id]);
        return 'terminal';
      }
      if (job.attempts >= MAX_ATTEMPTS) {
        await tx.query("UPDATE azure_media_jobs SET status='DEAD',error_code='RETRY_EXHAUSTED',lease_until=NULL WHERE id=$1", [id]);
        return 'terminal';
      }
      const claimed = await tx.query<Job>(`UPDATE azure_media_jobs SET status='RUNNING',attempts=attempts+1,
        fence=fence+1,lease_until=clock_timestamp()+make_interval(secs=>$2),updated_at=clock_timestamp()
        WHERE id=$1 RETURNING *`, [id, LEASE_SECONDS]);
      await tx.query("UPDATE files SET processing_status='PROCESSING',processing_started_at=clock_timestamp(),processing_error_code=NULL WHERE id=$1",[file.id]);
      return { job: claimed.rows[0], file };
    });
  }

  async renew(job: Job): Promise<boolean> {
    const r = await this.pool.query(`UPDATE azure_media_jobs
      SET lease_until=clock_timestamp()+make_interval(secs=>$3)
      WHERE id=$1 AND fence=$2 AND status='RUNNING' AND lease_until>clock_timestamp()`,
      [job.id, job.fence, LEASE_SECONDS]);
    return r.rowCount === 1;
  }

  async fail(job: Job, code: 'SCAN_REJECTED' | 'PROCESSING_RETRY' | 'SHUTDOWN'): Promise<boolean> {
    return this.transaction(async tx => {
      const r = await tx.query<{status:string;file_id:string;generation:number}>(`UPDATE azure_media_jobs SET
        status=CASE WHEN $3='SCAN_REJECTED' THEN 'REJECTED' WHEN attempts>=$4 THEN 'DEAD' ELSE 'RETRY' END,
        error_code=$3,lease_until=NULL,next_at=clock_timestamp()+make_interval(secs=>LEAST(900,attempts*30)),
        updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='RUNNING' AND lease_until>clock_timestamp()
        RETURNING status,file_id,generation`,[job.id,job.fence,code,MAX_ATTEMPTS]);
      const current=r.rows[0];
      if(!current) return false;
      await tx.query(`UPDATE files SET processing_status=$3::"FileProcessingStatus",processing_error_code=$4
        WHERE id=$1 AND processing_version=$2`,[current.file_id,current.generation,
        current.status==='RETRY'?'PENDING':'FAILED',code]);
      return true;
    });
  }

  async complete(claim: ClaimedJob, variants: VariantRow[], sourceSha256: string,
    metadata: { width: number; height: number; duration?: number }): Promise<boolean> {
    return this.transaction(async tx => {
      const lease = await tx.query(`SELECT * FROM azure_media_jobs WHERE id=$1 AND fence=$2
        AND status='RUNNING' AND lease_until>clock_timestamp() FOR UPDATE`, [claim.job.id, claim.job.fence]);
      if (!lease.rowCount) return false;
      const file = (await tx.query<MediaFile>('SELECT * FROM files WHERE id=$1 FOR UPDATE', [claim.file.id])).rows[0];
      if (!file || file.processing_version !== claim.job.generation ||
          file.storage_key !== claim.file.storage_key || file.owner_id !== claim.file.owner_id ||
          file.visibility !== claim.file.visibility || file.storage_provider !== 'azure_blob') {
        await tx.query("UPDATE azure_media_jobs SET status='STALE',error_code='SOURCE_CHANGED',lease_until=NULL WHERE id=$1", [claim.job.id]);
        return false;
      }
      if (!variants.length) throw new Error('NO_DERIVATIVES');
      for (const v of variants) {
        await tx.query(`INSERT INTO file_variants
          (id,file_id,kind,label,width,height,format,mime_type,storage_provider,storage_key,size_bytes,checksum,status,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'azure_blob',$9,$10,$11,'READY',clock_timestamp())
          ON CONFLICT (file_id,kind,width,format,label) DO UPDATE SET
          height=EXCLUDED.height,storage_provider=EXCLUDED.storage_provider,storage_key=EXCLUDED.storage_key,
          size_bytes=EXCLUDED.size_bytes,checksum=EXCLUDED.checksum,status='READY',updated_at=clock_timestamp()`,
          [randomUUID(),file.id,v.kind,v.label,v.width,v.height,v.format,v.mimeType,v.storageKey,v.size,v.checksum]);
      }
      const thumb = (await tx.query<{ id: string }>(`SELECT id FROM file_variants WHERE file_id=$1
        AND kind IN ('image_thumb','video_thumb') AND status='READY' ORDER BY width LIMIT 1`, [file.id])).rows[0];
      await tx.query(`UPDATE files SET processing_status='READY',processing_error_code=NULL,
        processing_completed_at=clock_timestamp(),width=$2,height=$3,duration=COALESCE($4,duration),
        thumbnail_url=COALESCE($5,thumbnail_url) WHERE id=$1`,
        [file.id,metadata.width,metadata.height,metadata.duration ?? null,
          thumb ? '/api/files/'+encodeURIComponent(file.id)+'/variants/'+encodeURIComponent(thumb.id)+'/content' : null]);
      await tx.query(`UPDATE azure_media_jobs SET status='DONE',source_sha256=$2,error_code=NULL,
        lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`, [claim.job.id,sourceSha256]);
      return true;
    });
  }
}
