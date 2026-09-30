import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
test('reminder migration and atomic queue in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table users(id uuid primary key);insert into users values('${a}'),('${b}');
   create table push_notification_events(event_key text primary key,user_id uuid,notification_type text,week integer not null,scheduled_for timestamptz,status text,sent_at timestamptz);
   create table playoff_rounds(id bigint primary key,status text,round_key text);
   create table playoff_games(id bigint primary key,round_id bigint,external_game_id text,game_date timestamptz,game_status text);
   create table playoff_qb_picks(round_id bigint,user_id uuid,super_bowl_total integer);
   create table playoff_team_paths(round_id bigint,user_id uuid);
   create table playoff_picks(game_id bigint,user_id uuid);
   create table settings(current_week integer);insert into settings values(2);
   create table qb_selection_weeks(week integer,started_at timestamptz);
   create table qb_picks(week integer,user_id uuid);
   create table games(week integer,is_pool_eligible boolean,game_date timestamptz);`);
  const migration=await readFile(new URL('../migrations/202609300001_notification_reminders.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const claim=async key=>(await db.query('select claim_pool_reminder($1) as claimed',[key])).rows[0].claimed;
  const count=async()=>(await db.query('select count(*)::int as n from push_notification_events')).rows[0].n;
  await t.test('idempotent migration; existing queue, service-only RPCs, no ordinary grants',async()=>{
   await db.exec(migration);
   for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    await assert.rejects(db.exec("select queue_pool_reminder('{}')"),/permission denied/);
    await assert.rejects(claim('x'),/permission denied/);
    await assert.rejects(db.exec('select * from push_notification_events'),/permission denied/);
    await db.exec('reset role');
   }
   const permissions=(await db.query("select has_function_privilege('service_role','public.queue_pool_reminder(jsonb)','execute') as queue,has_function_privilege('service_role','public.claim_pool_reminder(text)','execute') as claim")).rows[0];
   assert.deepEqual(permissions,{queue:true,claim:true});
  });
  await t.test('effective opening queues all players exactly once, no send during migration/reads',async()=>{
   assert.equal(await count(),0);
   await db.exec("insert into playoff_rounds values(1,'draft','wild_card',null);insert into playoff_games values(1,1,'123',now()+interval '2 hours','pre');update playoff_rounds set status='open' where id=1;");
   assert.equal(await count(),2);
   await db.exec("select * from playoff_rounds;update playoff_rounds set status='open' where id=1;");assert.equal(await count(),2);
   assert.equal(await claim(`playoff_open-1-${a}`),true);assert.equal(await claim(`playoff_open-1-${a}`),false);
  });
  await t.test('TEST opening queues nothing; locked and started rounds cannot claim',async()=>{
   await db.exec("insert into playoff_rounds values(2,'draft','divisional',null);insert into playoff_games values(2,2,'TEST-2',now()+interval '1 day','pre');update playoff_rounds set status='open' where id=2;");assert.equal(await count(),2);
   await db.exec("update playoff_rounds set status='locked' where id=1");assert.equal(await claim(`playoff_open-1-${b}`),false);
   await db.exec("update playoff_rounds set status='open' where id=1;update playoff_games set game_status='in' where id=1");assert.equal(await claim(`playoff_open-1-${b}`),false);
   await db.exec("update playoff_games set game_status='pre' where id=1");
  });
  const queue=async(key,user=b)=>db.query(`select queue_pool_reminder(jsonb_build_object('event_key',$1::text,'user_id',$2::text,'notification_type','playoff_h24','scheduled_for',now()-interval '1 hour','reminder_context',jsonb_build_object('round_id',1)))`,[key,user]);
  await t.test('H24 rechecks complete submission and schedule inside atomic claim',async()=>{
   await db.exec("update playoff_rounds set reminder_opened_at=now()-interval '2 days' where id=1");
   await queue('h24-a',a);await queue('h24-b');
   await db.exec(`insert into playoff_qb_picks values(1,'${a}',null);insert into playoff_team_paths values(1,'${a}');insert into playoff_picks values(1,'${a}')`);
   assert.equal(await claim('h24-a'),false);assert.equal(await claim('h24-b'),true);assert.equal(await claim('h24-b'),false);
   await queue('rescheduled');await db.exec("update playoff_games set game_date=now()+interval '3 days' where id=1");assert.equal(await claim('rescheduled'),false);
  });
  await t.test('regular stale week, submitted QB and changed cycle cannot claim',async()=>{
   await db.exec("insert into qb_selection_weeks values(2,now()-interval '2 days');insert into games values(2,true,now()+interval '3 days')");
   await db.query(`select queue_pool_reminder(jsonb_build_object('event_key','regular','user_id',$1::text,'week',2,'notification_type','regular_five_hour','scheduled_for',now()-interval '6 hours','reminder_context',jsonb_build_object('cycle',(select started_at from qb_selection_weeks))))`,[b]);
   await db.exec('update settings set current_week=3');assert.equal(await claim('regular'),false);
   await db.exec(`update settings set current_week=2;insert into qb_picks values(2,'${b}')`);assert.equal(await claim('regular'),false);
   await db.exec("delete from qb_picks;update qb_selection_weeks set started_at=now()");assert.equal(await claim('regular'),false);
  });
  await t.test('queue retry cannot reset a permanent claim or create a second event',async()=>{
   const before=await count();await queue('h24-b');assert.equal(await count(),before);assert.equal(await claim('h24-b'),false);
   const row=(await db.query("select reminder_attempted_at from push_notification_events where event_key='h24-b'")).rows[0];assert.ok(row.reminder_attempted_at);
  });
 }finally{await db.close();}
});
