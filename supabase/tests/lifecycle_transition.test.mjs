import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {transitionFixture,actor,quarterback} from '../../lib/lifecycle-transition/fixtures.mjs';
import {prepareTransition} from '../../lib/lifecycle-transition/prepare.mjs';
test('lifecycle transition, real installed RPCs in isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite(),f=transitionFixture();
 const sql=s=>db.exec(s),one=async(s,args)=>(await db.query(s,args)).rows[0];
 const state=async()=>(await one('select lifecycle_transition_state(2099) s')).s;
 const as=async(role,fn)=>{await sql(`set role ${role}`);try{return await fn();}finally{await sql('reset role');}};
 const isolated=async(fn)=>{await sql('begin');try{await fn();}finally{await sql('rollback');}};
 const commit=(expected,prepared,{season=2099,revision=0,user=actor}={})=>one('select transition_to_playoffs($1,$2,$3,$4,$5) result',[season,revision,user,JSON.stringify(expected),JSON.stringify(prepared)]);
 try{
  await sql(await readFile(new URL('./lifecycle_fixture.sql',import.meta.url),'utf8'));
  await sql(await readFile(new URL('./lifecycle_transition_fixture.sql',import.meta.url),'utf8'));
  await db.query('insert into users(id,is_admin) values($1,true)',[actor]);
  await db.query("insert into qbs(id,name,team,espn_athlete_id) values($1,'Starter','AFC1','10')",[quarterback]);
  for(const team of f.state.regular.teams)await db.query('insert into teams(name,espn_abbr) values($1,$2)',[team.name,team.espn_abbr]);
  for(const g of f.games){
   await db.query('insert into games(id,external_game_id,season,week,home_team,away_team,home_score,away_score) values($1,$2,2099,1,$3,$4,21,14)',[g.id,g.external_game_id,g.home_team,g.away_team]);
   await db.query('insert into picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,$3,7)',[actor,g.id,g.home_team]);
  }
  await db.query('insert into qb_picks(user_id,qb_id,week) values($1,$2,1)',[actor,quarterback]);
  for(const file of ['202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql','202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql','202610040001_lifecycle_foundation.sql','202610050001_regular_final_publication.sql','202610070001_lifecycle_transition.sql'])await sql(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const empty=await state();
  await t.test('installation neutral and final publication absence absolutely refused',async()=>{
   assert.equal(empty.publication_valid,false);await assert.rejects(commit(empty,{}),/Publication finale régulière absente/);
   assert.equal((await state()).regular.settings.phase,'regular');assert.equal((await state()).seeds.length,0);
  });
  // Genuine 2A publication RPC in this ephemeral fixture only; synthetic games,
  // numeric final rating and independently verified regular SQL recalculation.
  const regular=(await one('select regular_publication_state(2099) s')).s;
  const proof={version:1,season:2099,revision:0,calendar:{version:1,season:2099,season_type:2,weeks:[{week:1,event_ids:f.games.map(g=>g.external_game_id)}],event_ids:f.games.map(g=>g.external_game_id)},games:f.games,
   ratings:[{qb_id:quarterback,week:1,game_id:f.games[0].id,team:'AFC1',state:'post',completed:true,final_status:'STATUS_FINAL',passers:[{id:'10',name:'Starter',rating:100}],passer_rating:100,actual_qb_name:'Starter',actual_espn_athlete_id:'10'}],
   results:[{user_id:actor,week:1,base_points:14,multiplier:1,final_score:14}]};
  await db.query('select publish_regular_final(2099,0,$1,$2,$3)',[actor,JSON.stringify(regular),JSON.stringify(proof)]);
  const before=await state(),prepared=await prepareTransition(before,{season:2099,revision:0,fetcher:f.fetcher});
  await t.test('ordinary roles denied both RPCs; service role cannot impersonate nonadmin actor',async()=>{
   for(const role of ['anon','authenticated'])await as(role,async()=>{await assert.rejects(state(),/permission denied/);await assert.rejects(commit(before,prepared),/permission denied/);});
   await as('service_role',()=>assert.rejects(commit(before,prepared,{user:quarterback}),/Administrateur/));
  });
  for(const [name,change,options,pattern] of [
   ['wrong season',null,{season:2098},/Mauvaise saison/],['stale revision',null,{revision:1},/Révision/],
   ['wrong phase',"update settings set phase='offseason'",{},/fermée/],
   ['finalized regular',"update settings set regular_finalized_at=now()",{},/fermée/],
   ['reminders enabled',"update settings set playoff_reminders_enabled=true",{revision:1},/rappels/],
   ['invalidated publication',"update picks set predicted_spread=3",{},/Publication finale/],
  ])await t.test('SQL rejects '+name,()=>isolated(async()=>{if(change)await sql(change);await assert.rejects(commit(await state(),prepared,options),pattern);}));
  for(const [name,mutate] of [
   ['13 seeds',p=>p.seeds.pop()],['duplicate seeds',p=>p.seeds[0].seed=2],['wrong conferences',p=>p.seeds[0].conference='NFC'],
   ['nonnumeric team ID',p=>p.seeds[0].espn_team_id='TEST-team'],['5 WC',p=>p.games.pop()],
   ['TEST event',p=>p.games[0].external_game_id='TEST-WC'],['BYE game',p=>p.games[0].home_team='AFC1'],
   ['wrong opponent',p=>p.games[0].away_team='NFC7'],['invented score',p=>p.games[0].home_score=0],
   ['started game',p=>p.games[0].game_date='2000-01-01'],['stale prep',p=>p.prepared_at='2000-01-01'],
   ['wrong publication identity',p=>p.publication_published_at='2000-01-01'],
  ])await t.test('SQL rejects prepared '+name,async()=>{const p=structuredClone(prepared);mutate(p);await assert.rejects(commit(before,p));assert.deepEqual(await state(),before);});
  for(const external of ['TEST-WC','900'])await t.test('preserve existing current-season game '+external,()=>isolated(async()=>{
   await sql("insert into playoff_rounds(season,round_key,round_name,round_order) values(2099,'wild_card','Wild Card',1)");
   await db.query("insert into playoff_games(round_id,external_game_id,game_date,home_team,away_team) select id,$1,'2100-01-10','AFC2','AFC7' from playoff_rounds where season=2099",[external]);
   await assert.rejects(commit(await state(),prepared),/Match existant à préserver/);
  }));
  await t.test('official event used in another season is rejected explicitly',()=>isolated(async()=>{
   await sql("insert into playoff_rounds(season,round_key,round_name,round_order) values(2098,'wild_card','Wild Card',1);insert into playoff_games(round_id,external_game_id,game_date,home_team,away_team) select id,'900','2100-01-10','AFC2','AFC7' from playoff_rounds where season=2098");
   await assert.rejects(commit(await state(),prepared),/Événement ESPN déjà utilisé/);
  }));
  await t.test('conflicting provisional seeds never overwritten',()=>isolated(async()=>{
   const seeds=structuredClone(f.seeds);seeds[0].espn_team_id='555';await db.query('select sync_playoff_seeds(2099,$1)',[JSON.stringify(seeds)]);
   await assert.rejects(commit(await state(),prepared),/Seeds existants différents/);
  }));
  await t.test('matching provisional seeds and four existing draft rounds reused',()=>isolated(async()=>{
   await db.query('select sync_playoff_seeds(2099,$1)',[JSON.stringify(f.seeds)]);
   await sql("insert into playoff_rounds(season,round_key,round_name,round_order) values(2099,'wild_card','Wild Card',1),(2099,'divisional','Divisional',2),(2099,'conference','Conférence',3),(2099,'super_bowl','Super Bowl',4)");
   const existing=await state();await commit(existing,prepared);const after=await state();assert.equal(after.rounds.length,4);assert.equal(after.rounds[0].id,existing.rounds[0].id);assert.equal(after.seeds[0].id,existing.seeds[0].id);assert.ok(after.seeds.every(s=>s.finalized_at));
  }));
  await t.test('late failure rolls back seeds, games, round and settings together',async()=>{
   await sql("create function fail_transition_test() returns trigger language plpgsql as $$begin if new.phase='playoffs' then raise exception 'late transition failure';end if;return new;end$$;create trigger fail_transition_test before update on settings for each row execute function fail_transition_test();");
   await assert.rejects(commit(before,prepared),/late transition failure/);assert.deepEqual(await state(),before);assert.equal((await one('select count(*)::int n from push_notification_events')).n,0);
   await sql('drop trigger fail_transition_test on settings;drop function fail_transition_test()');
  });
  await t.test('stale snapshot prevents silent replacement',()=>isolated(async()=>{
   await sql("insert into playoff_rounds(season,round_key,round_name,round_order) values(2099,'wild_card','Wild Card',1)");await assert.rejects(commit(before,prepared),/Snapshot modifié/);
  }));
  await t.test('two competing calls: one transition, second controlled already-playoffs error',async()=>{
   const calls=await as('service_role',()=>Promise.allSettled([commit(before,prepared),commit(before,prepared)]));
   assert.equal(calls.filter(c=>c.status==='fulfilled').length,1);assert.match(calls.find(c=>c.status==='rejected').reason.message,/Déjà en Séries/);
   const after=await state(),c=after.regular.settings;assert.equal(c.phase,'playoffs');assert.equal(c.revision,1);assert.ok(c.regular_finalized_at);assert.equal(c.current_week,1);assert.equal(c.current_season,2099);assert.equal(c.playoff_reminders_enabled,false);
   assert.equal(after.seeds.length,14);assert.ok(after.seeds.every(s=>s.finalized_at));assert.equal(new Set(after.seeds.map(s=>s.finalized_at)).size,1);
   assert.equal(after.games.length,6);assert.equal(after.rounds.find(r=>r.round_key==='wild_card').status,'open');assert.ok(after.games.every(g=>g.home_score===null&&g.away_score===null));
   assert.ok(!after.games.some(g=>[g.home_team,g.away_team].some(t=>['AFC1','NFC1'].includes(t))));
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,0);assert.equal(after.rounds[0].reminder_opened_at,null);
   assert.deepEqual(after.regular.games,before.regular.games);assert.deepEqual(after.regular.weekly_scores,before.regular.weekly_scores);assert.deepEqual(after.publication,before.publication);
   await assert.rejects(commit(before,prepared),/Déjà en Séries/);assert.deepEqual(await state(),after);
  });
  await t.test('existing regular guards still block old tabs, Admin writes and service_role after transition',async()=>{
   await sql(`select set_config('request.jwt.claim.sub','${actor}',false)`);
   for(const role of ['authenticated','service_role'])await as(role,async()=>{
    for(const table of ['games','picks','qb_picks','qb_ratings','weekly_scores','qb_weekly_stats'])await assert.rejects(sql(`update ${table} set id=id`),/Regular season is closed/);
    await assert.rejects(sql('update qb_selection_weeks set week=week'),/Regular season is closed/);
   });
   assert.equal((await one("select lifecycle_notification_allowed('playoff_open') allowed")).allowed,false);
   assert.equal((await one('select count(*)::int n from push_notification_events')).n,0);
  });
 }finally{await db.close();}
});
