import './test-db-guard.mjs';
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if(process.argv.includes('--apply-policy')) {
  const url=new URL(process.env.DATABASE_URL);
  const env={...process.env,PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:process.env.TEST_DB_NAME,PGSSLMODE:'disable'};
  const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-v','SCROLITH_ROLE_SETUP_APPROVED=true','-f',fileURLToPath(new URL('../../deploy/postgres/scrolith-media-roles.sql',import.meta.url))],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.status!==0) throw Error('Disposable media role policy failed, exit '+result.status);
  console.log('Disposable media role policy applied with credentials only in process environment.');
}
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
let passed=0;
await client.connect();
try {
  for(const role of ['scrolith_media_dispatch','scrolith_media_worker']) {
    const result=await client.query('SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=$1',[role]);
    assert.equal(result.rowCount,1);
    assert.ok(Object.values(result.rows[0]).every(v=>v===false));
    for(const table of ['Transaction','Wallet','GcoinWallet','OrderPaymentSettlement','User','_prisma_migrations']) {
      const p=await client.query("SELECT has_table_privilege($1,quote_ident($2),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS any",[role,table]);
      assert.equal(p.rows[0].any,false,role+' must not access '+table); passed++;
    }
  }
  await client.query('SET ROLE scrolith_media_dispatch');
  await client.query('SELECT id FROM azure_media_jobs LIMIT 1');
  await client.query('UPDATE azure_media_jobs SET last_dispatched_at=clock_timestamp() WHERE false');
  await assert.rejects(client.query("UPDATE azure_media_jobs SET status='DONE' WHERE false"),e=>e.code==='42501');
  await assert.rejects(client.query('DELETE FROM azure_media_jobs WHERE false'),e=>e.code==='42501');
  await client.query('RESET ROLE'); passed+=4;
  await client.query('SET ROLE scrolith_media_worker');
  await client.query('SELECT id FROM files LIMIT 1');
  await client.query("UPDATE files SET processing_status='READY',width=96,height=64,duration=1,thumbnail_url='/api/files/synthetic',processing_error_code=NULL,processing_started_at=clock_timestamp(),processing_completed_at=clock_timestamp() WHERE false");
  await client.query("UPDATE azure_media_jobs SET status='RUNNING',attempts=attempts+1,fence=fence+1,lease_until=NULL,next_at=clock_timestamp(),error_code=NULL,source_sha256=NULL,updated_at=clock_timestamp() WHERE false");
  for(const sql of [
    "UPDATE files SET visibility='PUBLIC' WHERE false",
    "UPDATE files SET owner_id='other' WHERE false",
    'DELETE FROM files WHERE false','DELETE FROM file_variants WHERE false',
    'TRUNCATE files','ALTER TABLE files ADD COLUMN synthetic_forbidden TEXT',
    'DELETE FROM _prisma_migrations WHERE false'
  ]) await assert.rejects(client.query(sql),e=>e.code==='42501');
  await client.query('RESET ROLE'); passed+=10;
  console.log('PASS '+passed+' media-role permission assertions; NOLOGIN preserved; financial/auth/migration access denied.');
} finally { await client.end(); }