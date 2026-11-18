// Synthetic fixtures only. The shared guard refuses non-loopback/owner targets.
import './test-db-guard.mjs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { default: prisma, databasePool: pool, disconnectPrisma } = require('../dist/utils/prismaClient.js');
const { AzureMediaOutbox, recordAzureMediaRequest } = require('../dist/services/media/azureMediaOutbox.js');
const { consumeAzureMedia } = require('../dist/services/media/azureMediaConsumer.js');
const { createAzureMediaProcessor, MediaScanRejected } = require('../dist/services/media/azureMediaProcessor.js');
const { azureMediaPublicationAllowed } = require('../dist/services/media/azureMediaPublication.js');
const sharp = require('sharp');
process.env.MEDIA_PROCESSING_MODE = 'azure_queue';
process.env.MEDIA_IMAGE_PROCESSING_ENABLED = 'true';
process.env.MEDIA_VIDEO_PROCESSING_ENABLED = 'true';
process.env.MEDIA_WORKER_SERVICE = 'true';
const store = new AzureMediaOutbox(pool);
const ids = [];
let passed = 0;
const clean = { clean: true, infected: false, unavailable: false, rawStatus: 'CLEAN', engine: 'clamav' };
async function check(name, fn) { await fn(); passed++; console.log('PASS '+name); }
async function fixture(buffer, mime = 'image/png') {
  return prisma.$transaction(async tx => {
    const row = await tx.file.create({ data: {
      id: randomUUID(), filename: 'synthetic', originalName: 'synthetic', mimeType: mime,
      size: BigInt(buffer.length), url: '/api/files/synthetic', storageKey: randomUUID(),
      storageProvider: 'azure_blob', visibility: 'PRIVATE', mediaScanRequired: true
    } });
    ids.push(row.id);
    await recordAzureMediaRequest(tx, row);
    const job = await tx.azureMediaJob.findFirstOrThrow({ where: { fileId: row.id } });
    return { row, id: job.id };
  });
}
function queue(id) {
  let ack = 0, poison = 0;
  return { get ack() { return ack; }, get poisoned() { return poison; },
    async send() {}, async receive() { return { id: randomUUID(), receipt: 'synthetic', body: JSON.stringify({ id }) }; },
    async renew() {}, async acknowledge() { ack++; }, async poison() { poison++; }
  };
}
function processor(buffer, scan = clean) {
  const objects = new Map();
  return { objects, ...createAzureMediaProcessor({
    download: async () => ({ readableStreamBody: Readable.from([buffer]) }),
    scan: async () => scan,
    upload: async p => { objects.set(p.fileName, p.buffer); return 'azure-blob://synthetic'; },
    remove: async key => { objects.delete(key); }
  }) };
}
async function state(id) { return (await pool.query('SELECT * FROM azure_media_jobs WHERE id=$1', [id])).rows[0]; }
async function due(id) { await pool.query("UPDATE azure_media_jobs SET next_at=clock_timestamp()-interval '1 second',lease_until=NULL,last_dispatched_at=NULL WHERE id=$1",[id]); }
let dir;
try {
  const image = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#225544' } }).png().toBuffer();
  await check('upload row and authoritative outbox roll back together', async () => {
    const id = randomUUID();
    await assert.rejects(prisma.$transaction(async tx => {
      const row = await tx.file.create({ data: { id, filename: 'x', originalName: 'x', mimeType: 'image/png', size: 1n, url: '/x', storageKey: randomUUID(), storageProvider: 'azure_blob' } });
      await recordAzureMediaRequest(tx, row); throw Error('synthetic rollback');
    }));
    assert.equal(await prisma.file.count({ where: { id } }), 0);
    assert.equal(await prisma.azureMediaJob.count({ where: { fileId: id } }), 0);
  });
  const f = await fixture(image), q = queue(f.id), p = processor(image);
  await check('persistent scan gate blocks unscanned original and manifest', async () => {
    assert.equal(await azureMediaPublicationAllowed(f.row), false);
    process.env.MEDIA_PROCESSING_MODE = 'disabled';
    assert.equal(await azureMediaPublicationAllowed(f.row), false);
    process.env.MEDIA_PROCESSING_MODE = 'azure_queue';
  });
  await check('real Sharp image derivatives publish atomically with scanned source digest', async () => {
    assert.equal(await consumeAzureMedia(store, q, p), 'done');
    assert.equal(q.ack, 1);
    assert.equal((await state(f.id)).source_sha256, createHash('sha256').update(image).digest('hex'));
    assert.equal(await azureMediaPublicationAllowed(f.row), true);
    const variants = await prisma.fileVariant.findMany({ where: { fileId: f.row.id } });
    assert.ok(variants.length >= 2);
    for (const v of variants) { assert.ok(v.storageKey.startsWith('media/'+f.row.id+'/azure/')); assert.equal(v.storageProvider, 'azure_blob'); }
  });
  await check('ordinary duplicate and distinct delivery IDs do not reprocess', async () => {
    const n = await prisma.fileVariant.count({ where: { fileId: f.row.id } });
    assert.equal(await consumeAzureMedia(store, q, p), 'terminal');
    assert.equal(await prisma.fileVariant.count({ where: { fileId: f.row.id } }), n);
    assert.equal((await state(f.id)).attempts, 1);
  });
  await check('ack failure after commit preserves objects; redelivery acknowledges terminal job', async () => {
    const a = await fixture(image), qp = queue(a.id), pp = processor(image);
    const ack = qp.acknowledge;
    qp.acknowledge = async () => { throw Error('synthetic ACK failure'); };
    await assert.rejects(consumeAzureMedia(store, qp, pp));
    assert.equal((await state(a.id)).status, 'DONE'); assert.ok(pp.objects.size > 0);
    qp.acknowledge = ack;
    assert.equal(await consumeAzureMedia(store, qp, pp), 'terminal'); assert.equal(qp.ack, 1);
  });
  await check('ambiguous COMMIT response never deletes committed objects or acknowledges early', async () => {
    const a=await fixture(image), qp=queue(a.id), pp=processor(image);
    const uncertain=new AzureMediaOutbox(pool);
    uncertain.complete=async (...args)=>{ await store.complete(...args); throw Error('synthetic lost COMMIT response'); };
    assert.equal(await consumeAzureMedia(uncertain,qp,pp),'deferred');
    assert.equal((await state(a.id)).status,'DONE');assert.ok(pp.objects.size>0);assert.equal(qp.ack,0);
    assert.equal(await consumeAzureMedia(store,qp,pp),'terminal');assert.equal(qp.ack,1);
  });
  await check('scan rejection persists REJECTED without derivatives or publication', async () => {
    const a = await fixture(image), qp = queue(a.id), pp = processor(image, { ...clean, clean: false, infected: true, rawStatus: 'INFECTED' });
    assert.equal(await consumeAzureMedia(store, qp, pp), 'deferred');
    assert.equal((await state(a.id)).status, 'REJECTED'); assert.equal(qp.ack, 0); assert.equal(pp.objects.size, 0);
    assert.equal(await azureMediaPublicationAllowed(a.row), false);
    assert.equal(await consumeAzureMedia(store, qp, pp), 'terminal'); assert.equal(qp.ack, 1);
  });
  await check('mock-clean and unavailable scanner results fail closed before decoding', async () => {
    for (const scan of [{ ...clean, engine: 'mock' }, { ...clean, clean: false, unavailable: true, rawStatus: 'UNAVAILABLE' }]) {
      const a = await fixture(image), qp = queue(a.id), pp = processor(image, scan);
      assert.equal(await consumeAzureMedia(store, qp, pp), 'deferred');
      assert.equal((await state(a.id)).status, 'RETRY'); assert.equal(pp.objects.size, 0); assert.equal(qp.ack, 0);
    }
  });
  await check('expired lease fences stale completion and renewal', async () => {
    const a = await fixture(image), old = await store.claim(a.id);
    assert.equal(typeof old, 'object'); await due(a.id);
    const newer = await store.claim(a.id); assert.equal(newer.job.fence, old.job.fence+1);
    assert.equal(await store.renew(old.job), false);
    assert.equal(await store.complete(old, [], 'unused', { width: 1, height: 1 }), false);
    assert.equal((await state(a.id)).fence, newer.job.fence);
  });
  await check('stale worker cannot overwrite or clean up a newer completed attempt', async () => {
    const a=await fixture(image), old=processor(image), newer=processor(image);
    let release, started;
    const ready=new Promise(resolve=>{started=resolve;});
    const wait=new Promise(resolve=>{release=resolve;});
    const generate=old.generate;
    old.generate=async claim=>{started();await wait;return generate(claim);};
    const running=consumeAzureMedia(store,queue(a.id),old);
    await ready;await due(a.id);
    assert.equal(await consumeAzureMedia(store,queue(a.id),newer),'done');
    const count=newer.objects.size;release();
    assert.equal(await running,'deferred');assert.equal(old.objects.size,0);assert.equal(newer.objects.size,count);
    assert.equal((await state(a.id)).status,'DONE');assert.equal((await state(a.id)).fence,2);
    for(const v of await prisma.fileVariant.findMany({where:{fileId:a.row.id}})) assert.ok(newer.objects.has(v.storageKey));
  });
  await check('concurrent workers claim at most one active lease', async () => {
    const a = await fixture(image);
    const claims = await Promise.all([store.claim(a.id),store.claim(a.id)]);
    assert.equal(claims.filter(c => typeof c === 'object').length, 1);
    assert.equal(claims.filter(c => c === 'busy').length, 1);
  });
  await check('source generation or privacy change prevents stale publication', async () => {
    const a = await fixture(image), c = await store.claim(a.id);
    await prisma.file.update({ where: { id: a.row.id }, data: { visibility: 'PUBLIC' } });
    assert.equal(await store.complete(c, [], 'unused', { width: 1, height: 1 }), false);
    assert.equal((await state(a.id)).status, 'STALE');
  });
  await check('storage failure retries without ack or leaked candidate objects', async () => {
    const a = await fixture(image), qp = queue(a.id), pp = processor(image);
    const upload = pp.upload; let failures = 1;
    pp.upload = async (key,v) => { await upload(key,v); if (failures-- > 0) throw Error('synthetic storage failure'); };
    assert.equal(await consumeAzureMedia(store, qp, pp), 'deferred');
    assert.equal(pp.objects.size, 0); assert.equal(qp.ack, 0); assert.equal((await state(a.id)).status, 'RETRY');
    await due(a.id); assert.equal(await consumeAzureMedia(store, qp, pp), 'done');
  });
  await check('database failure before claim never acknowledges the message', async () => {
    const a = await fixture(image), qp = queue(a.id);
    const unavailable = new AzureMediaOutbox({ connect: async () => { throw Error('synthetic DB failure'); } });
    await assert.rejects(consumeAzureMedia(unavailable, qp, processor(image))); assert.equal(qp.ack, 0);
    assert.equal(await consumeAzureMedia(store, qp, processor(image)), 'done');
  });
  await check('shutdown leaves durable retry; restart succeeds', async () => {
    const a = await fixture(image), qp = queue(a.id), controller = new AbortController(); controller.abort();
    assert.equal(await consumeAzureMedia(store, qp, processor(image), controller.signal), 'deferred');
    assert.equal((await state(a.id)).error_code, 'SHUTDOWN'); assert.equal(qp.ack, 0);
    await due(a.id); assert.equal(await consumeAzureMedia(store, qp, processor(image)), 'done');
  });
  await check('five failed attempts become DEAD; delivery acknowledges durable terminal result', async () => {
    const a = await fixture(image), qp = queue(a.id), pp = processor(image);
    pp.generate = async () => { throw Error('synthetic temporary failure'); };
    for(let i=0;i<5;i++){ await due(a.id); assert.equal(await consumeAzureMedia(store,qp,pp),'deferred'); }
    assert.equal((await state(a.id)).status,'DEAD'); assert.equal((await state(a.id)).attempts,5);
    assert.equal(await consumeAzureMedia(store,qp,pp),'terminal'); assert.equal(qp.ack,1);
    // Administrative recovery fixture, not a worker/runtime feature or automatic repair.
    await pool.query("UPDATE azure_media_jobs SET status='RETRY',attempts=0 WHERE id=$1 AND status='DEAD'",[a.id]);
    await due(a.id); assert.equal(await consumeAzureMedia(store,qp,processor(image)),'done');
  });
  await check('dispatcher send failure leaves outbox undispatched; reconciliation resends', async () => {
    const a = await fixture(image);
    await assert.rejects(store.dispatch(async () => { throw Error('synthetic queue outage'); }));
    assert.equal((await state(a.id)).last_dispatched_at,null);
    const sent=[]; await store.dispatch(async id => { sent.push(id); }); assert.ok(sent.includes(a.id));
  });
  await check('send-before-mark crash permits safe duplicate dispatch', async () => {
    const a = await fixture(image); let sent = 0;
    const broken = new AzureMediaOutbox({ query: async (sql,args) => {
      if(sql.startsWith('SELECT')) return pool.query('SELECT * FROM azure_media_jobs WHERE id=$1',[a.id]);
      throw Error('synthetic DB failure after queue send');
    } });
    await assert.rejects(broken.dispatch(async () => { sent++; }));
    assert.equal(sent,1); assert.equal((await state(a.id)).last_dispatched_at,null);
    const qp=queue(a.id); assert.equal(await consumeAzureMedia(store,qp,processor(image)),'done');
    assert.equal(await consumeAzureMedia(store,qp,processor(image)),'terminal');
  });
  await check('malformed/unknown messages are quarantined using safe metadata only', async () => {
    const qp=queue(randomUUID()); assert.equal(await consumeAzureMedia(store,qp,processor(image)),'unknown'); assert.equal(qp.poisoned,1); assert.equal(qp.ack,1);
    qp.receive=async () => ({ id: randomUUID(),receipt:'synthetic',body:'{malformed' });
    assert.equal(await consumeAzureMedia(store,qp,processor(image)),'invalid'); assert.equal(qp.poisoned,2); assert.equal(qp.ack,2);
  });
  await check('real H264 metadata, FFmpeg poster and thumbnail generation', async () => {
    dir=await mkdtemp(join(tmpdir(),'scrolith-media-synthetic-'));
    const video=join(dir,'synthetic.mp4');
    execFileSync(process.env.MEDIA_FFMPEG_PATH || 'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=green:s=96x64:d=1','-c:v','libx264','-pix_fmt','yuv420p',video],{timeout:30000});
    const bytes=await readFile(video), a=await fixture(bytes,'video/mp4'), qp=queue(a.id), pp=processor(bytes);
    assert.equal(await consumeAzureMedia(store,qp,pp),'done');
    const row=await prisma.file.findUniqueOrThrow({where:{id:a.row.id}});
    assert.equal(row.width,96); assert.equal(row.height,64); assert.ok(row.duration>0);
    const variants=await prisma.fileVariant.findMany({where:{fileId:row.id}});
    assert.deepEqual(variants.map(v=>v.kind).sort(),['video_poster','video_thumb']);
    for(const v of variants){ const b=pp.objects.get(v.storageKey); assert.ok(b.length>0); assert.equal(b.toString('ascii',8,12),'WEBP'); }
  });
  await check('real processing transaction works under restricted NOLOGIN media worker role', async () => {
    const {Pool}=require('pg');
    const limitedPool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c role=scrolith_media_worker',max:2});
    try {
      assert.equal((await limitedPool.query('SELECT current_user')).rows[0].current_user,'scrolith_media_worker');
      const a=await fixture(image), qp=queue(a.id), pp=processor(image), limited=new AzureMediaOutbox(limitedPool);
      assert.equal(await consumeAzureMedia(limited,qp,pp),'done');
      assert.equal(await consumeAzureMedia(limited,qp,pp),'terminal');
      assert.equal((await state(a.id)).attempts,1);
      const rejected=await fixture(image), bad=processor(image,{...clean,clean:false,infected:true,rawStatus:'INFECTED'});
      assert.equal(await consumeAzureMedia(limited,queue(rejected.id),bad),'deferred');
      assert.equal((await state(rejected.id)).status,'REJECTED');
      const file=await prisma.file.findUniqueOrThrow({where:{id:rejected.row.id}});
      assert.equal(file.processingStatus,'FAILED');assert.equal(file.processingErrorCode,'SCAN_REJECTED');
      assert.equal(await azureMediaPublicationAllowed(file),false);
    } finally {await limitedPool.end();}
  });
  console.log('Azure media database/processor regressions: '+passed+' passed, 0 skipped; storage, queue and scan results synthetic; Sharp/FFmpeg real.');
} catch(error) {
  // Do not print connection details or arbitrary provider error payloads.
  console.error('Azure media regression failed:',error?.code || error?.name || 'unknown',String(error?.message||'').replaceAll(process.env.DATABASE_URL,'[DATABASE REDACTED]'));
  process.exitCode=1;
} finally {
  if(ids.length) await prisma.file.deleteMany({where:{id:{in:ids}}});
  if(dir) await rm(dir,{recursive:true,force:true});
  await disconnectPrisma();
}
