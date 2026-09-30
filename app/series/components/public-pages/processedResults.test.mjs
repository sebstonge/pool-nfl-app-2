import test from 'node:test';
import assert from 'node:assert/strict';
import {processedPlayoffResults} from './processedResults.mjs';
import {readFileSync} from 'node:fs';

test('no publication means no historical rows for any submission or raw result',()=>{
 for(const status of ['draft','open','locked','scored','finalized']){
  const raw={players:[{id:'u'}],rounds:[{id:1,status}],picks:[{user_id:'u'}],qbPicks:[{qb_id:'8c152b40-54b7-4e09-9a7c-000000000001',passer_rating:158.3}],paths:[{team:'BUF'}],games:[{game_status:'post',home_score:21,away_score:7}],live:{passer_rating:158.3}};
  const result=processedPlayoffResults(raw);
  assert.deepEqual(result.qbRows,[]);assert.deepEqual(result.progression.rows,[]);
  assert.deepEqual(result.progression.weeks,['wild_card','divisional','conference','super_bowl']);
 }
});

test('result pages use the processed-result boundary, not the selection grouping',()=>{
 const source=readFileSync(new URL('./PublicPages.js',import.meta.url),'utf8');
 const qb=source.slice(source.indexOf('function QBContent'),source.indexOf('export function QBView'));
 assert.match(qb,/processedPlayoffResults\(data\)\.qbRows/);
 assert.doesNotMatch(qb,/seriesQBGroups|qbPicks|fetchLiveGame|passer_rating/);
 assert.match(source,/progression=\{processedPlayoffResults\(data\)\.progression\}/);
});

test('processed QB history counts a shared QB once per round and retains zero',()=>{
 const rounds=[{id:1,round_key:'wild_card',round_order:1},{id:2,round_key:'divisional',round_order:2}];
 const qb={actual_espn_athlete_id:'10',actual_qb_name:'QB',team:'A',game_id:1,passer_rating:0};
 const results=[{round_id:1,user_id:'a',qb_result:qb},{round_id:1,user_id:'b',qb_result:qb},{round_id:2,user_id:'a',qb_result:{...qb,game_id:2,passer_rating:100}},{round_id:9,user_id:'x',qb_result:{...qb,passer_rating:158.3}}];
 const data={rounds,players:[{id:'a',display_name:'Alice'},{id:'b',display_name:'Bob'}],processed:{results,runs:[{round_id:1,processed_at:'first',standings:[{user_id:'a',cumulative_rank:1,cumulative_score:0}]},{round_id:2,processed_at:'second',standings:[{user_id:'a',cumulative_rank:2,cumulative_score:2}]}]}};
 const view=processedPlayoffResults(data);assert.equal(view.qbRows.length,1);assert.equal(view.qbRows[0].average,50);assert.equal(view.qbRows[0].worst.passer_rating,0);
 assert.equal(view.qbRows[0].worst.selected_by,'Alice, Bob');assert.deepEqual(view.progression.rows[0].points,[{week:'wild_card',rank:1},{week:'divisional',rank:2}]);
});

test('loader reads one consistent publication; unavailable migration is empty, permission errors are not hidden',async()=>{
 const {loadProcessedResults}=await import('./processedResults.mjs');
 const expected={results:[],runs:[]};
 assert.deepEqual(await loadProcessedResults({rpc:()=>assert.fail('no rounds')},[]),expected);
 for(const code of ['42883','PGRST202'])assert.deepEqual(await loadProcessedResults({rpc:async()=>({error:{code}})},[1]),expected);
 await assert.rejects(loadProcessedResults({rpc:async()=>({error:{code:'42501',message:'forbidden'}})},[1]),/forbidden/);
 assert.deepEqual(await loadProcessedResults({rpc:async(name,args)=>{assert.equal(name,'read_playoff_results');assert.deepEqual(args,{p_round_ids:[1,2]});return {data:expected};}},[1,2]),expected);
});
