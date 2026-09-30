import test from 'node:test';
import assert from 'node:assert/strict';
import {cumulativeComparison,competitionRanks,validateSuperBowlTotal} from './rankings.mjs';
import {calculateRound} from './scoring.mjs';
import {summaryQuarterbacks,resolveQB} from './qbResults.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const rank=rows=>competitionRanks(rows,cumulativeComparison,'rank');
const row=(user_id,score,error,total=null)=>({user_id,cumulative_score:score,cumulative_margin_error:error,super_bowl_total_error:total});
test('different score wins even with worse margin/total precision',()=>assert.equal(rank([row('a',10,99,99),row('b',9,0,0)])[0].user_id,'a'));
test('equal score: cumulative raw margin error breaks the tie',()=>assert.equal(rank([row('a',10,12),row('b',10,9)])[0].user_id,'b'));
test('equal score and margin: Super Bowl total error decides, exact first',()=>assert.deepEqual(rank([row('a',10,9,3),row('b',10,9,0)]).map(r=>r.user_id),['b','a']));
test('perfect ties have competition ranks, never UUID/name/time ranks',()=>{
 const rows=[row('z',11,2),row('b',10,3,0),row('a',10,3,0),row('x',9,0)];
 assert.deepEqual(rank(rows).map(r=>r.rank),[1,2,2,4]);
 assert.equal(cumulativeComparison(rows[1],rows[2]),0);
 assert.deepEqual(rank(rows.map(r=>({...r,user_id:r.user_id==='a'?'zzzz':r.user_id}))).map(r=>r.rank),[1,2,2,4]);
});
test('before SB equal cumulative precision remains a shared rank',()=>assert.deepEqual(rank([row('a',1,2),row('b',1,2)]).map(r=>r.rank),[1,1]));
test('SB total is forbidden before SB, required in SB and nonnegative integer',()=>{
 for(const key of ['wild_card','divisional','conference']){assert.equal(validateSuperBowlTotal(key,null),null);assert.throws(()=>validateSuperBowlTotal(key,55));}
 for(const value of [null,undefined,-1,1.2,'55',2147483648])assert.throws(()=>validateSuperBowlTotal('super_bowl',value));
 assert.equal(validateSuperBowlTotal('super_bowl',0),0);
 const page=readFileSync(new URL('../../app/series/matchs/page.js',import.meta.url),'utf8');
 assert.match(page,/activePlayoffRound\?\.round_key === "super_bowl" && \([\s\S]*?htmlFor="super-bowl-total"/);
});
function scoring(total=55,rating=100,previousPlayed=2){
 const game={id:1,round_id:4,game_status:'post',home_team:'A',away_team:'B',home_score:31,away_score:27};
 const previous={user_id:'u',round_order:3,path_alive:true,path_team:'A',path_games_played:previousPlayed,cumulative_score:5,cumulative_margin_error:7};
 return calculateRound({round:{id:4,round_order:4,round_key:'super_bowl',status:'locked'},games:[game],picks:[{id:1,game_id:1,user_id:'u',picked_team:'A',predicted_spread:7}],qbPicks:[{user_id:'u',qb_id:1,super_bowl_total:total}],paths:[{user_id:'u',team:'A'}],qbs:[{id:1,team:'A'}],seeds:[],previousResults:[previous],qbResults:{u:{selected_qb_id:1,passer_rating:rating,consumed:true}}}).results[0];
}
test('path and QB multipliers never multiply margin error',()=>{
 for(const path of [0,1,2,3])for(const qb of [0,80,100,120]){const r=scoring(55,qb,path);assert.equal(r.round_margin_error,3);assert.equal(r.cumulative_margin_error,10);assert.equal(r.pick_results[0].margin_error,3);}
});
test('total SB prediction affects only tie-break, never score/subtotal/QB/path',()=>{
 const a=scoring(58),b=scoring(55);assert.equal(a.super_bowl_total_error,0);assert.equal(b.super_bowl_total_error,3);
 for(const key of ['final_score','subtotal','qb_multiplier','path_multiplier','path_adjusted_points'])assert.equal(a[key],b[key]);
});
test('QB adapter and fallback match the actual regular Admin code across replacement cases',()=>{
 const regular=readFileSync(new URL('../../app/admin/page.js',import.meta.url),'utf8');
 const a=regular.indexOf('    const boxscoreTeams =',regular.indexOf('async function updateQBRatingsFromEspn'));
 const b=regular.indexOf('      /*\n       * Si le QB réel',a);
 assert.ok(a>0&&b>a);
 const reference=vm.runInNewContext(`(function(summary,selectedQB){const qbTeam=selectedQB.team.toLowerCase();const notFound=[];for(const once of [1]){${regular.slice(a,b)}return actualQB;}return null;})`);
 const selected={id:1,name:'Starter',team:'Bears',espn_athlete_id:'10'};
 const game={id:1,game_status:'post',home_team:'Bears',away_team:'Other',home_score:24,away_score:17};
 for(const passers of [[['10','Starter','100'],['20','Backup','120']],[['20','Backup','120']],[['10','Starter','--'],['20','Backup','120']],[['20','Backup','120'],['10','Starter','0']],[['10','Starter',''],['20','Backup','120']]]){
  const summary={boxscore:{players:[{team:{shortDisplayName:'Bears'},statistics:[{name:'passing',labels:['RTG'],athletes:passers.map(([id,name,rating])=>({athlete:{id,displayName:name},stats:[rating]}))}]}]}};
  for(const qb of [selected,{...selected,espn_athlete_id:null,name:'start'}]){
   const expected=reference(summary,qb),actual=resolveQB(qb,summaryQuarterbacks(summary,qb.team),game);
   assert.equal(actual.actual_espn_athlete_id,String(expected.id));assert.equal(actual.passer_rating,expected.rating);
   assert.equal(actual.consumed,expected.name==='Starter');assert.equal(actual.dnp,expected.name!=='Starter');
  }
 }
});
