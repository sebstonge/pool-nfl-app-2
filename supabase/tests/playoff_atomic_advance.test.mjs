import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {scoringFixture} from '../../lib/playoffs/scoringFixtures.mjs';
import {calculateRound} from '../../lib/playoffs/scoring.mjs';
import {expectedMatchups,ROUNDS} from '../../lib/playoffs/rounds.mjs';
const actor='00000000-0000-0000-0000-000000000011';
test('atomic advance with real scoring and notification guards, isolated PostgreSQL',{skip:!process.env.PGLITE_MODULE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const sql=s=>db.exec(s),one=async(s,p=[])=>(await db.query(s,p)).rows[0];
 const snapshot=async()=>({context:(await one("select jsonb_build_object('id',id,'current_season',current_season,'current_week',current_week,'phase',phase,'revision',revision,'regular_finalized_at',regular_finalized_at,'playoff_reminders_enabled',playoff_reminders_enabled) data from settings where id=1")).data,scoring:(await one('select playoff_scoring_state(2099) data')).data});
 const full=async()=>({state:await snapshot(),receipts:(await db.query('select * from playoff_round_advances')).rows,events:(await db.query('select * from push_notification_events')).rows});
 const advance=(key,s,g,user=actor)=>one('select advance_playoff_round_atomic(2099,$1,$2,$3,$4) result',[key,user,JSON.stringify(s),JSON.stringify(g)]);
 const isolate=async fn=>{await sql('begin');try{await fn();}finally{await sql('rollback');}};
 const rejectUnchanged=async(key,s,g,pattern)=>{const before=await full();await assert.rejects(advance(key,s,g),pattern);assert.deepEqual(await full(),before);};
 try{
  await sql(await readFile(new URL('./lifecycle_fixture.sql',import.meta.url),'utf8'));
  await sql(await readFile(new URL('./lifecycle_transition_fixture.sql',import.meta.url),'utf8'));
  for(const file of ['202609240001_playoff_seeds.sql','202609250001_playoff_round_admin.sql','202609290001_playoff_scoring.sql','202609300001_notification_reminders.sql','202610040001_lifecycle_foundation.sql','202610080001_playoff_atomic_advance.sql'])await sql(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await sql(`insert into users(id,is_admin) values('${actor}',true);update settings set phase='playoffs';`);
  const f=scoringFixture(2099);
  for(const q of f.qbs)await db.query('insert into qbs(id,name,team,espn_athlete_id) values($1,$2,$3,$4)',[q.id,q.name,q.team,q.espn_athlete_id]);
  for(const s of f.seeds)await db.query('insert into teams(name,espn_abbr) values($1,$1)',[s.team]);
  await db.query('select sync_playoff_seeds(2099,$1)',[JSON.stringify(f.seeds)]);
  await sql('select finalize_playoff_seeds(2099,(select captured_at from playoff_seeds limit 1))');
  for(const [i,r] of ROUNDS.entries())await db.query("insert into playoff_rounds(season,round_key,round_name,round_order,status) values(2099,$1,$2,$3,$4)",[r.key,r.name,i+1,i?'draft':'open']);
  const frozen=(await snapshot()).scoring.seeds;
  for(let i=0;i<3;i++){
   let s=await snapshot(),r=s.scoring.rounds[i];
   if(i===0)for(const [j,g] of f.batches[0].games.entries())await db.query("insert into playoff_games(round_id,external_game_id,game_date,home_team,away_team,game_status) values($1,$2,'2200-01-10',$3,$4,'pre')",[r.id,String(5000+j),g.home_team,g.away_team]);
   s=await snapshot();const games=s.scoring.games.filter(g=>g.round_id===r.id);
   for(const g of games){
    const fixture=f.batches[i].games.find(x=>x.home_team===g.home_team&&x.away_team===g.away_team);
    await db.query("update playoff_games set game_status='post',home_score=$1,away_score=$2 where id=$3",[fixture.home_score,fixture.away_score,g.id]);
    await db.query('insert into playoff_picks(user_id,game_id,picked_team,predicted_spread) values($1,$2,$3,7)',[actor,g.id,[g.home_team,g.away_team].includes('AFC7')?'AFC7':g.home_team]);
   }
   await db.query('insert into playoff_qb_picks(user_id,round_id,qb_id) values($1,$2,$3)',[actor,r.id,f.qbs[i].id]);
   await db.query("insert into playoff_team_paths(user_id,round_id,team) values($1,$2,'AFC7')",[actor,r.id]);
   s=await snapshot();const st=s.scoring;
   const publication=calculateRound({round:r,games:st.games.filter(g=>g.round_id===r.id),picks:st.picks.filter(p=>games.some(g=>g.id===p.game_id)),qbPicks:st.qbPicks.filter(p=>p.round_id===r.id),paths:st.paths.filter(p=>p.round_id===r.id),qbs:st.qbs,seeds:st.seeds,previousResults:st.results,qbResults:{[actor]:{selected_qb_id:f.qbs[i].id,passer_rating:100,consumed:true,dnp:false,actual_espn_athlete_id:f.qbs[i].espn_athlete_id,actual_qb_name:f.qbs[i].name}}});
   await db.query("select publish_playoff_scoring(2099,$1,'update',$2,'[]',$3)",[r.id,JSON.stringify(st),JSON.stringify(publication)]);
   s=await snapshot();let next=expectedMatchups(s.scoring.seeds,2099,ROUNDS[i+1].key,s.scoring.rounds,s.scoring.games).map((p,j)=>({...p,external_game_id:String(6000+i*10+j),game_date:'2200-01-20T18:00:00Z',game_status:'pre',home_score:null,away_score:null}));
   if(i===2)next=next.map(g=>({...g,home_team:g.away_team,away_team:g.home_team})); // ESPN SB orientation.
   if(i===0){
    await t.test('SQL independently rejects wrong survivors / reseeding',async()=>{const bad=structuredClone(next);bad[0].away_team='AFC2';await rejectUnchanged(r.round_key,s,bad,/reseeding/);});
    await t.test('wrong phase and unauthorized actor rejected',async()=>{
     await isolate(async()=>{await sql("update settings set phase='offseason'");await assert.rejects(advance(r.round_key,await snapshot(),next),/Active playoffs/);});
     await rejectUnchanged(r.round_key,s,next.map(g=>({...g,external_game_id:'TEST-x'})),/Invalid official|Duplicate/);
     await assert.rejects(advance(r.round_key,s,next,f.qbs[0].id),/Administrator/);
    });
    await t.test('stale snapshot and canonical publication rejected',async()=>{
     await isolate(async()=>{await sql('update playoff_picks set predicted_spread=8');await assert.rejects(advance(r.round_key,s,next),/Stale/);});
     await isolate(async()=>{await sql('update playoff_picks set predicted_spread=8');await assert.rejects(advance(r.round_key,await snapshot(),next),/current publication/);});
    });
    await t.test('TEST source refused without deletion',()=>isolate(async()=>{await sql("update playoff_games set external_game_id='TEST-'||id");await assert.rejects(advance(r.round_key,await snapshot(),next),/TEST/);}));
    await t.test('target already open refused',()=>isolate(async()=>{await sql("update playoff_rounds set status='open' where round_order=2");await assert.rejects(advance(r.round_key,await snapshot(),next),/chain/);}));
    await t.test('started target preserved',()=>isolate(async()=>{
     await sql("insert into playoff_games(round_id,external_game_id,game_date,home_team,away_team,game_status) select id,'9999','2000-01-01','AFC1','AFC7','pre' from playoff_rounds where round_order=2");
     await assert.rejects(advance(r.round_key,await snapshot(),next),/Incompatible target/);
    }));
    await t.test('transaction before kickoff, wall-clock wait past kickoff: no persistent advance',()=>isolate(async()=>{
     const before=await full();
     assert.equal(before.state.scoring.rounds[0].status,'scored');
     assert.equal(before.state.scoring.games.filter(g=>g.round_id===before.state.scoring.rounds[1].id).length,0);
     const {kickoff}=await one("select clock_timestamp()+interval '100 milliseconds' as kickoff");
     const prepared=next.map(g=>({...g,game_date:kickoff.toISOString()}));
     assert.equal((await one('select now() < $1::timestamptz as old_clock',[prepared[0].game_date])).old_clock,true);
     // Simulate time spent waiting in this already-open transaction, without
     // changing PostgreSQL's transaction timestamp or production clock.
     await new Promise(resolve=>setTimeout(resolve,250));
     const clocks=await one('select now() < $1::timestamptz as old_clock, clock_timestamp() >= $1::timestamptz as reached',[prepared[0].game_date]);
     assert.deepEqual(clocks,{old_clock:true,reached:true});
     await sql('savepoint expired_kickoff');
     await assert.rejects(advance(r.round_key,s,prepared),/Prepared kickoff reached/);
     await sql('rollback to savepoint expired_kickoff');
     assert.deepEqual(await full(),before); // includes rounds, games, receipts and notification queue
    }));
    await t.test('error AFTER finalization rolls back source, games, receipt and queue',async()=>{
     await sql("create function fail_next() returns trigger language plpgsql as $$begin if new.round_id<>(select id from public.playoff_rounds where round_order=1) then raise exception 'Injected after finalization'; end if; return new; end $$;create trigger fail_next before insert on playoff_games for each row execute function fail_next()");
     await rejectUnchanged(r.round_key,s,next,/Injected/);
     await sql('drop trigger fail_next on playoff_games;drop function fail_next()');
    });
    await t.test('ordinary roles cannot advance or write receipts',async()=>{
     for(const role of ['anon','authenticated']){await sql(`set role ${role}`);try{await assert.rejects(advance(r.round_key,s,next),/permission denied/);await assert.rejects(sql('delete from playoff_round_advances'),/permission denied/);}finally{await sql('reset role');}}
    });
   }
   await t.test(`${r.round_key} -> ${ROUNDS[i+1].key}, original seeds, false reminders and deterministic retry`,async()=>{
    await sql('set role service_role');let result;try{result=await advance(r.round_key,s,next);}finally{await sql('reset role');}
    const after=await full();assert.equal(after.state.scoring.rounds[i].status,'finalized');assert.equal(after.state.scoring.rounds[i+1].status,'open');
    assert.deepEqual(after.state.scoring.seeds,frozen);assert.equal(after.state.context.playoff_reminders_enabled,false);assert.deepEqual(after.events,[]);
    assert.ok(after.state.scoring.rounds.every(r=>r.reminder_opened_at===null));
    assert.equal(after.receipts.length,i+1);assert.deepEqual(await advance(r.round_key,s,next),result);assert.deepEqual(await full(),after);
    if(i===0)assert.ok(next.some(g=>g.home_team==='AFC1'&&g.away_team==='AFC7'));
   });
  }
  await t.test('Super Bowl has no next round',()=>rejectUnchanged('super_bowl',null,[],/Super Bowl/));
 }finally{await db.close();}
});
