import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {fixture,user,qb} from '../../lib/regular-publication/fixtures.mjs';
import {prepareFinalPublication} from '../../lib/regular-publication/prepare.mjs';
test('final regular publication in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite(),f=fixture();
 const sql=s=>db.exec(s),one=async(s,args)=>(await db.query(s,args)).rows[0];
 const state=async()=>(await one('select regular_publication_state(2026) s')).s;
 const valid=async()=>(await one('select regular_final_publication_valid(2026,0) v')).v;
 const role=async(name,fn)=>{await sql(`set role ${name}`);try{return await fn();}finally{await sql('reset role');}};
 const publish=(expected,proof,season=2026,revision=0,actor=user)=>one('select publish_regular_final($1,$2,$3,$4,$5) p',[season,revision,actor,JSON.stringify(expected),JSON.stringify(proof)]);
 try{
  await sql(await readFile(new URL('./lifecycle_fixture.sql',import.meta.url),'utf8'));
  await sql(`insert into users(id,is_admin) values('${user}',true);insert into qbs(id,name,team,espn_athlete_id) values('${qb}','Selected QB','Commanders','99');insert into teams(name,espn_abbr) values('Washington Commanders','WAS'),('Buffalo Bills','BUF');`);
  for(const g of f.state.games){await db.query('insert into games(id,external_game_id,week,home_team,away_team,home_score,away_score) values($1,$2,$3,$4,$5,999,0)',[g.id,g.external_game_id,g.week,g.home_team,g.away_team]);await db.query('insert into picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,$3,7)',[user,g.id,g.home_team]);await db.query('insert into qb_picks(user_id,qb_id,week) values($1,$2,$3)',[user,qb,g.week]);}
  for(const file of ['202609300001_notification_reminders.sql','202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql'])await sql(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const before=await state(),proof=await prepareFinalPublication(before,{fetcher:f.fetcher});
  await t.test('installation publishes nothing and leaves lifecycle/playoffs/reminders unchanged',async()=>{
   assert.equal((await one('select count(*)::int n from regular_final_publications')).n,0);assert.equal(await valid(),false);
   assert.equal((await state()).settings.phase,'regular');assert.equal((await state()).settings.revision,0);
   assert.equal((await one('select count(*)::int n from playoff_rounds')).n,0);assert.equal((await one('select count(*)::int n from push_notification_events')).n,0);
  });
  await t.test('ordinary users cannot invoke RPCs or read/write attestations; service has no direct writes',async()=>{
   for(const name of ['anon','authenticated'])await role(name,async()=>{
    await assert.rejects(publish(before,proof),/permission denied/);await assert.rejects(state(),/permission denied/);await assert.rejects(valid(),/permission denied/);await assert.rejects(sql('select * from regular_final_publications'),/permission denied/);
   });
   await role('service_role',async()=>{await assert.rejects(sql('delete from regular_final_publications'),/permission denied/);await assert.rejects(publish(before,proof,2026,0,qb),/Administrator/);});
  });
  await t.test('wrong season/revision and tampered calculation rejected',async()=>{
   await assert.rejects(publish(before,proof,2027),/season|Stale/i);await assert.rejects(publish(before,proof,2026,1),/Stale/i);
   const bad=structuredClone(proof);bad.results[0].final_score=100;await assert.rejects(publish(before,bad),/recalculation/);
   bad.ratings=[];await assert.rejects(publish(before,bad),/rating missing/);
   assert.deepEqual(await state(),before);assert.equal(await valid(),false);
  });
  await t.test('stale source rejects publication',async()=>{
   await sql('begin');await sql('update picks set predicted_spread=3');await assert.rejects(publish(before,proof),/Stale regular/);await sql('rollback');
  });
  await t.test('nonregular and finalized contexts cannot bypass foundation guard',async()=>{
   for(const change of ["phase='playoffs'","regular_finalized_at=now()"]){await sql('begin');await sql('update settings set '+change);const s=await state();await assert.rejects(publish(s,{...proof,revision:s.settings.revision},2026,s.settings.revision),/closed/i);await sql('rollback');}
  });
  await t.test('late write failure rolls back games, ratings, scores AND attestation',async()=>{
   await sql("create function fail_final_test() returns trigger language plpgsql as $$begin raise exception 'late test failure';end$$; create trigger fail_final_test before insert on regular_final_publications for each row execute function fail_final_test();");
   await assert.rejects(publish(before,proof),/late test failure/);assert.deepEqual(await state(),before);assert.equal(await valid(),false);
   await sql('drop trigger fail_final_test on regular_final_publications;drop function fail_final_test()');
  });
  await t.test('persisted game/rating/result tampering by a trigger refuses certification',async()=>{
   for(const [table,column] of [['games','home_score'],['qb_ratings','passer_rating'],['weekly_scores','final_score']]){
    await sql(`create function corrupt_test() returns trigger language plpgsql as $$begin new.${column}:=42;return new;end$$;create trigger corrupt_test before insert or update on ${table} for each row execute function corrupt_test();`);
    await assert.rejects(publish(before,proof),/Persisted final/);assert.deepEqual(await state(),before);
    await sql(`drop trigger corrupt_test on ${table};drop function corrupt_test()`);
   }
  });
  await t.test('successful service publication corrects local scores and atomically records proof',async()=>{
   const r=await role('service_role',()=>publish(before,proof));assert.equal(r.p.already_published,false);assert.equal(await valid(),true);
   const after=await state();assert.deepEqual(after.settings,before.settings);assert.equal(after.games[0].home_score,21);assert.equal(after.qb_ratings.length,2);assert.equal(after.weekly_scores.length,2);
   const row=await one('select * from regular_final_publications');assert.deepEqual(row.source,after);assert.deepEqual(row.evidence,JSON.parse(JSON.stringify(proof)));assert.deepEqual(row.results,proof.results);
  });
  await t.test('identical retry, including fresh snapshot, is idempotent',async()=>{
   const row=await one('select published_at from regular_final_publications');assert.equal((await publish(before,proof)).p.already_published,true);
   assert.equal((await publish(await state(),proof)).p.already_published,true);assert.deepEqual(await one('select published_at from regular_final_publications'),row);
  });
  for(const change of ["update games set home_score=22","update qb_ratings set passer_rating=99","update picks set predicted_spread=3","update qb_picks set week=week+10","update weekly_scores set final_score=999","update qbs set team='Other'","update teams set espn_abbr='OTHER'","update settings set current_week=6", "insert into users(id) values('00000000-0000-0000-0000-000000000099')"])
   await t.test('stale attestation detected: '+change,async()=>{await sql('begin');await sql(change);assert.equal(await valid(),false);await sql('rollback');assert.equal(await valid(),true);});
  await t.test('ordinary regular updates remain possible; no phase/round/reminder mutations',async()=>{
   await role('service_role',()=>sql('update weekly_scores set final_score=final_score'));assert.equal(await valid(),true);
   assert.deepEqual((await state()).settings,before.settings);assert.equal((await one('select count(*)::int n from playoff_rounds')).n,0);assert.equal((await one('select count(*)::int n from push_notification_events')).n,0);
  });
 }finally{await db.close();}
});
