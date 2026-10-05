import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const u='00000000-0000-0000-0000-000000000001',a='00000000-0000-0000-0000-000000000002';
test('lifecycle foundation in isolated PostgreSQL', {skip:!process.env.PGLITE_MODULE}, async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=async s=>db.exec(s),one=async s=>(await db.query(s)).rows[0];
 const as=async(role,statement)=>{await sql(`set role ${role}`);try{return await sql(statement);}finally{await sql('reset role');}};
 try{
  await sql(await readFile(new URL('./lifecycle_fixture.sql',import.meta.url),'utf8'));
  await sql(`insert into users(id,is_admin,display_name) values('${a}',true,'Admin');`);
  await sql(await readFile(new URL('../migrations/202609300001_notification_reminders.sql',import.meta.url),'utf8'));
  await sql("insert into push_notification_events values('old',null,'qb_turn',5,now(),'pending',null,null,null,null)");
  const migration=await readFile(new URL('../migrations/202610040001_lifecycle_foundation.sql',import.meta.url),'utf8');
  await sql(migration);
  await t.test('neutral installation, repeatable, preserves week/year/events/admin',async()=>{
   await sql(migration);
   assert.deepEqual(await one('select current_week,current_season,phase,regular_finalized_at,revision::int,playoff_reminders_enabled from settings'),{current_week:5,current_season:2026,phase:'regular',regular_finalized_at:null,revision:0,playoff_reminders_enabled:false});
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,1);
   assert.equal((await one(`select is_admin from users where id='${a}'`)).is_admin,true);
  });
  await t.test('ordinary profile cannot insert true, can insert false and edit allowed fields',async()=>{
   await sql(`select set_config('request.jwt.claim.sub','${u}',false)`);
   await assert.rejects(as('authenticated',`insert into users(id,is_admin) values('${u}',true)`),/is_admin/);
   await as('authenticated',`insert into users(id,display_name) values('${u}','User');update users set display_name='Changed',real_name='Name',must_change_password=false where id='${u}'`);
   assert.equal((await one(`select display_name from users where id='${u}'`)).display_name,'Changed');
   for(const v of ['true','null'])await assert.rejects(as('authenticated',`update users set is_admin=${v} where id='${u}'`),/is_admin/);
   await as('authenticated',`update users set is_admin=false where id='${u}'`);
  });
  await t.test('real admin cannot change its flag from browser; service role can manage flag',async()=>{
   await sql(`select set_config('request.jwt.claim.sub','${a}',false)`);
   await assert.rejects(as('authenticated',`update users set is_admin=false where id='${a}'`),/is_admin/);
   await as('authenticated',`update users set display_name='Still admin' where id='${a}';update settings set current_week=6 where id=1;`);
   await as('service_role',`update users set is_admin=true where id='${u}';update users set is_admin=false where id='${u}'`);
   assert.equal((await one(`select is_admin from users where id='${a}'`)).is_admin,true);
  });
  await t.test('frontend and service role cannot forge lifecycle closure or season; revision automatic',async()=>{
   for(const role of ['authenticated','service_role'])for(const change of ["phase='playoffs'","regular_finalized_at=now()","revision=100","current_season=2027","playoff_reminders_enabled=true"])
    await assert.rejects(as(role,`update settings set ${change} where id=1`),/trusted transition/);
   await assert.rejects(as('authenticated','select lock_regular_lifecycle(2026,1)'),/permission denied/);
   await as('service_role','select lock_regular_lifecycle(2026,1)');
   await as('authenticated','update settings set current_week=7 where id=1');
   await assert.rejects(as('service_role','select lock_regular_lifecycle(2026,1)'),/Stale/);
   await as('service_role','select lock_regular_lifecycle(2026,2)');
   assert.equal((await one('select regular_finalized_at from settings')).regular_finalized_at,null);
  });
  const tables=['games','picks','qb_picks','qb_ratings','qb_weekly_stats','weekly_scores','qb_selection_weeks'];
  await t.test('open regular writes remain permitted; no new qbs grants',async()=>{
   for(const table of tables) await as('service_role',`update ${table} set ${table==='qb_selection_weeks'?'week=week':'id=id'};delete from ${table} where false;`);
   await as('authenticated',"insert into games(external_game_id,week,home_team,away_team) values('123',7,'A','B');insert into weekly_scores(user_id,week) values('"+a+"',7);insert into qb_selection_weeks(week) values(7);");
   await as('service_role',"insert into qbs(name) values('Shared');insert into teams(name) values('Shared')");
   await assert.rejects(as('authenticated',"insert into qbs(name) values('Not newly allowed')"),/row-level security/);
  });
  await t.test('Playoff opening and direct queue produce nothing while disabled',async()=>{
   await sql("insert into playoff_rounds values(1,2026,'draft','wild_card',null);insert into playoff_games values(1,1,'123',now()+interval '3 days','pre');update playoff_rounds set status='open' where id=1");
   await as('service_role',`select queue_pool_reminder(jsonb_build_object('event_key','blocked','notification_type','playoff_open','user_id','${a}','scheduled_for',now(),'reminder_context','{}'::jsonb))`);
   await sql("insert into push_notification_events(event_key,notification_type) values('direct','playoff_open')");
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,1);
  });
  for(const state of ["regular_finalized_at=now()","phase='playoffs'"])await t.test(`all regular DML/TRUNCATE blocked: ${state}`,async()=>{
   await sql(`update settings set phase='regular',regular_finalized_at=null;update settings set ${state}`);
   for(const table of tables)for(const statement of [`update ${table} set ${table==='qb_selection_weeks'?'week=week':'id=id'}`,`delete from ${table} where false`,`insert into ${table} default values`,`truncate ${table}`])
    await assert.rejects(as('service_role',statement),/Regular season is closed/);
   await assert.rejects(as('authenticated','update settings set current_week=8'),/closed/);
   await as('service_role',"update teams set wins=1;update qbs set active=false;");
   await sql("insert into playoff_rounds values(2,2026,'draft','divisional',null) on conflict do nothing;");
   assert.equal((await one("select lifecycle_notification_allowed('qb_turn') ok")).ok,false);
   await sql("insert into push_notification_events(event_key,notification_type) values('regular-blocked','qb_turn')");
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,1);
  });
  await t.test('historical reminder cannot be claimed while disabled; no alteration of existing event',async()=>{
   // Seed only the isolated fixture as owner, before re-enabling the actual guard.
   await sql("alter table push_notification_events disable trigger lifecycle_notification;insert into push_notification_events(event_key,user_id,notification_type,scheduled_for,status,reminder_context) values('pending-playoff','"+a+"','playoff_open',now()-interval '1 hour','pending','{\"round_id\":1}');alter table push_notification_events enable trigger lifecycle_notification;");
   assert.equal((await one("select claim_pool_reminder('pending-playoff') claimed")).claimed,false);
   assert.equal((await one("select reminder_attempted_at from push_notification_events where event_key='pending-playoff'")).reminder_attempted_at,null);
  });
  await t.test('two contenders with one expected revision: only one mutation commits',async()=>{
   await sql("update settings set phase='regular',regular_finalized_at=null");
   const {revision}=await one('select revision from settings');
   const attempt=()=>sql(`begin;select lock_regular_lifecycle(2026,${revision});update settings set current_week=current_week+1;commit;`);
   const results=await Promise.allSettled([attempt(),attempt()]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.filter(r=>r.status==='rejected').length,1);
   await sql('rollback');
   assert.equal(Number((await one('select revision from settings')).revision),Number(revision)+1);
  });
  await t.test('settings singleton cannot be removed; ordinary TRUNCATE revoked',async()=>{
   await assert.rejects(sql('delete from settings'),/cannot be removed/);
   await assert.rejects(sql('truncate settings'),/cannot be removed/);
   for(const table of [...tables,'users','settings'])await assert.rejects(as('authenticated',`truncate ${table}`),/permission denied/);
  });
 }finally{await db.close();}
});
