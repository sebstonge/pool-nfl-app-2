import test from 'node:test';
import assert from 'node:assert/strict';
import {processedPlayoffResults} from './processedResults.mjs';
import {readFileSync} from 'node:fs';

test('no implemented processed store means no historical rows for any submission or raw result',()=>{
 for(const status of ['draft','open','locked','scored','finalized']){
  const raw={players:[{id:'u'}],rounds:[{id:1,status}],picks:[{user_id:'u'}],qbPicks:[{qb_id:1,passer_rating:158.3}],paths:[{team:'BUF'}],games:[{game_status:'post',home_score:21,away_score:7}],live:{passer_rating:158.3}};
  const result=processedPlayoffResults(raw);
  assert.deepEqual(result.qbRows,[]);assert.deepEqual(result.progression.rows,[]);
  assert.deepEqual(result.progression.weeks,['wild_card','divisional','conference','super_bowl']);
 }
});

test('result pages use the processed-result boundary, not the selection grouping',()=>{
 const source=readFileSync(new URL('./PublicPages.js',import.meta.url),'utf8');
 const qb=source.slice(source.indexOf('function QBContent'),source.indexOf('export function QBView'));
 assert.match(qb,/processedPlayoffResults\(\)\.qbRows/);
 assert.doesNotMatch(qb,/seriesQBGroups|qbPicks|fetchLiveGame|passer_rating/);
 assert.match(source,/progression=\{processedPlayoffResults\(\)\.progression\}/);
});
