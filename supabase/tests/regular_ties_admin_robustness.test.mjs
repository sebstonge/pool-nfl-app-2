import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {regularPickResult} from '../../lib/seasons/regularResults.mjs';
import {rankWeeklyScores} from '../../lib/seasons/rankings.mjs';

// Synthetic local PostgreSQL only. Never uses a Supabase/ESPN connection.
const admin='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000002';
const qa='00000000-0000-0000-0000-000000000011';
const qb='00000000-0000-0000-0000-000000000012';
const game=n=>`00000000-0000-0000-0000-${String(100+n).padStart(12,'0')}`;
const migration='20261025164727_regular_ties_admin_robustness.sql';
const priorMigrations=[
 '202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql',
 '202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql',
 '202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql',
 '202610070001_lifecycle_transition.sql','202610080001_playoff_atomic_advance.sql',
 '202610090001_lifecycle_completion.sql','202610190001_regular_qb_selection_snapshot.sql',
];

test('regular ties, ranking publication, claims and activation in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=s=>db.exec(s),query=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await query(s,p)).rows[0];
 const context=()=>one('select * from public.settings where id=1');
 const state=async(week=1)=>(await one('select public.regular_week_ranking_state(2026,$1) data',[week])).data;
 const stored=async()=>({settings:await context(),scores:(await query('select * from weekly_scores order by season,week,user_id')).rows,events:(await query('select * from push_notification_events order by event_key')).rows,clocks:(await query('select * from qb_selection_weeks order by season,week')).rows});
 const all=async()=>({...await stored(),versions:(await query('select * from regular_ranking_versions order by season,week')).rows});
 const results=(homeWins=true)=>[
  {user_id:admin,week:1,base_points:homeWins?3:1,multiplier:1,final_score:homeWins?3:1},
  {user_id:member,week:1,base_points:homeWins?1:3,multiplier:1.25,final_score:homeWins?1.25:3.75},
 ];
 const publish=async({week=1,expected,rows=results(),actor=admin,revision,scheduled=null}={})=>{
  expected??=await state(week);revision??=expected.settings.revision;
  return (await one('select public.publish_regular_week(2026,$1,$2,$3,$4,$5,$6) result',[week,revision,actor,JSON.stringify(expected),JSON.stringify(rows),scheduled])).result;
 };
 const pageScores=async()=> (await query('select * from public.weekly_scores where season=$1 order by week asc',[2026])).rows;
 const pageVector=rows=>rankWeeklyScores(rows,1).map(row=>({user_id:row.userId,final_score:row.score,rank:row.rank})).sort((a,b)=>a.user_id.localeCompare(b.user_id));
 const sqlVector=async()=>(await one('select public.regular_published_ranking(2026,1) ranking')).ranking;
 const positions=async()=>(await query('select user_id,ctid::text tuple_location from weekly_scores where season=2026 and week=1 order by user_id')).rows;
 const claim=async key=>(await one('select public.claim_regular_ranking($1) claimed',[key])).claimed;
 const advance=async(c,actor=admin)=>(await one('select public.advance_regular_week(2026,$1,$2,$3) result',[c.current_week,c.revision,actor])).result;
 const isolate=async fn=>{await sql('begin');try{await fn();}finally{await sql('rollback');}};
 const rejectSame=async(fn,pattern)=>{const before=await all();await assert.rejects(fn,pattern);assert.deepEqual(await all(),before);};
 const role=async(name,fn)=>{await sql(`set role ${name}`);try{return await fn();}finally{await sql('reset role');}};
 try{
  for(const file of ['lifecycle_fixture.sql','lifecycle_transition_fixture.sql'])await sql(await readFile(new URL(file,import.meta.url),'utf8'));
  await sql(`update settings set current_season=2026,current_week=1;
   insert into users(id,is_admin) values('${admin}',true),('${member}',false);
   insert into qbs(id,name,team,espn_athlete_id) values('${qa}','Home QB','Home','99'),('${qb}','Away QB','Away','100');
   insert into teams(name,espn_abbr) values('Home','HOM'),('Away','AWY');`);
  for(const file of priorMigrations){
   const source=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
   if(file==='202610090001_lifecycle_completion.sql'){
    await sql(source.slice(0,source.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP'))+'commit;');
    await sql('update settings set regular_writes_paused=true where id=1');
   }
   await sql(source);
   if(file==='202610090001_lifecycle_completion.sql')await sql('update settings set regular_writes_paused=false where id=1');
  }
  await sql(`insert into season_participants(season,user_id,confirmed,initial_order) values(2026,'${admin}',true,1),(2026,'${member}',true,2);
   insert into games(id,external_game_id,season,week,home_team,away_team,home_score,away_score,game_date,is_pool_eligible) values
    ('${game(1)}','1001',2026,1,'Home','Away',24,24,'2026-01-01',true),
    ('${game(2)}','1002',2026,1,'Home','Away',21,14,'2026-01-02',true),
    ('${game(3)}','1003',2026,1,'Home','Away',0,0,'2200-01-01',true),
    ('${game(4)}','1004',2026,2,'Home','Away',null,null,'2200-01-10',true);
   insert into qb_picks(season,user_id,qb_id,week) values(2026,'${admin}','${qa}',1),(2026,'${member}','${qb}',1);
   insert into qb_ratings(season,qb_id,week,passer_rating) values(2026,'${qa}',1,0),(2026,'${qb}',1,125);
   insert into picks(user_id,game_id,picked_team,predicted_spread) values
    ('${admin}','${game(1)}','Home',0),('${member}','${game(1)}','Away',7),
    ('${admin}','${game(2)}','Home',7),('${member}','${game(2)}','Away',7),
    ('${admin}','${game(3)}','Home',7),('${member}','${game(3)}','Away',7);
   insert into weekly_scores(season,user_id,week,base_points,multiplier,final_score) values
    (2026,'${admin}',1,3,1,3),(2026,'${member}',1,1,1.25,1.25);
   insert into push_notification_events(event_key,user_id,notification_type,week,season,status,scheduled_for) values
    ('legacy-ranking','${admin}','rankings_updated',1,2026,'pending',clock_timestamp()-interval '1 hour'),
    ('other-type','${admin}','qb_turn',1,2026,'pending',clock_timestamp()-interval '1 hour');`);
  const beforeInstall=await stored();
  await sql(await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8'));
  await t.test('installation preserves scores, lifecycle, clocks, queue; seeds baselines only',async()=>{
   const after=await stored();for(const e of after.events){delete e.ranking_payload;delete e.ranking_attempted_at;}
   assert.deepEqual(after,beforeInstall);
   assert.equal((await one('select version::int from regular_ranking_versions')).version,0);
   assert.equal((await one('select count(*)::int n from games where result_status is not null')).n,0);
  });
  await t.test('tie/base-point SQL matrix preserves winning spreads, losing sides and legacy zero',async()=>{
   for(const [home,away,pick,spread,final,points] of [
    [24,24,'Home',7,true,1],[24,24,'Away',7,true,1],[24,24,'Home',0,true,1],
    [0,0,'Away',9,false,0],[0,0,'Home',0,true,1],[21,14,'Home',7,true,2],
    [21,14,'Home',3,true,1],[21,14,'Away',7,true,0],[24,24,'Other',7,true,0],
    [null,0,'Home',7,true,0],[0,0,'Home',7,false,0],[-1,0,'Away',1,true,0],
   ]){
    const sqlPoints=(await one('select regular_pick_base_points($1,$2,$3,$4,$5,$6,$7) points',['Home','Away',home,away,pick,spread,final])).points;
    assert.equal(sqlPoints,points);
    assert.equal(sqlPoints,regularPickResult({home_team:'Home',away_team:'Away',home_score:home,away_score:away,result_status:final?'final':null},{picked_team:pick,predicted_spread:spread}).points??0);
   }
  });
  await t.test('SQL rounds the exact double as existing JavaScript toFixed for QB half cases',async()=>{
   for(const rate of [112.85,125.55,111.9,0,158.3]){
    const multiplier=rate>0?rate/100:1;
    for(const base of [1,3,7,13]){
     const row=await one('select regular_round_score(case when $1::float8>0 then $1::float8/100::float8 else 1::float8 end)::float8 m, regular_round_score($2::int*(case when $1::float8>0 then $1::float8/100::float8 else 1::float8 end))::float8 score',[rate,base]);
     assert.equal(row.m,Number(multiplier.toFixed(3)));assert.equal(row.score,Number((base*multiplier).toFixed(3)));
    }
   }
  });
  await t.test('legacy zero remains readable and untouched; new or changed zero/negative refused',async()=>{
   assert.equal((await one('select predicted_spread from picks where user_id=$1 and game_id=$2',[admin,game(1)])).predicted_spread,0);
   await query('update picks set predicted_spread=predicted_spread where user_id=$1 and game_id=$2',[admin,game(1)]);
   await assert.rejects(query('update picks set picked_team=$1 where user_id=$2 and game_id=$3',['Away',admin,game(1)]),/écart positif/);
   await assert.rejects(query('update picks set game_id=$1 where user_id=$2 and game_id=$3',[game(4),admin,game(1)]),/écart positif/);
   for(const spread of [0,-1])await assert.rejects(query('insert into picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,$3,$4)',[admin,game(4),'Home',spread]),/écart positif/);
   await assert.rejects(query('update picks set predicted_spread=0 where user_id=$1 and game_id=$2',[admin,game(2)]),/écart positif/);
  });
  await sql("update games set result_status='final' where external_game_id in('1001','1002')");
  await t.test('state snapshot is season/week scoped and SQL validates every result',async()=>{
   const s=await state();assert.equal(s.games.length,3);assert.equal(s.picks.length,6);assert.equal(s.participants.length,2);
   const other=await state(2);assert.equal(other.games.length,1);assert.deepEqual(other.picks,[]);
   await rejectSame(()=>publish({rows:results().map(r=>({...r,final_score:r.final_score+1}))}),/recalculation/);
   const stale=await state();await sql('update picks set predicted_spread=8 where game_id=\''+game(3)+'\'');
   await rejectSame(()=>publish({expected:stale}),/Stale weekly/);
  });
  await t.test('first baseline and identical publication cause no event; raw score changes keep version',async()=>{
   const before=(await all()).events.length;
   assert.deepEqual(await publish(),{updated:2,version:0,changed:false,baseline:false});
   assert.equal((await all()).events.length,before);
   await sql("update games set home_score=28,away_score=21 where external_game_id='1002'");
   assert.equal((await publish()).changed,false);assert.equal((await all()).events.length,before);
  });
  await t.test('saved unconfirmed-player scores preserve page ranks without queued notifications',()=>isolate(async()=>{
   const excluded='00000000-0000-0000-0000-000000000003';
   // Model a legacy score from before confirmation was withdrawn. The new
   // publication preserves its row and the page's saved-score ranking, while
   // notification delivery remains restricted to confirmed participants.
   await query('insert into users(id,is_admin) values($1,false)',[excluded]);
   await query('insert into season_participants(season,user_id,confirmed,initial_order) values(2026,$1,true,3)',[excluded]);
   await query('insert into weekly_scores(season,user_id,week,base_points,multiplier,final_score) values(2026,$1,1,99,1,99)',[excluded]);
   await query('update season_participants set confirmed=false where season=2026 and user_id=$1',[excluded]);
   const beforeScore=await one('select * from weekly_scores where season=2026 and user_id=$1',[excluded]);
   const beforeEvents=(await all()).events.length;
   const vector=await sqlVector();
   assert.deepEqual(vector,pageVector(await pageScores()));
   assert.deepEqual(vector.map(row=>row.user_id),[admin,member,excluded]);
   assert.deepEqual(vector.map(row=>row.rank),[2,3,1]);
   // Model the baseline captured while this legacy saved row was present.
   await sql('update regular_ranking_versions set fingerprint=md5(public.regular_published_ranking(2026,1)::text),version=0 where season=2026 and week=1');
   assert.deepEqual(await publish(),{updated:2,version:0,changed:false,baseline:false});
   assert.equal((await all()).events.length,beforeEvents);
   assert.equal((await one('select count(*)::int n from push_notification_events where user_id=$1',[excluded])).n,0);
   assert.deepEqual(await one('select * from weekly_scores where season=2026 and user_id=$1',[excluded]),beforeScore);
   // Runtime and installation baselines preserve the same exact page vector.
   await sql('delete from regular_ranking_versions');
   assert.deepEqual(await publish(),{updated:2,version:0,changed:false,baseline:true});
   await sql("update games set home_score=21,away_score=28 where external_game_id='1002'");
   assert.equal((await publish({rows:results(false)})).changed,true);
   assert.equal((await all()).events.length,beforeEvents+2);
   assert.equal((await one('select count(*)::int n from push_notification_events where user_id=$1',[excluded])).n,0);
   assert.deepEqual(await one('select * from weekly_scores where season=2026 and user_id=$1',[excluded]),beforeScore);
  }));
  await t.test('SQL tie ranks match the page helper and observed whole-season source order',async()=>{
   let observedReverseUuid=false;
   for(const score of [0,4.125])for(const insertion of [[member,admin],[admin,member]])await isolate(async()=>{
    await sql('delete from weekly_scores where season=2026');
    await sql('update season_participants set initial_order=null where season=2026');
    // Initial order, base points and QB rating deliberately disagree with the
    // tied source; none is a tie-break in the existing ranking page helper.
    await query('update season_participants set initial_order=1 where season=2026 and user_id=$1',[insertion[1]]);
    await query('update season_participants set initial_order=2 where season=2026 and user_id=$1',[insertion[0]]);
    await sql("update qb_ratings set passer_rating=case when qb_id='"+qa+"' then 158.3 else 0 end where season=2026 and week=1");
    for(const [index,user] of insertion.entries())await query('insert into weekly_scores(season,user_id,week,base_points,multiplier,final_score) values(2026,$1,1,$2,$3,$4)',[user,index?99:1,index?1.583:1,score]);
    // Include a later week in the same read, exactly as the page's season query.
    await query('insert into weekly_scores(season,user_id,week,base_points,multiplier,final_score) values(2026,$1,2,10,1,10)',[admin]);
    const source=await pageScores(),weekRows=source.filter(row=>Number(row.week)===1);
    if(weekRows[0].user_id===member)observedReverseUuid=true;
    assert.deepEqual(await sqlVector(),pageVector(source));
    assert.deepEqual(rankWeeklyScores(source,1).map(row=>row.userId),weekRows.map(row=>row.user_id));
    assert.deepEqual(rankWeeklyScores(source,1).map(row=>row.rank),[1,2]);
   });
   assert.equal(observedReverseUuid,true,'fixture exercises tied source order opposite UUID order');
  });
  await t.test('tied publication keeps its baseline and unchanged tuples, then freezes page ranks once',()=>isolate(async()=>{
   await sql("update qb_ratings set passer_rating=case when qb_id='"+qa+"' then 50 else 150 end where season=2026 and week=1");
   await sql('delete from weekly_scores where season=2026 and week=1');
   const tied=[{user_id:admin,week:1,base_points:3,multiplier:0.5,final_score:1.5},{user_id:member,week:1,base_points:1,multiplier:1.5,final_score:1.5}];
   for(const row of [...tied].reverse())await query('insert into weekly_scores(season,user_id,week,base_points,multiplier,final_score) values(2026,$1,1,$2,$3,$4)',[row.user_id,row.base_points,row.multiplier,row.final_score]);
   const observed=await pageScores();assert.equal(observed[0].user_id,member);
   assert.deepEqual(await sqlVector(),pageVector(observed));
   await sql('update regular_ranking_versions set version=0,fingerprint=md5(public.regular_published_ranking(2026,1)::text) where season=2026 and week=1');
   const beforePositions=await positions(),beforeEvents=(await all()).events.length;
   assert.deepEqual(await publish({rows:tied}),{updated:2,version:0,changed:false,baseline:false});
   assert.deepEqual(await positions(),beforePositions,'identical publication must not physically update saved score rows');
   assert.equal((await all()).events.length,beforeEvents);
   await query('update qb_ratings set passer_rating=100 where season=2026 and week=1 and qb_id=$1',[qa]);
   const changedRows=tied.map(row=>row.user_id===admin?{...row,multiplier:1,final_score:3}:row);
   const expected=await state();assert.equal((await publish({expected,rows:changedRows})).version,1);
   const pageRanks=rankWeeklyScores(await pageScores(),1);
   const frozen=(await query("select user_id,ranking_payload from push_notification_events where ranking_payload->>'version'='1' order by user_id")).rows;
   assert.equal(frozen.length,2);
   for(const event of frozen){
    const page=pageRanks.find(row=>row.userId===event.user_id);
    assert.equal(event.ranking_payload.rank,page.rank);assert.equal(event.ranking_payload.score,page.score);
   }
   const afterPositions=await positions();
   assert.deepEqual(await publish({expected,rows:changedRows}),{updated:2,version:1,changed:false,baseline:false});
   assert.deepEqual(await positions(),afterPositions);assert.equal((await all()).events.length,beforeEvents+2);
   // Returning to an equal score must freeze the page's source-order ranks too,
   // not UUID order, shared ranks or any QB/base/cumulative tie-break.
   await query('update qb_ratings set passer_rating=50 where season=2026 and week=1 and qb_id=$1',[qa]);
   assert.equal((await publish({rows:tied})).version,2);
   const tiedPage=rankWeeklyScores(await pageScores(),1);
   assert.deepEqual(tiedPage.map(row=>row.userId),[member,admin]);
   const tiedEvents=(await query("select user_id,ranking_payload from push_notification_events where ranking_payload->>'version'='2' order by user_id")).rows;
   assert.equal(tiedEvents.length,2);
   for(const event of tiedEvents){
    const page=tiedPage.find(row=>row.userId===event.user_id);
    assert.equal(event.ranking_payload.rank,page.rank);assert.equal(event.ranking_payload.score,page.score);
   }
   assert.equal((await publish({rows:tied})).changed,false);
   assert.equal((await all()).events.length,beforeEvents+4);
  }));
  await t.test('concurrent publishers with one expected source reserve one version and event batch',()=>isolate(async()=>{
   await sql("update games set home_score=21,away_score=28 where external_game_id='1002'");
   const expected=await state(),rows=results(false),beforeEvents=(await all()).events.length;
   const published=await Promise.all([publish({expected,rows}),publish({expected,rows})]);
   assert.deepEqual(published.map(r=>r.version),[1,1]);
   assert.deepEqual(published.map(r=>r.changed).sort(),[false,true]);
   assert.equal((await all()).events.length,beforeEvents+2);
   assert.equal((await one('select version::int from regular_ranking_versions where season=2026 and week=1')).version,1);
   // A raw-score update that preserves points also leaves both same-source
   // publication calls on the already reserved version, with no extra events.
   await sql("update games set home_score=28,away_score=35 where external_game_id='1002'");
   const changedSource=await state();
   const repeated=await Promise.all([publish({expected:changedSource,rows}),publish({expected:changedSource,rows})]);
   assert.ok(repeated.every(r=>r.version===1&&r.changed===false));
   assert.equal((await all()).events.length,beforeEvents+2);
  }));
  await t.test('missing runtime baseline uses existing scores, not an empty ranking',()=>isolate(async()=>{
   await sql('delete from regular_ranking_versions');
   assert.deepEqual(await publish(),{updated:2,version:0,changed:false,baseline:true});
  }));
  await t.test('missing QB choice or corrupt rating cannot be published',async()=>{
   await isolate(async()=>{await query('delete from qb_picks where user_id=$1',[admin]);await assert.rejects(publish(),/QB choice or rating/);});
   await isolate(async()=>{await sql('update qb_ratings set passer_rating=160');await assert.rejects(publish(),/QB choice or rating/);});
  });
  await t.test('A-B-A publishes monotonically new versions with frozen per-user payloads',async()=>{
   await sql("update games set home_score=21,away_score=28 where external_game_id='1002'");
   assert.equal((await publish({rows:results(false)})).version,1);
   const frozen=(await query('select ranking_payload from push_notification_events where ranking_payload is not null order by event_key')).rows;
   assert.equal(frozen.length,2);assert.ok(frozen.every(e=>e.ranking_payload.version===1));
   await sql("update games set home_score=28,away_score=21 where external_game_id='1002'");
   assert.equal((await publish()).version,2);assert.equal((await publish()).changed,false);
   assert.deepEqual((await query('select ranking_payload from push_notification_events where ranking_payload->>\'version\'=\'1\' order by event_key')).rows,frozen);
   const event=(await one('select event_key from push_notification_events where ranking_payload is not null limit 1')).event_key;
   await assert.rejects(query("update push_notification_events set ranking_payload='{}' where event_key=$1",[event]),/immutable/);
  });
  await t.test('first fresh nonempty rank can queue, empty results never do',()=>isolate(async()=>{
   await sql('update settings set current_week=2 where id=1');
   assert.deepEqual(await publish({week:2,rows:[]}),{updated:0,version:0,changed:false,baseline:false});
   await query('insert into picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,\'Home\',7)',[admin,game(4)]);
   await query('insert into qb_picks(season,user_id,qb_id,week) values(2026,$1,$2,2)',[admin,qa]);
   await sql("update games set result_status='final',home_score=14,away_score=7 where external_game_id='1004'");
   const result=await publish({week:2,rows:[{user_id:admin,week:2,base_points:2,multiplier:1,final_score:2}]});
   assert.equal(result.version,1);assert.equal(result.changed,true);assert.equal(result.baseline,true);
  }));
  await t.test('stale revision, nonadmin, closed season and maintenance reject publication unchanged',async()=>{
   await rejectSame(async()=>publish({revision:(await context()).revision+1}),/Stale/);
   await rejectSame(()=>publish({actor:member}),/Administrator/);
   for(const change of ["phase='playoffs'","regular_finalized_at=clock_timestamp()","regular_writes_paused=true"]){
    await isolate(async()=>{await sql('update settings set '+change+' where id=1');await assert.rejects(publish(),/Stale|paused/);});
   }
  });
  await t.test('claims are atomic, due, once only, including legacy NULL payload',async()=>{
   assert.equal(await claim('other-type'),false);assert.equal(await claim('missing'),false);
   assert.equal(await claim('legacy-ranking'),true);assert.equal(await claim('legacy-ranking'),false);
   await assert.rejects(sql("update push_notification_events set ranking_attempted_at=null where event_key='legacy-ranking'"),/cannot be reset/);
   const event=(await one('select event_key from push_notification_events where ranking_payload is not null order by event_key limit 1')).event_key;
   const attempts=await Promise.all([claim(event),claim(event)]);assert.deepEqual(attempts,[true,false]);
   const due=(await one('select event_key from push_notification_events where ranking_payload is not null and ranking_attempted_at is null order by event_key limit 1')).event_key;
   await query("update push_notification_events set scheduled_for=clock_timestamp()+interval '1 hour' where event_key=$1",[due]);
   assert.equal(await claim(due),false);
   await query("update push_notification_events set scheduled_for=clock_timestamp()-interval '1 hour' where event_key=$1",[due]);
   for(const change of ["phase='playoffs'","regular_finalized_at=clock_timestamp()","regular_writes_paused=true"]){
    await isolate(async()=>{await sql('update settings set '+change+' where id=1');assert.equal(await claim(due),false);});
   }
  });
  await t.test('new RPCs and ranking baselines are closed to ordinary roles',async()=>{
   for(const name of ['anon','authenticated'])await role(name,async()=>{
    await assert.rejects(query('select regular_week_ranking_state(2026,1)'),/permission denied/);
    await assert.rejects(query('select claim_regular_ranking(\'legacy-ranking\')'),/permission denied/);
    await assert.rejects(query('select advance_regular_week(2026,1,0,$1)',[admin]),/permission denied/);
    await assert.rejects(query('select publish_regular_week(2026,1,0,$1,\'{}\',\'[]\',null)',[admin]),/permission denied/);
    await assert.rejects(sql('select * from regular_ranking_versions'),/permission denied/);
   });
   await role('service_role',async()=>{await sql('select * from regular_ranking_versions');await assert.rejects(sql('delete from regular_ranking_versions'),/permission denied/);});
  });
  await t.test('next-week clock and activation roll back if settings write fails',async()=>{
   const c=await context();
   await sql("create function reject_regular_advance_test() returns trigger language plpgsql as $$ begin if new.current_week<>old.current_week then raise exception 'injected activation failure';end if;return new;end $$;create trigger reject_regular_advance_test before update on settings for each row execute function reject_regular_advance_test()");
   try{await rejectSame(()=>advance(c),/injected activation/);}finally{await sql('drop trigger reject_regular_advance_test on settings;drop function reject_regular_advance_test()');}
  });
  await t.test('advance validates actor, maintenance, target calendar and kickoff',async()=>{
   const c=await context();await rejectSame(()=>advance(c,member),/Administrator/);
   for(const change of ["phase='playoffs'","regular_finalized_at=clock_timestamp()","regular_writes_paused=true"]){
    await isolate(async()=>{await sql('update settings set '+change+' where id=1');await assert.rejects(advance(await context()),/Stale|paused/);});
   }
   await isolate(async()=>{await sql("update games set game_date='2000-01-01' where week=2");await assert.rejects(advance(c),/unstarted/);});
   await isolate(async()=>{await sql('delete from games where week=2');await assert.rejects(advance(c),/unstarted/);});
  });
  await t.test('an existing target selection clock is preserved',()=>isolate(async()=>{
   const c=await context();await sql("insert into qb_selection_weeks(season,week,started_at) values(2026,2,'2200-01-01')");
   await assert.rejects(advance(c),/duplicate key/);
  }));
  await t.test('concurrent fixed-source advances activate once; stale retry cannot advance again',async()=>{
   const c=await context();
   const attempts=await Promise.allSettled([advance(c),advance(c)]);
   const successes=attempts.filter(result=>result.status==='fulfilled');
   const rejected=attempts.filter(result=>result.status==='rejected');
   assert.equal(successes.length,1);assert.equal(rejected.length,1);assert.match(rejected[0].reason.message,/Stale/);
   const r=successes[0].value;assert.equal(r.week,c.current_week+1);assert.equal(r.revision,c.revision+1);assert.ok(r.started_at);
   const after=await context();assert.equal(after.current_week,c.current_week+1);assert.equal(after.revision,c.revision+1);
   assert.equal((await one('select count(*)::int n from qb_selection_weeks')).n,1);
   await rejectSame(()=>advance(c),/Stale/);
  });
  await t.test('latest final publisher retains snapshot guards and awards ties consistently',()=>isolate(async()=>{
   // Final publication requires the complete season. Remove only synthetic future
   // and pending fixtures inside this rolled-back test transaction.
   await sql('delete from picks where game_id=\''+game(3)+'\';delete from games where week=2 or external_game_id=\'1003\'');
   const expected=(await one('select regular_publication_state(2026) s')).s;
   const proof={version:1,season:2026,revision:expected.settings.revision,
    calendar:{season:2026,season_type:2,event_ids:['1001','1002'],weeks:[{week:1,event_ids:['1001','1002']}]},
    games:expected.games.map(g=>({...g,home_score:g.external_game_id==='1001'?24:28,away_score:g.external_game_id==='1001'?24:21,final_status:'STATUS_FINAL',state:'post',completed:true})),
    ratings:expected.qb_picks.map(q=>({qb_id:q.qb_id,week:1,game_id:game(1),team:q.selected_team,
     selected_qb_name:q.selected_qb_name,selected_espn_athlete_id:q.selected_espn_athlete_id,selected_team:q.selected_team,
     final_status:'STATUS_FINAL',state:'post',completed:true,
     passers:[{id:q.selected_espn_athlete_id,name:q.selected_qb_name,rating:q.user_id===admin?0:125}],
     actual_espn_athlete_id:q.selected_espn_athlete_id,actual_qb_name:q.selected_qb_name,passer_rating:q.user_id===admin?0:125})),results:results()};
   const bad=structuredClone(proof);bad.ratings[0].selected_qb_name='spoof';
   await sql('savepoint bad_snapshot');
   await assert.rejects(query('select publish_regular_final(2026,$1,$2,$3,$4)',[expected.settings.revision,admin,JSON.stringify(expected),JSON.stringify(bad)]),/snapshot mismatch/);
   await sql('rollback to savepoint bad_snapshot');
   await query('select publish_regular_final(2026,$1,$2,$3,$4)',[expected.settings.revision,admin,JSON.stringify(expected),JSON.stringify(proof)]);
   assert.equal((await one("select count(*)::int n from games where result_status='final'")).n,2);
   assert.equal((await one('select regular_final_publication_valid(2026,$1) valid',[expected.settings.revision])).valid,true);
  }));
 }finally{await db.close();}
});
