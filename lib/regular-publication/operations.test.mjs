import test from 'node:test';
import assert from 'node:assert/strict';
import {publishFinalRegular} from './operations.mjs';
import {fixture,user} from './fixtures.mjs';
test('orchestration prepares ESPN proof before the sole publishing RPC; stale context does no network or write',async()=>{
 const f=fixture(),calls=[];
 const client={from(){return {select(){return this;},eq(){return this;},single:async()=>({data:f.state.settings})};},async rpc(name,args){calls.push({name,args});return {data:name==='regular_publication_state'?f.state:{published:true}};}};
 const input={season:2026,revision:0,actor:user};
 assert.deepEqual(await publishFinalRegular(client,input,f.fetcher),{published:true});assert.deepEqual(calls.map(c=>c.name),['regular_publication_state','publish_regular_final']);
 assert.equal(calls[1].args.p_proof.results.length,2);assert.equal(calls[1].args.p_actor,user);
 const count=f.calls.length;calls.length=0;
 for(const bad of [{...input,season:2027},{...input,revision:1}])await assert.rejects(publishFinalRegular(client,bad,f.fetcher),/périmé/);
 assert.equal(f.calls.length,count);assert.equal(calls.length,0);
 f.summaries['101'].boxscore.players=[];await assert.rejects(publishFinalRegular(client,input,f.fetcher),/Boxscore/);assert.deepEqual(calls.map(c=>c.name),['regular_publication_state']);
});
