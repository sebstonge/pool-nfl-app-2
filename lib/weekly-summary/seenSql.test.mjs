import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Disposable PostgreSQL only; this test never connects to Supabase or ESPN.
const member='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const unconfirmed='00000000-0000-0000-0000-000000000003';
const nonparticipant='00000000-0000-0000-0000-000000000004';
const migrations=[
 '202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql',
 '202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql',
 '202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql',
 '202610070001_lifecycle_transition.sql','202610080001_playoff_atomic_advance.sql',
 '202610090001_lifecycle_completion.sql',
];
const migrationUrl=new URL('../../supabase/migrations/20261023170813_regular_week_summary_views.sql',import.meta.url);

test('weekly summary seen markers in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=s=>db.exec(s),query=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await query(s,p)).rows[0];
 const role=async(name,uid,fn)=>{
  await query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);
  await sql(`set role ${name}`);
  try{return await fn();}finally{await sql('reset role');}
 };
 const insert=(uid=member,season=2026,week=4,suffix='')=>query(
  `insert into public.regular_week_summary_views(user_id,season,week) values($1,$2,$3) ${suffix}`,[uid,season,week]);
 const ownRows=()=>query('select user_id,season,week,seen_at from public.regular_week_summary_views order by season,week,user_id');
 const existingState=async()=>{
  const state={};
  for(const table of ['users','settings','seasons','season_participants']){
   state[table]=(await query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows;
  }
  state.policies=(await query("select * from pg_policies where schemaname='public' and tablename<>'regular_week_summary_views' order by tablename,policyname")).rows;
  state.triggers=(await query("select tgrelid::regclass::text table_name,tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by tgrelid,tgname")).rows;
  state.functions=(await query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
  state.permissions=(await query("select relname,relacl::text acl from pg_class where relnamespace='public'::regnamespace and relname<>'regular_week_summary_views' and relname<>'regular_week_summary_views_pkey' order by relname")).rows;
  return state;
 };
 try{
  for(const file of ['lifecycle_fixture.sql','lifecycle_transition_fixture.sql'])await sql(await readFile(new URL('../../supabase/tests/'+file,import.meta.url),'utf8'));
  await sql('update public.settings set current_season=2026,current_week=5 where id=1');
  for(const uid of [member,other,unconfirmed,nonparticipant])await query('insert into public.users(id,display_name) values($1,$2)',[uid,uid]);
  for(const file of migrations){
   const migration=await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8');
   if(file==='202610090001_lifecycle_completion.sql'){
    await sql(migration.slice(0,migration.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP'))+'commit;');
    await sql('update public.settings set regular_writes_paused=true where id=1');
   }
   await sql(migration);
  }
  await sql('update public.settings set regular_writes_paused=false where id=1');
  await sql('insert into public.seasons(season) values(2025),(2027)');
  for(const uid of [member,other,unconfirmed])await query('insert into public.season_participants(season,user_id,confirmed) values(2026,$1,$2)',[uid,uid!==unconfirmed]);
  // Emulate broad project defaults so the migration must explicitly remove them.
  await sql('alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role');
  const before=await existingState();
  await sql(await readFile(migrationUrl,'utf8'));

  await t.test('installation changes no existing rows, policies, privileges, functions or triggers',async()=>{
   assert.deepEqual(await existingState(),before);
   const table=await one("select relrowsecurity from pg_class where oid='public.regular_week_summary_views'::regclass");
   assert.equal(table.relrowsecurity,true);
   const policies=(await query("select cmd,roles from pg_policies where schemaname='public' and tablename='regular_week_summary_views' order by cmd")).rows;
   assert.deepEqual(policies.map(p=>p.cmd),['INSERT','SELECT']);
   for(const policy of policies)assert.deepEqual(policy.roles,['authenticated']);
   const columns=(await query("select column_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='regular_week_summary_views' order by ordinal_position")).rows;
   assert.deepEqual(columns.map(c=>[c.column_name,c.is_nullable]),[['user_id','NO'],['season','NO'],['week','NO'],['seen_at','NO']]);
   assert.equal(columns[3].column_default,'clock_timestamp()');
   assert.equal((await one('select count(*)::int n from public.regular_week_summary_views')).n,0);
  });

  await t.test('authenticated members insert and read only their own marker',async()=>{
   await role('authenticated',member,async()=>{
    assert.deepEqual(await one('select current_season,current_week,phase,regular_finalized_at,regular_writes_paused,auth.uid() uid from public.settings where id=1'),{current_season:2026,current_week:5,phase:'regular',regular_finalized_at:null,regular_writes_paused:false,uid:member});
    await insert();
    const rows=(await ownRows()).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].user_id,member);
    assert.equal(rows[0].season,2026);assert.equal(rows[0].week,4);
    assert.ok(Number.isFinite(new Date(rows[0].seen_at).getTime()));
   });
   await role('authenticated',other,async()=>{
    assert.equal((await ownRows()).rows.length,0);
    await assert.rejects(insert(member),/row-level security/);
    await insert(other);
    assert.deepEqual((await ownRows()).rows.map(r=>r.user_id),[other]);
   });
   await role('authenticated',member,async()=>assert.deepEqual((await ownRows()).rows.map(r=>r.user_id),[member]));
  });

  await t.test('anonymous callers and absent identities have no access',async()=>{
   await role('anon',null,async()=>{
    await assert.rejects(ownRows(),/permission denied/);
    await assert.rejects(insert(),/permission denied/);
   });
   await role('authenticated',null,async()=>{
    assert.equal((await ownRows()).rows.length,0);
    await assert.rejects(insert(),/row-level security/);
   });
  });

  await t.test('a retry preserves the first seen_at and does not duplicate the marker',async()=>{
   await role('authenticated',member,async()=>{
    const before=(await ownRows()).rows;
    await assert.rejects(insert(),/duplicate key/);
    await insert(member,2026,4,'on conflict (user_id,season,week) do nothing');
    assert.deepEqual((await ownRows()).rows,before);
   });
  });

  await t.test('browser inserts require the previous week, active season and confirmed participant',async()=>{
   for(const [uid,season,week] of [[member,2025,4],[member,2027,4],[member,2026,3],[member,2026,5],[unconfirmed,2026,4],[nonparticipant,2026,4]]){
    await assert.rejects(role('authenticated',uid,()=>insert(uid,season,week)),/row-level security/);
   }
   for(const change of ["phase='playoffs'","phase='offseason'","regular_finalized_at=clock_timestamp()",'regular_writes_paused=true']){
    await sql(`update public.settings set ${change} where id=1`);
    try{await assert.rejects(role('authenticated',member,()=>insert()),/row-level security/);}
    finally{await sql("update public.settings set phase='regular',regular_finalized_at=null,regular_writes_paused=false where id=1");}
   }
  });

  await t.test('all caller roles have exactly SELECT and INSERT, with no UPDATE, DELETE or other table powers',async()=>{
   for(const name of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
    const row=await one("select has_table_privilege($1,'public.regular_week_summary_views',$2) allowed",[name,privilege]);
    assert.equal(row.allowed,name!=='anon'&&['SELECT','INSERT'].includes(privilege),`${name} ${privilege}`);
   }
   for(const name of ['authenticated','service_role'])await role(name,member,async()=>{
    await assert.rejects(query('update public.regular_week_summary_views set seen_at=clock_timestamp() where user_id=$1',[member]),/permission denied/);
    await assert.rejects(query('delete from public.regular_week_summary_views where user_id=$1',[member]),/permission denied/);
    await assert.rejects(sql('truncate public.regular_week_summary_views'),/permission denied/);
   });
  });

  await t.test('trusted server inserts stay season scoped and obey keys, foreign keys and week bounds',async()=>{
   await role('service_role',member,async()=>{
    await insert(member,2025,4);
    await insert(member,2027,4);
    const rows=(await query('select season,week from public.regular_week_summary_views where user_id=$1 order by season',[member])).rows;
    assert.deepEqual(rows,[{season:2025,week:4},{season:2026,week:4},{season:2027,week:4}]);
    for(const week of [0,19])await assert.rejects(insert(member,2026,week),/check constraint/);
    await assert.rejects(insert(member,2099,4),/foreign key/);
    await assert.rejects(insert('00000000-0000-0000-0000-000000000099',2026,4),/foreign key/);
   });
   await role('authenticated',member,async()=>{
    assert.deepEqual((await ownRows()).rows.map(r=>r.season),[2025,2026,2027]);
   });
   await role('authenticated',other,async()=>{
    assert.deepEqual((await ownRows()).rows.map(r=>r.season),[2026]);
   });
   // Test context changes only incremented the existing revision counter.
   const after=await existingState();
   const [{row:initialSettings}]=before.settings,[{row:finalSettings}]=after.settings;
   assert.ok(finalSettings.revision>initialSettings.revision);
   assert.deepEqual({...finalSettings,revision:initialSettings.revision},initialSettings);
   assert.deepEqual({...after,settings:before.settings},before);
  });
 }finally{await db.close();}
});
