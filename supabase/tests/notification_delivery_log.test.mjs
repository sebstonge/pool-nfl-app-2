import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('notification telemetry migration: minimal grants, RLS, no existing data changes',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 try{
  await db.exec(await readFile(new URL('./lifecycle_fixture.sql',import.meta.url),'utf8'));
  await db.exec("insert into push_notification_events(event_key,status) values('old','pending')");
  await db.exec(await readFile(new URL('../migrations/202610060001_notification_delivery_log.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='push_notification_deliveries'::regclass")).rows[0].relrowsecurity,true);
  assert.equal((await db.query('select count(*)::int n from push_notification_deliveries')).rows[0].n,0);
  assert.equal((await db.query("select status from push_notification_events where event_key='old'")).rows[0].status,'pending');
  const insert="insert into push_notification_deliveries(user_id,scope,notification_type,title,body) values('00000000-0000-0000-0000-000000000001','regular','qb_turn','T','B')";
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);for(const statement of ['select * from push_notification_deliveries',insert,'delete from push_notification_deliveries','update push_notification_deliveries set body=body'])await assert.rejects(db.exec(statement),/permission denied/);await db.exec('reset role');
  }
  await db.exec('set role service_role');await db.exec(insert);await db.exec('update push_notification_deliveries set accepted_count=1,failed_count=1,attempted_count=2');
  assert.equal((await db.query('select accepted_count from push_notification_deliveries')).rows[0].accepted_count,1);
  await assert.rejects(db.exec('delete from push_notification_deliveries'),/permission denied/);await assert.rejects(db.exec('truncate push_notification_deliveries'),/permission denied/);
  await assert.rejects(db.exec('update push_notification_deliveries set accepted_count=5'),/check constraint/);
  await db.exec('reset role');assert.deepEqual((await db.query('select current_season,current_week from settings')).rows[0],{current_season:2026,current_week:5});
 }finally{await db.close();}
});
