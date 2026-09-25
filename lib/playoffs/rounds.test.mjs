import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedMatchups, roundSummary, winner, ROUNDS } from './rounds.mjs';
import { discoverGames, gameUpdate } from './roundEspn.mjs';
import { manageRound } from './roundOperations.mjs';
import { fixtureSeeds,fixtureTeams,fixtureSchedule,response } from './roundFixtures.mjs';
const seeds=fixtureSeeds(),teams=fixtureTeams();
const wc=()=>expectedMatchups(seeds,2099,'wild_card',[],[]);
const finalGames=(pairs,id)=>pairs.map((p,i)=>({...p,id:id*10+i,round_id:id,external_game_id:String(id*100+i),game_date:'2100-01-01T00:00:00Z',game_status:'post',home_score:10,away_score:20}));
const rounds=ROUNDS.map((r,i)=>({id:i+1,season:2099,round_key:r.key,round_order:i+1,status:'draft'}));
test('Wild Card uses frozen seeds and six games, with no fake #1 game',()=>{
 assert.deepEqual(wc(),['AFC','NFC'].flatMap(c=>[[2,7],[3,6],[4,5]].map(([h,a])=>({home_team:c+h,away_team:c+a}))));
 assert.equal(wc().some(g=>Object.values(g).some(t=>t.endsWith('1'))),false);
 assert.throws(()=>expectedMatchups(seeds.map(s=>({...s,finalized_at:null})),2099,'wild_card',[],[]),/provisoires/);
});
test('complete chain reseeds by original seeds, independent of source order',()=>{
 const games=finalGames(wc(),1).reverse();
 const div=expectedMatchups([...seeds].reverse(),2099,'divisional',rounds,games);
 assert.deepEqual(div,['AFC','NFC'].flatMap(c=>[{home_team:c+'1',away_team:c+'7'},{home_team:c+'5',away_team:c+'6'}]));
 games.push(...finalGames(div,2));
 const conf=expectedMatchups(seeds,2099,'conference',rounds,games);
 assert.deepEqual(conf,['AFC','NFC'].map(c=>({home_team:c+'6',away_team:c+'7'})));
 games.push(...finalGames(conf,3));
 assert.deepEqual(expectedMatchups(seeds,2099,'super_bowl',rounds,games),[{home_team:'AFC7',away_team:'NFC7'}]);
});
test('incomplete, tied, non-final, wrong pairing and TEST results refuse progression',()=>{
 const games=finalGames(wc(),1);
 for(const list of [games.slice(1),games.map((g,i)=>i?g:{...g,game_status:'in'}),games.map((g,i)=>i?g:{...g,home_score:20}),games.map((g,i)=>i?g:{...g,external_game_id:'TEST-1'}),games.map((g,i)=>i?g:{...g,home_team:'AFC1'})])
  assert.throws(()=>expectedMatchups(seeds,2099,'divisional',rounds,list));
 assert.throws(()=>winner({...games[0],away_score:null}));
});
test('ESPN discovery is all-or-nothing, scoped to season/week and original hosting',async()=>{
 const data=fixtureSchedule(wc());const args={season:2099,key:'wild_card',expected:wc(),seeds,teams};
 assert.equal((await discoverGames({...args,fetcher:response(data)})).length,6);
 for(const modify of [d=>d.events.pop(),d=>d.events.push(d.events[0]),d=>{d.season.year=2098;},d=>{d.week.number=2;},d=>{d.events[0].competitions[0].timeValid=false;},d=>{d.events[0].competitions[0].competitors.reverse().forEach((t,i)=>t.homeAway=i?'away':'home');},d=>{d.events[0].date='2000-01-01';d.events[0].competitions[0].date='2000-01-01';}]){
  const broken=structuredClone(data);modify(broken);await assert.rejects(discoverGames({...args,fetcher:response(broken)}));
 }
});
test('Super Bowl takes ESPN orientation; Washington alias maps to canonical team',async()=>{
 const expected=[{home_team:'AFC1',away_team:'NFC1'}];
 const data=fixtureSchedule([{home_team:'NFC1',away_team:'AFC1'}],'super_bowl');
 const actual=await discoverGames({season:2099,key:'super_bowl',expected,seeds,teams,fetcher:response(data)});
 assert.equal(actual[0].home_team,'NFC1');
 const w=fixtureSchedule(wc()); w.events[0].competitions[0].competitors[0].team.abbreviation='WSH';
 const local=teams.map(t=>t.name==='AFC2'?{...t,espn_abbr:'WAS'}:t);
 assert.equal((await discoverGames({season:2099,key:'wild_card',expected:wc(),seeds,teams:local,fetcher:response(w)})).length,6);
});
test('summary validates identity/teams/final scores and never sends TEST IDs',async()=>{
 const game={...finalGames(wc(),1)[0],external_game_id:'900',game_status:'in'};
 const data=fixtureSchedule(wc());const header={id:'900',season:{year:2099,type:3},competitions:data.events[0].competitions};
 const c=header.competitions[0];c.status.type={state:'post',completed:true};c.competitors[0].score='21';c.competitors[1].score='17';
 const result=await gameUpdate(game,{season:2099,seeds,teams,fetcher:response({header})});assert.equal(result.game_status,'post');assert.equal(result.home_score,21);
 assert.equal(await gameUpdate({...game,external_game_id:'TEST-WC-1'},{fetcher:()=>assert.fail('TEST fetch')}),null);
 await assert.rejects(gameUpdate(game,{season:2099,seeds,teams,fetcher:response({header:{...header,id:'901'}})}));
 c.competitors[1].score=null;await assert.rejects(gameUpdate(game,{season:2099,seeds,teams,fetcher:response({header})}));
 c.status.type={state:'in',completed:false};await assert.rejects(gameUpdate({...game,game_status:'post'},{season:2099,seeds,teams,fetcher:response({header})}));
});
function clientFor({games=[],rs=rounds,seedRows=seeds,rpcError=null}={}){
 const writes=[];const tables={playoff_rounds:rs,playoff_games:games,playoff_seeds:seedRows,teams,playoff_picks:[]};
 return {writes,from(table){const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},range(){return q;},then(resolve){return Promise.resolve({data:tables[table],error:null}).then(resolve);}};return q;},async rpc(name,body){writes.push({name,body});return {error:rpcError};}};
}
test('preparation refuses provisional seeds, TEST conflicts and missing ESPN without writes',async()=>{
 for(const client of [clientFor({seedRows:seeds.map(s=>({...s,finalized_at:null}))}),clientFor({games:[{id:1,round_id:1,external_game_id:'TEST-1'}]}),clientFor()]){
  await assert.rejects(manageRound(client,{action:'prepare',season:2099,roundKey:'wild_card'},response({...fixtureSchedule(wc()),events:[]})));
  assert.equal(client.writes.length,0);
 }
});
test('already-open prepare is idempotent; transient update failures preserve values',async()=>{
 const rs=rounds.map((r,i)=>({...r,status:i?'draft':'open'}));const games=finalGames(wc(),1);
 const client=clientFor({rs,games});
 await manageRound(client,{action:'prepare',season:2099,roundKey:'wild_card'},()=>assert.fail('no ESPN'));
 assert.equal(client.writes.length,0);
 const result=await manageRound(client,{action:'update',season:2099,roundKey:'wild_card'},async()=>{throw new Error('offline');});
 assert.equal(result.warnings.length,6);assert.deepEqual(client.writes[0].body.p_games,[]);
 assert.deepEqual(result.data.games,games);
});
test('round summary gates transitions and has no next round after Super Bowl',()=>{
 const draft=roundSummary({season:2099,seeds:seeds.map(s=>({...s,finalized_at:null})),rounds,games:[]});assert.equal(draft.canPrepare,false);
 const sb=roundSummary({season:2099,seeds,rounds:rounds.map((r,i)=>({...r,status:i===3?'open':'finalized'})),games:[]});assert.equal(sb.canAdvance,false);
});
test('initialization is exclusive to empty draft Wild Card, never subsequent rounds',async()=>{
 const partial=roundSummary({season:2099,seeds,rounds,games:finalGames(wc(),1).slice(0,1)});
 assert.equal(partial.canPrepare,false);
 const next=rounds.map((r,i)=>({...r,status:i===0?'finalized':'draft'}));
 assert.equal(roundSummary({season:2099,seeds,rounds:next,games:finalGames(wc(),1)}).canPrepare,false);
 const client=clientFor({rs:next,games:finalGames(wc(),1)});
 await assert.rejects(manageRound(client,{action:'prepare',season:2099,roundKey:'divisional'},()=>assert.fail('No ESPN')),/Seul le Wild Card/);
 assert.equal(client.writes.length,0);
 const existing=clientFor({games:finalGames(wc(),1).slice(0,1)});
 await assert.rejects(manageRound(existing,{action:'prepare',season:2099,roundKey:'wild_card'},()=>assert.fail('No ESPN')),/déjà des matchs/);
 assert.equal(existing.writes.length,0);
});
