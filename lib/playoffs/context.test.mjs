import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlayoffContext, assertPlayoffRounds} from './context.mjs';
import {loadCollectiveData} from '../../app/series/components/playoff-tree/collectiveData.mjs';

function clientWithSeasons() {
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(table){
    if(table==='settings')return {select(){return this;},eq(){return this;},single:async()=>({data:{id:1,current_season:2026,current_week:1,phase:'regular',revision:0,regular_finalized_at:null,playoff_reminders_enabled:false}})};
    const filters=[];
    const q={select(){return q;},order(){return q;},eq(key,value){filters.push([key,value]);return q;},in(){return q;},then(resolve){
      calls.push({table,filters});
      const rows=table==='playoff_rounds'?[2025,2026,2099].map(season=>({id:season,season,round_key:'wild_card'})):[];
      return Promise.resolve({data:rows.filter(row=>filters.every(([key,value])=>row[key]===value))}).then(resolve);
    }};return q;
  }};
  return {client,calls};
}
test('central season is explicitly NFL 2026, even with a future draft season',async()=>{
  const {client,calls}=clientWithSeasons();
  const result=await loadCollectiveData(client,(await getPlayoffContext(client)).season);
  assert.equal(result.season,2026);assert.deepEqual(result.rounds.map(r=>r.id),[2026]);
  assert.deepEqual(calls.find(c=>c.table==='playoff_rounds').filters,[['season',2026]]);
});
test('missing requested season stays empty instead of selecting MAX season',async()=>{
  const {client}=clientWithSeasons();const result=await loadCollectiveData(client,2027);
  assert.equal(result.season,2027);assert.deepEqual(result.rounds,[]);assert.deepEqual(result.games,[]);
});
test('missing/invalid season and mismatched rounds are rejected',async()=>{
  const {client}=clientWithSeasons();
  for(const value of [undefined,null,'2026',NaN])await assert.rejects(loadCollectiveData(client,value),/Saison/);
  assert.throws(()=>assertPlayoffRounds([{id:1,season:2027}],2026),/saison/);
});
