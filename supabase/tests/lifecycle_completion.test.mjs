import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {scoringFixture} from '../../lib/playoffs/scoringFixtures.mjs';
import {calculateRound} from '../../lib/playoffs/scoring.mjs';
const actor='00000000-0000-0000-0000-000000000011';
test('complete lifecycle and two regular week ones in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=s=>db.exec(s),one=async(s,p=[])=>(await db.query(s,p)).rows[0];
 const settings=()=>one('select * from settings');
 const state=async()=>(await one('select playoff_scoring_state(2026) data')).data;
 const action=async(name,season,payload={})=>one('select manage_season_lifecycle($1,$2,$3,$4,$5) result',[name,season,(await settings()).revision,actor,JSON.stringify(payload)]);
 try{
  for(const file of ['lifecycle_fixture.sql','lifecycle_transition_fixture.sql'])await sql(await readFile(new URL(file,import.meta.url),'utf8'));
  await sql(`update settings set current_season=2026;insert into users(id,is_admin) values('${actor}',true),('00000000-0000-0000-0000-000000000099',false)`);
  const f=scoringFixture(2026);for(const q of f.qbs)await db.query('insert into qbs(id,name,team,espn_athlete_id) values($1,$2,$3,$4)',[q.id,q.name,q.team,q.espn_athlete_id]);
  for(const s of f.seeds)await db.query('insert into teams(name,espn_abbr) values($1,$1)',[s.team]);
  await db.query('insert into qb_picks(user_id,qb_id,week) values($1,$2,1)',[actor,f.qbs[0].id]);
  await db.query('insert into qb_ratings(qb_id,week,passer_rating) values($1,1,100)',[f.qbs[0].id]);
  await db.query('insert into weekly_scores(user_id,week,final_score) values($1,1,10)',[actor]);
  await sql("insert into qb_selection_weeks values(1,now());insert into qb_weekly_stats(id,week,espn_athlete_id,qb_name,passer_rating) values(1,1,'500','QB',100)");
  await sql(`insert into games(external_game_id,season,week,home_team,away_team) values('2026001',2026,1,'AFC7','AFC2');insert into picks(user_id,game_id,picked_team,predicted_spread) select '${actor}',id,'AFC7',7 from games where season=2026`);
  await sql(`insert into push_notification_events(event_key,user_id,notification_type,week,status) values('qb-turn-week-1-user-${actor}','${actor}','qb_turn',1,'pending')`);
  for(const file of ['202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql','202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql','202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql','202610070001_lifecycle_transition.sql','202610080001_playoff_atomic_advance.sql','202610090001_lifecycle_completion.sql'])await sql(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await t.test('installation neutral, backfill only evidence participants',async()=>{assert.equal((await settings()).phase,'regular');assert.equal((await one('select count(*)::int n from season_participants')).n,1);assert.equal((await one('select season from qb_picks')).season,2026);});
  await t.test('ordinary roles cannot call lifecycle or modify participants',async()=>{for(const role of ['anon','authenticated']){await sql(`set role ${role}`);try{await assert.rejects(db.query("select manage_season_lifecycle('start',2027,0,$1,'{}')",[actor]),/permission denied/);await assert.rejects(sql('delete from season_participants'),/permission denied/);}finally{await sql('reset role');}}});
  await sql("update settings set phase='playoffs'");
  await db.query('select sync_playoff_seeds(2026,$1)',[JSON.stringify(f.seeds)]);await sql('select finalize_playoff_seeds(2026,(select captured_at from playoff_seeds limit 1))');
  for(let i=0;i<4;i++){
   const b=f.batches[i];await db.query("insert into playoff_rounds(id,season,round_key,round_name,round_order,status) values($1,2026,$2,$3,$4,'open')",[b.round.id,b.round.round_key,b.round.round_name,i+1]);
   for(const g of b.games){await db.query("insert into playoff_games(id,round_id,external_game_id,game_date,home_team,away_team,home_score,away_score,game_status) values($1,$2,$3,$4,$5,$6,$7,$8,'post')",[g.id,b.round.id,String(g.id),g.game_date,g.home_team,g.away_team,g.home_score,g.away_score]);const p=b.picks.find(p=>p.game_id===g.id&&p.user_id===actor);await db.query('insert into playoff_picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,$3,$4)',[actor,g.id,p.picked_team,p.predicted_spread]);}
   await db.query('insert into playoff_qb_picks(user_id,round_id,qb_id,super_bowl_total) values($1,$2,$3,$4)',[actor,b.round.id,f.qbs[i].id,i===3?55:null]);await db.query("insert into playoff_team_paths(user_id,round_id,team) values($1,$2,'AFC7')",[actor,b.round.id]);
   const s=await state(),r=s.rounds.find(r=>r.id===b.round.id),games=s.games.filter(g=>g.round_id===r.id);
   const pub=calculateRound({round:r,games,picks:s.picks.filter(p=>games.some(g=>g.id===p.game_id)),qbPicks:s.qbPicks.filter(p=>p.round_id===r.id),paths:s.paths.filter(p=>p.round_id===r.id),qbs:s.qbs,seeds:s.seeds,previousResults:s.results,qbResults:{[actor]:{selected_qb_id:f.qbs[i].id,passer_rating:100,consumed:true,dnp:false,actual_espn_athlete_id:f.qbs[i].espn_athlete_id,actual_qb_name:f.qbs[i].name}}});
   await db.query("select publish_playoff_scoring(2026,$1,'update',$2,'[]',$3)",[r.id,JSON.stringify(s),JSON.stringify(pub)]);
   if(i<3)await db.query("select publish_playoff_scoring(2026,$1,'finalize',$2,'[]',null)",[r.id,JSON.stringify(await state())]);
  }
  await t.test('failure after finalization rolls back the entire finish operation',async()=>{
   const before=await state(),context=await settings();
   await sql("create function reject_offseason_test() returns trigger language plpgsql as $$ begin if new.phase='offseason' then raise exception 'injected after finalization'; end if;return new;end $$;create trigger reject_offseason_test before update on settings for each row execute function reject_offseason_test()");
   try{await assert.rejects(action('finish',2026),/injected after finalization/);assert.deepEqual(await state(),before);assert.deepEqual(await settings(),context);assert.equal((await one('select ended_at from seasons where season=2026')).ended_at,null);}finally{await sql('drop trigger reject_offseason_test on settings;drop function reject_offseason_test()');}
  });
  await t.test('Super Bowl finalization and offseason together preserve results',async()=>{const before=await state();await action('finish',2026);assert.equal((await settings()).phase,'offseason');assert.equal((await state()).rounds[3].status,'finalized');assert.deepEqual((await state()).results,before.results);});
  const calendar={games:[{external_game_id:'2027001',week:1,game_date:'2200-01-01T20:00:00Z',home_team:'AFC7',away_team:'AFC2'}]};
  await t.test('prepared calendar preserves regular eligibility and cannot start without eligible week one',async()=>{
   await sql('begin');
   try{await action('prepare',2027,{games:[{...calendar.games[0],game_date:'2200-01-05T17:00:00Z'}]});assert.equal((await one('select is_pool_eligible from games where season=2027')).is_pool_eligible,false);await action('participants',2027,{participants:[{user_id:actor,initial_order:1}]});await assert.rejects(action('start',2027),/Unstarted calendar/);}finally{await sql('rollback');}
  });
  await t.test('prepare without participants, no activation; cannot start yet',async()=>{await action('prepare',2027,calendar);assert.equal((await settings()).current_season,2026);assert.equal((await settings()).phase,'offseason');assert.equal((await one('select count(*)::int n from season_participants where season=2027')).n,0);await assert.rejects(action('start',2027),/confirmed participants/);});
  await t.test('participants editable independently, invalid order rolls back',async()=>{await action('participants',2027,{participants:[{user_id:actor,initial_order:1}]});await assert.rejects(action('participants',2027,{participants:[{user_id:actor,initial_order:2}]}),/Invalid participant/);assert.equal((await one('select initial_order from season_participants where season=2027')).initial_order,1);});
  await t.test('failed start rolls back season, phase, revision and selection clock together',async()=>{
   const before=await settings();
   await sql("create function reject_start_test() returns trigger language plpgsql as $$ begin raise exception 'injected selection clock failure';end $$;create trigger reject_start_test before insert on qb_selection_weeks for each row execute function reject_start_test()");
   try{await assert.rejects(action('start',2027),/injected selection clock failure/);assert.deepEqual(await settings(),before);assert.equal((await one('select started_at from seasons where season=2027')).started_at,null);assert.equal((await one('select count(*)::int n from qb_selection_weeks where season=2027')).n,0);}finally{await sql('drop trigger reject_start_test on qb_selection_weeks;drop function reject_start_test()');}
  });
  await t.test('atomic start and two week ones without collisions',async()=>{
   await action('start',2027);const s=await settings();assert.equal(s.current_season,2027);assert.equal(s.current_week,1);assert.equal(s.phase,'regular');assert.equal(s.regular_finalized_at,null);assert.equal(s.playoff_reminders_enabled,false);
   await db.query('insert into qb_picks(season,user_id,qb_id,week) values(2027,$1,$2,1)',[actor,f.qbs[0].id]);await db.query('insert into qb_ratings(season,qb_id,week,passer_rating) values(2027,$1,1,99)',[f.qbs[0].id]);await db.query('insert into weekly_scores(season,user_id,week,final_score) values(2027,$1,1,20)',[actor]);await sql("insert into qb_weekly_stats(id,season,week,espn_athlete_id,qb_name,passer_rating) values(2,2027,1,'500','QB',99)");
   for(const table of ['qb_picks','qb_ratings','weekly_scores','qb_weekly_stats','qb_selection_weeks'])assert.equal((await one(`select count(distinct season)::int n from ${table} where week=1`)).n,2);
   assert.equal((await one('select final_score::float from weekly_scores where season=2026')).final_score,10);
  });
  await t.test('historical writes and nonparticipants denied; publication scoped',async()=>{
   for(const table of ['qb_picks','qb_ratings','weekly_scores','qb_weekly_stats','qb_selection_weeks'])await assert.rejects(sql(`delete from ${table} where season=2026`),/historical/);
   await assert.rejects(db.query("insert into qb_picks(season,user_id,qb_id,week) values(2027,'00000000-0000-0000-0000-000000000099',$1,2)",[f.qbs[0].id]),/participant/);
   const current=(await one('select regular_publication_state(2027) s')).s;assert.equal(current.qb_picks.length,1);assert.equal(current.weekly_scores.length,1);assert.equal(current.users.length,1);
  });
  await t.test('authenticated member writes current choices; historical data remains protected',async()=>{
   await sql(`update users set is_admin=false where id='${actor}';select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated`);
   try{await sql(`insert into picks(user_id,game_id,picked_team,predicted_spread) select '${actor}',id,'AFC7',7 from games where season=2027`);await assert.rejects(sql("update picks set predicted_spread=3 where game_id in(select id from games where season=2026)"),/historical/);}finally{await sql(`reset role;update users set is_admin=true where id='${actor}'`);}
  });
  await t.test('notification years coexist and stale/nonparticipant reservations are refused',async()=>{
   const key='qb-turn-week-1-user-'+actor;
   assert.equal((await one('select season from push_notification_events where event_key=$1',[key])).season,2026);
   await db.query("insert into push_notification_events(event_key,user_id,notification_type,week,status,season) values($1,$2,'qb_turn',1,'pending',2027)",['season-2027-'+key,actor]);
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,2);
   await db.query("insert into push_notification_events(event_key,user_id,notification_type,week,status,season) values('stale',$1,'qb_turn',1,'pending',2026)",[actor]);
   await sql("insert into push_notification_events(event_key,user_id,notification_type,week,status,season) values('inactive','00000000-0000-0000-0000-000000000099','qb_turn',1,'pending',2027)");
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,2);assert.equal((await settings()).playoff_reminders_enabled,false);
  });
  await t.test('publication recalculates only 2027 despite historical 2026 picks and ratings',async()=>{
   const before=(await one('select regular_publication_state(2026) s')).s;
   const current=(await one('select regular_publication_state(2027) s')).s,g=current.games[0],q=f.qbs[0];
   const proof={version:1,season:2027,revision:current.settings.revision,calendar:{season:2027,season_type:2,event_ids:[g.external_game_id],weeks:[{week:1,event_ids:[g.external_game_id]}]},games:[{...g,home_score:21,away_score:14,final_status:'STATUS_FINAL',state:'post',completed:true}],ratings:[{qb_id:q.id,game_id:g.id,week:1,team:'AFC7',final_status:'STATUS_FINAL',state:'post',completed:true,passers:[{id:q.espn_athlete_id,name:q.name,rating:100}],passer_rating:100,actual_espn_athlete_id:q.espn_athlete_id,actual_qb_name:q.name}],results:[{user_id:actor,week:1,base_points:2,multiplier:1,final_score:2}]};
   await one('select publish_regular_final(2027,$1,$2,$3,$4)',[current.settings.revision,actor,JSON.stringify(current),JSON.stringify(proof)]);
   assert.deepEqual((await one('select regular_publication_state(2026) s')).s,before);
   assert.equal((await one('select regular_final_publication_valid(2027,$1) v',[current.settings.revision])).v,true);
   assert.equal((await one('select final_score::float from weekly_scores where season=2027')).final_score,2);
  });
 }finally{await db.close();}
});
