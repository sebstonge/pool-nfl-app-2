import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Synthetic PostgreSQL instance only: no Supabase/ESPN client or remote writes.
const actor='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000003';
const newcomer='00000000-0000-0000-0000-000000000004';
const qb='00000000-0000-0000-0000-000000000002';
const otherQb='00000000-0000-0000-0000-000000000005';
const snapshot={selected_qb_name:'Selected QB',selected_espn_athlete_id:'99',selected_team:'Commanders'};
const migrations=[
 '202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql',
 '202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql',
 '202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql',
 '202610070001_lifecycle_transition.sql','202610080001_playoff_atomic_advance.sql',
 '202610090001_lifecycle_completion.sql',
];

test('regular QB selection snapshots in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=s=>db.exec(s),query=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await query(s,p)).rows[0];
 const role=async(name,uid,fn)=>{
  await query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await sql(`set role ${name}`);
  try{return await fn();}finally{await sql('reset role');}
 };
 const state=async()=>(await one('select regular_publication_state(2026) s')).s;
 const snapshotOf=async(week)=>one('select selected_qb_name,selected_espn_athlete_id,selected_team from qb_picks where qb_id=$1 and season=2026 and week=$2',[qb,week]);
 const fill=(week,name='Selected QB',id='99',team='Commanders')=>query('update qb_picks set selected_qb_name=$1,selected_espn_athlete_id=$2,selected_team=$3 where season=2026 and qb_id=$4 and week=$5',[name,id,team,qb,week]);
 const insert=(week,uid=member,values={})=>query('insert into qb_picks(season,user_id,qb_id,week,selected_qb_name,selected_espn_athlete_id,selected_team) values(2026,$1,$2,$3,$4,$5,$6) returning *',[uid,qb,week,values.selected_qb_name??null,values.selected_espn_athlete_id??null,values.selected_team??null]);
 const catalogPermissions=()=>query("select relacl::text acl,(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='qbs') policies from pg_class where oid='public.qbs'::regclass");
 const triggers=()=>query("select tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgrelid in ('public.qb_picks'::regclass,'public.users'::regclass) order by tgrelid,tgname");
 try{
  for(const file of ['lifecycle_fixture.sql','lifecycle_transition_fixture.sql'])await sql(await readFile(new URL(file,import.meta.url),'utf8'));
  await sql(`update settings set current_season=2026;
   insert into users(id,is_admin) values('${actor}',true),('${member}',false);
   insert into qbs(id,name,team,espn_athlete_id) values('${qb}','Selected QB','Commanders','99'),('${otherQb}','Other QB','Bills','101');
   insert into teams(name,espn_abbr) values('Washington Commanders','WAS'),('Buffalo Bills','BUF');`);
  for(const week of [1,2]){
   await query("insert into games(external_game_id,season,week,home_team,away_team) values($1,2026,$2,'Washington Commanders','Buffalo Bills')",[String(100+week),week]);
   await query("insert into picks(user_id,game_id,picked_team,predicted_spread) select $1,id,'Washington Commanders',7 from games where week=$2",[actor,week]);
   await query('insert into qb_picks(user_id,qb_id,week) values($1,$2,$3)',[actor,qb,week]);
  }
  await query("insert into qb_ratings(qb_id,week,passer_rating,actual_qb_name,actual_espn_athlete_id) values($1,1,85,'Previous result','98')",[qb]);
  for(const file of migrations){
   const migration=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
   if(file==='202610090001_lifecycle_completion.sql'){
    await sql(migration.slice(0,migration.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP'))+'commit;');
    await sql('update settings set regular_writes_paused=true where id=1');
   }
   await sql(migration);
  }
  await sql('update settings set regular_writes_paused=false where id=1');
  await query('insert into season_participants(season,user_id,confirmed) values(2026,$1,true)',[member]);
  await sql(`select set_config('request.headers','{"x-pool-regular-schema":"20261009"}',false)`);
  const before=await state(),permissionsBefore=await catalogPermissions(),triggersBefore=await triggers();
  await sql(await readFile(new URL('../migrations/202610190001_regular_qb_selection_snapshot.sql',import.meta.url),'utf8'));

  await t.test('installation leaves legacy values, ratings, lifecycle and catalog permissions unchanged',async()=>{
   const after=await state();
   assert.deepEqual(after.qb_picks.map(({selected_qb_name,selected_espn_athlete_id,selected_team,...p})=>{
    assert.deepEqual([selected_qb_name,selected_espn_athlete_id,selected_team],[null,null,null]);return p;
   }),before.qb_picks);
   assert.deepEqual({...after,qb_picks:before.qb_picks},before);
   assert.deepEqual(await catalogPermissions(),permissionsBefore);
   const kept=(await triggers()).rows.filter(r=>!r.tgname.startsWith('regular_qb_selection_snapshot_'));
   assert.deepEqual(kept,triggersBefore.rows);
   const cols=(await query("select column_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='qb_picks' and column_name like 'selected_%' order by column_name")).rows;
   assert.equal(cols.length,3);for(const c of cols){assert.equal(c.is_nullable,'YES');assert.equal(c.column_default,null);}
   assert.equal((await one('select count(*)::int n from regular_final_publications')).n,0);
  });

  await t.test('members capture catalog fields and cannot spoof selection identity',async()=>{
   await role('authenticated',member,async()=>{
    await insert(3,member,{selected_qb_name:'Spoofed',selected_espn_athlete_id:'777',selected_team:'Fake'});
    assert.deepEqual(await snapshotOf(3),snapshot);
    const updated=await query("update qbs set name='Member rewrite' where id=$1 returning id",[qb]);
    assert.equal(updated.rows.length,0);
   });
   assert.equal((await one('select name from qbs where id=$1',[qb])).name,'Selected QB');
  });

  await t.test('the existing INSERT payload works unchanged without any selected_* column',async()=>{
   const row=await role('authenticated',member,()=>one(
    'insert into qb_picks(season,user_id,qb_id,week) values(2026,$1,$2,7) returning *',[member,qb]));
   assert.equal(row.season,2026);assert.equal(row.qb_id,qb);assert.equal(row.user_id,member);
   assert.deepEqual(Object.fromEntries(Object.keys(snapshot).map(key=>[key,row[key]])),snapshot);
  });

  await t.test('catalog mutation preserves prior selection; next selection captures new identity',async()=>{
   await query("update qbs set name='New QB',espn_athlete_id='100',team='Bills' where id=$1",[qb]);
   assert.deepEqual(await snapshotOf(3),snapshot);
   await role('authenticated',member,()=>insert(4));
   assert.deepEqual(await snapshotOf(4),{selected_qb_name:'New QB',selected_espn_athlete_id:'100',selected_team:'Bills'});
   assert.deepEqual((await state()).qb_ratings,before.qb_ratings);
  });

  await t.test('unavailable or blank catalog identity rejects a selection rather than client fallback',async()=>{
   const catalog=await one('select name,espn_athlete_id,team from qbs where id=$1',[qb]);
   for(const field of ['name','espn_athlete_id','team']){
    for(const blank of ['  ','\t\n']){
     try{
      await query(`update qbs set ${field}=$1 where id=$2`,[blank,qb]);
      await assert.rejects(role('authenticated',member,()=>insert(10,member,snapshot)),/identity unavailable/);
     }finally{await query(`update qbs set ${field}=$1 where id=$2`,[catalog[field],qb]);}
    }
   }
   for(const field of ['espn_athlete_id','team']){
    try{
     await query(`update qbs set ${field}=null where id=$1`,[qb]);
     await assert.rejects(role('authenticated',member,()=>insert(10,member,snapshot)),/identity unavailable/);
    }finally{await query(`update qbs set ${field}=$1 where id=$2`,[catalog[field],qb]);}
   }
   await assert.rejects(query('insert into qb_picks(season,user_id,qb_id,week) values(2026,$1,$2,10)',[member,'00000000-0000-0000-0000-000000000099']),/identity unavailable/);
  });

  await t.test('snapshots and selection keys are immutable for all callers including privileged roles',async()=>{
   for(const name of ['authenticated','service_role','postgres']){
    await role(name,member,async()=>{
     for(const [field,value] of [['selected_qb_name','Spoofed'],['selected_espn_athlete_id','999'],['selected_team','Fake'],['qb_id',otherQb],['week',20],['user_id',actor],['season',2027]]){
      await assert.rejects(query(`update qb_picks set ${field}=$1 where season=2026 and user_id=$2 and week=3`,[value,member]),/immutable/);
     }
     await assert.rejects(query('update qb_picks set selected_qb_name=null,selected_espn_athlete_id=null,selected_team=null where season=2026 and user_id=$1 and week=3',[member]),/immutable/);
     await query('update qb_picks set selected_qb_name=selected_qb_name where season=2026 and user_id=$1 and week=3',[member]);
    });
   }
   assert.deepEqual(await snapshotOf(3),snapshot);
  });

  await t.test('legacy completion uses explicit reviewed values once and trusts database role only',async()=>{
   // The account is an application administrator, still authenticated in SQL.
   await role('authenticated',actor,async()=>{
    await sql(`select set_config('request.jwt.claim.role','service_role',false);select set_config('request.jwt.claims','{"role":"service_role","is_admin":true}',false)`);
    await assert.rejects(fill(1),/requires postgres\/service_role/);
    await query('update qb_picks set selected_qb_name=selected_qb_name where week=1');
   });
   assert.deepEqual(await snapshotOf(1),{selected_qb_name:null,selected_espn_athlete_id:null,selected_team:null});
   await role('service_role',actor,async()=>{
    await assert.rejects(fill(1,'Historical only',null,null),/requires postgres\/service_role|complete/);
    await assert.rejects(fill(1,'Historical only','99',' '),/requires postgres\/service_role|complete/);
    await fill(1);
    await assert.rejects(fill(1,'Corrected later'),/immutable/);
   });
   assert.deepEqual(await snapshotOf(1),snapshot); // Current qbs contains New QB/100/Bills.
   assert.deepEqual(await snapshotOf(2),{selected_qb_name:null,selected_espn_athlete_id:null,selected_team:null});
   assert.deepEqual((await state()).qb_ratings,before.qb_ratings);
  });

  await t.test('user creation, profile edits and admin role protection remain intact',async()=>{
   await role('authenticated',newcomer,async()=>{
    await query("insert into users(id,display_name,real_name,is_admin) values($1,'New member','A Person',false)",[newcomer]);
    await query("update users set display_name='Renamed member',real_name='Another Name' where id=$1",[newcomer]);
    await assert.rejects(query('update users set is_admin=true where id=$1',[newcomer]),/is_admin/);
   });
   assert.deepEqual(await one('select display_name,real_name,is_admin from users where id=$1',[newcomer]),{display_name:'Renamed member',real_name:'Another Name',is_admin:false});
   await role('authenticated',actor,async()=>{
    await query("update users set real_name='Admin profile edit' where id=$1",[actor]);
    await assert.rejects(query('update users set is_admin=false where id=$1',[actor]),/is_admin/);
   });
   assert.equal((await one('select is_admin from users where id=$1',[actor])).is_admin,true);
   assert.deepEqual(await catalogPermissions(),permissionsBefore);
  });

  await t.test('existing pause and lifecycle guards still reject selections',async()=>{
   await sql('update settings set regular_writes_paused=true where id=1');
   try{await assert.rejects(role('authenticated',member,()=>insert(11)),/Maintenance en cours/);}
   finally{await sql('update settings set regular_writes_paused=false where id=1');}
   try{await sql("update settings set phase='playoffs'");await assert.rejects(role('authenticated',member,()=>insert(11)),/closed or historical/);}
   finally{await sql("update settings set phase='regular'");}
  });

  // Integration coverage on a disposable in-memory PostgreSQL instance only.
  const correctionPick=async()=>(await one('select to_jsonb(p) p from qb_picks p where season=2026 and user_id=$1 and week=4',[member])).p;
  const corrected={selected_qb_name:'Reviewed historical QB',selected_espn_athlete_id:'102',selected_team:'Commanders'};
  const correct=(expected,values=corrected,who=actor,reason='Reviewed operator evidence')=>one(
   'select correct_regular_qb_selection_snapshot($1,$2,$3,$4,$5) result',
   [expected.id,who,JSON.stringify(expected),JSON.stringify(values),reason]);
  const corrections=()=>query('select * from regular_qb_snapshot_corrections order by requested_at,id');

  await t.test('installed correction RPC and audit table have the exact intended database privileges',async()=>{
   const p=await one(`select pg_get_userbyid(proowner) owner,prosecdef,proconfig,
    has_function_privilege('anon',oid,'EXECUTE') anon_exec,
    has_function_privilege('authenticated',oid,'EXECUTE') member_exec,
    has_function_privilege('service_role',oid,'EXECUTE') service_exec
    from pg_proc where oid='public.correct_regular_qb_selection_snapshot(uuid,uuid,jsonb,jsonb,text)'::regprocedure`);
   assert.equal(p.owner,'postgres');assert.equal(p.prosecdef,true);
   assert.ok(p.proconfig.includes('search_path=""'));
   assert.equal(p.anon_exec,false);assert.equal(p.member_exec,false);assert.equal(p.service_exec,true);
   const c=await one(`select relrowsecurity,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='regular_qb_snapshot_corrections') policies
    from pg_class where oid='public.regular_qb_snapshot_corrections'::regclass`);
   assert.equal(c.relrowsecurity,true);assert.equal(c.policies,0);
   for(const name of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
    const r=await one("select has_table_privilege($1,'public.regular_qb_snapshot_corrections',$2) allowed",[name,privilege]);
    assert.equal(r.allowed,name==='service_role'&&privilege==='SELECT',`${name} ${privilege}`);
   }
  });

  await t.test('exceptional correction and journal are inaccessible to browser roles or forged context',async()=>{
   const prior=await correctionPick();
   for(const name of ['anon','authenticated']){
    await role(name,actor,async()=>{
     await assert.rejects(correct(prior),/permission denied/);
     await assert.rejects(query('select * from regular_qb_snapshot_corrections'),/permission denied/);
    });
   }
   await role('service_role',actor,async()=>{
    await assert.rejects(sql('insert into regular_qb_snapshot_corrections default values'),/permission denied/);
    await sql(`select set_config('pool.qb_snapshot_correction','true',false)`);
    await assert.rejects(query('update qb_picks set selected_qb_name=$1 where id=$2',['Forged',prior.id]),/immutable/);
   });
   assert.deepEqual(await correctionPick(),prior);
   assert.equal((await corrections()).rows.length,0);
  });

  await t.test('exceptional correction requires an admin, a reason, the exact row and only three snapshot fields',async()=>{
   const prior=await correctionPick();
   await role('service_role',actor,async()=>{
    await assert.rejects(correct(prior,corrected,member),/Administrator/);
    await assert.rejects(correct(prior,corrected,actor,' \t '),/reason/i);
    await assert.rejects(correct({...prior,created_at:'2000-01-01T00:00:00Z'}),/Stale/);
    await assert.rejects(correct(prior,{...corrected,qb_id:otherQb}),/snapshot/i);
    await assert.rejects(correct(prior,{...corrected,selected_team:null}),/snapshot/i);
   });
   assert.deepEqual(await correctionPick(),prior);
   assert.equal((await corrections()).rows.length,0);
  });

  await t.test('the correction RPC cannot replace the reviewed legacy backfill for a NULL snapshot',async()=>{
   const prior=(await one('select to_jsonb(p) p from qb_picks p where season=2026 and week=2 and user_id=$1',[actor])).p;
   assert.equal(prior.selected_qb_name,null);
   await assert.rejects(role('service_role',actor,()=>correct(prior)),/reviewed legacy snapshot/);
   const after=(await one('select to_jsonb(p) p from qb_picks p where id=$1',[prior.id])).p;
   assert.deepEqual(after,prior);assert.equal((await corrections()).rows.length,0);
  });

  await t.test('an unrelated, expired or consumed receipt never authorizes a direct snapshot rewrite',async()=>{
   const prior=await correctionPick();
   for(const fault of ['wrong transaction','wrong before row','wrong after trio','already consumed']){
    await sql('begin');
    try{
     const before=fault==='wrong before row'?{...prior,selected_qb_name:'Unrelated old name'}:prior;
     const after=fault==='wrong after trio'?{...corrected,selected_qb_name:'Unrelated target'}:corrected;
     await query(`insert into regular_qb_snapshot_corrections(pick_id,actor_id,reason,before_pick,after_snapshot,transaction_id,applied_at)
      values($1,$2,$3,$4,$5,txid_current()${fault==='wrong transaction'?'-1':''},${fault==='already consumed'?'clock_timestamp()':'null'})`,
     [prior.id,actor,'Local fault injection only',JSON.stringify(before),JSON.stringify(after)]);
     await assert.rejects(query('update qb_picks set selected_qb_name=$1,selected_espn_athlete_id=$2,selected_team=$3 where id=$4',
      [corrected.selected_qb_name,corrected.selected_espn_athlete_id,corrected.selected_team,prior.id]),/immutable/,fault);
    }finally{await sql('rollback');}
    assert.deepEqual(await correctionPick(),prior);assert.equal((await corrections()).rows.length,0);
   }
  });

  await t.test('exceptional correction rolls back both row and consumed journal if a later trigger rejects',async()=>{
   const prior=await correctionPick();
   await sql(`create function public.test_reject_qb_snapshot_correction() returns trigger language plpgsql as $$
    begin raise exception 'Injected late rejection'; end $$;
    create trigger test_reject_qb_snapshot_correction after update on qb_picks for each row
    execute function public.test_reject_qb_snapshot_correction();`);
   try{await assert.rejects(role('service_role',actor,()=>correct(prior)),/Injected late rejection/);}
   finally{await sql('drop trigger test_reject_qb_snapshot_correction on qb_picks; drop function public.test_reject_qb_snapshot_correction();');}
   assert.deepEqual(await correctionPick(),prior);
   assert.equal((await corrections()).rows.length,0);
  });

  await t.test('exceptional correction respects maintenance, active phase and season without changing them',async()=>{
   const prior=await correctionPick();
   await sql('update settings set regular_writes_paused=true where id=1');
   try{await assert.rejects(role('service_role',actor,()=>correct(prior)),/maintenance/i);}
   finally{await sql('update settings set regular_writes_paused=false where id=1');}
   await sql("update settings set phase='playoffs' where id=1");
   try{await assert.rejects(role('service_role',actor,()=>correct(prior)),/closed|active|regular/i);}
   finally{await sql("update settings set phase='regular' where id=1");}
   await sql('update settings set current_season=2027 where id=1');
   try{await assert.rejects(role('service_role',actor,()=>correct(prior)),/closed|active|season/i);}
   finally{await sql('update settings set current_season=2026 where id=1');}
   await sql('update settings set regular_finalized_at=clock_timestamp() where id=1');
   try{await assert.rejects(role('service_role',actor,()=>correct(prior)),/closed|active|regular/i);}
   finally{await sql('update settings set regular_finalized_at=null where id=1');}
   assert.deepEqual(await correctionPick(),prior);
   assert.equal((await corrections()).rows.length,0);
  });

  await t.test('exceptional correction is audited, preserves keys/results and safely retries the same request',async()=>{
   const prior=await correctionPick(),before=await state();
   const first=await role('service_role',actor,()=>correct(prior));
   const afterPick=await correctionPick(),after=await state();
   for(const key of Object.keys(corrected))assert.notEqual(prior[key],corrected[key]);
   assert.deepEqual(afterPick,{...prior,...corrected});
   assert.deepEqual(after.qb_ratings,before.qb_ratings);
   assert.deepEqual(after.weekly_scores,before.weekly_scores);
   assert.deepEqual(after.settings,before.settings);
   const log=(await corrections()).rows;
   assert.equal(log.length,1);assert.deepEqual(log[0].before_pick,prior);
   assert.deepEqual(log[0].after_snapshot,corrected);assert.equal(log[0].actor_id,actor);
   assert.equal(log[0].reason,'Reviewed operator evidence');assert.ok(log[0].applied_at);
   const retry=await role('service_role',actor,()=>correct(prior));
   assert.equal(retry.result.correction_id,first.result.correction_id);
   assert.equal(retry.result.already_corrected,true);assert.equal((await corrections()).rows.length,1);
   await assert.rejects(role('service_role',actor,()=>correct(prior,{...corrected,selected_qb_name:'Different retry'})),/Stale/);
   await assert.rejects(query('update qb_picks set selected_qb_name=$1 where id=$2',['Direct later rewrite',prior.id]),/immutable/);
   assert.deepEqual(await correctionPick(),afterPick);
  });

  const proofFor=async()=>{
   const s=await state();
   return {version:1,season:2026,revision:s.settings.revision,
    calendar:{season:2026,season_type:2,event_ids:s.games.map(g=>g.external_game_id),weeks:s.games.map(g=>({week:g.week,event_ids:[g.external_game_id]}))},
    games:s.games.map(g=>({...g,home_score:21,away_score:14,final_status:'STATUS_FINAL',state:'post',completed:true})),
    ratings:s.games.map(g=>({qb_id:qb,week:g.week,game_id:g.id,team:'Washington Commanders',...snapshot,
     final_status:'STATUS_FINAL',state:'post',completed:true,
     passers:[{id:'100',name:'New QB',rating:20},{id:'99',name:'Selected QB',rating:100}],
     actual_espn_athlete_id:'99',actual_qb_name:'Selected QB',passer_rating:100})),
    results:s.games.map(g=>({user_id:actor,week:g.week,base_points:2,multiplier:1,final_score:2}))
     .sort((a,b)=>a.week-b.week||a.user_id.localeCompare(b.user_id)),
   };
  };
  const publish=async(proof)=>{
   const expected=await state();
   return one('select publish_regular_final(2026,$1,$2,$3,$4) result',[expected.settings.revision,actor,JSON.stringify(expected),JSON.stringify(proof)]);
  };

  await t.test('publication refuses legacy snapshot gaps with no guessed catalog or rating mutations',async()=>{
   const prior=await state();
   await assert.rejects(publish(await proofFor()),/snapshot unavailable/);
   assert.deepEqual(await state(),prior);
   await fill(2); // Explicit manual evidence, owner SQL; no automatic historical backfill.
  });

  await t.test('publication validates the complete selected snapshot from the same season/QB/week',async()=>{
   const prior=await state();
   for(const field of Object.keys(snapshot)){
    const proof=await proofFor();proof.ratings[0][field]='Spoofed';
    await assert.rejects(publish(proof),/snapshot mismatch/);
    const missing=await proofFor();delete missing.ratings[0][field];
    await assert.rejects(publish(missing),/snapshot mismatch/);
   }
   const wrongWeek=await proofFor();wrongWeek.ratings[0].week=9;
   await assert.rejects(publish(wrongWeek),/snapshot unavailable/);
   const wrongQb=await proofFor();wrongQb.ratings[0].qb_id=otherQb;
   await assert.rejects(publish(wrongQb),/snapshot unavailable/);
   const wrongChosen=await proofFor();Object.assign(wrongChosen.ratings[0],{actual_espn_athlete_id:'100',actual_qb_name:'New QB',passer_rating:20});
   await assert.rejects(publish(wrongChosen),/replacement mismatch/);
   assert.deepEqual(await state(),prior);
  });

  await t.test('publication uses frozen identity/team after catalog mutation and retains scoring controls',async()=>{
   const proof=await proofFor(),prior=await state();
   const wrongScore=structuredClone(proof);wrongScore.results[0].final_score=999;
   await assert.rejects(publish(wrongScore),/recalculation mismatch/);
   assert.deepEqual(await state(),prior);
   const result=await role('service_role',actor,()=>publish(proof));
   assert.equal(result.result.already_published,false);
   const after=await state();
   assert.deepEqual(after.settings,prior.settings);
   assert.deepEqual(after.qb_picks,prior.qb_picks);
   assert.equal(after.qb_ratings.length,2);
   for(const rating of after.qb_ratings){assert.equal(rating.actual_espn_athlete_id,'99');assert.equal(rating.actual_qb_name,'Selected QB');assert.equal(Number(rating.passer_rating),100);}
   assert.equal((await one('select regular_final_publication_valid(2026,$1) valid',[after.settings.revision])).valid,true);
   assert.equal((await publish(proof)).result.already_published,true);
  });

  await t.test('an exceptional snapshot correction invalidates an earlier publication without recalculating results',async()=>{
   const before=await state();
   const target=before.qb_picks.find(p=>p.week===2&&p.user_id===actor);
   assert.equal((await one('select regular_final_publication_valid(2026,$1) valid',[before.settings.revision])).valid,true);
   await role('service_role',actor,()=>correct(target,{...snapshot,selected_qb_name:'Reviewed historical name'},actor,'Operator correction after publication'));
   const after=await state();
   assert.equal((await one('select regular_final_publication_valid(2026,$1) valid',[after.settings.revision])).valid,false);
   assert.deepEqual(after.qb_ratings,before.qb_ratings);
   assert.deepEqual(after.weekly_scores,before.weekly_scores);
   assert.deepEqual(after.settings,before.settings);
   assert.equal((await one('select count(*)::int n from regular_final_publications')).n,1);
  });
 }finally{await db.close();}
});
