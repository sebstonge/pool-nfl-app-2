import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLifecycle,validateLifecycle,regularIsOpen,requireActiveSeason} from './context.mjs';
import {getPlayoffContext} from '../playoffs/context.mjs';
const row={id:1,current_season:2026,current_week:5,phase:'regular',revision:0,regular_finalized_at:null,playoff_reminders_enabled:false};
function client(data=row,error=null){return {from(name){assert.equal(name,'settings');return {select(){return this;},eq(k,v){assert.equal(k,'id');assert.equal(v,1);return this;},single:async()=>({data,error})};}};}
test('global context uses singleton settings, preview works during regular',async()=>{
 assert.deepEqual(await loadLifecycle(client()),row);
 assert.deepEqual(await getPlayoffContext(client()),{season:2026,phase:'regular'});
 assert.deepEqual(await getPlayoffContext(client({...row,current_season:2028})),{season:2028,phase:'regular'});
});
test('missing/invalid context fails closed, no fallback season',async()=>{
 for(const data of [null,{...row,phase:'oops'},{...row,current_season:'2026'},{...row,revision:NaN},{...row,regular_finalized_at:undefined},{...row,id:2}])await assert.rejects(loadLifecycle(client(data)));
 await assert.rejects(loadLifecycle(client(null,{message:'missing column'})),/indisponible/);
});
test('server authority rejects browser season, supports all defined phases',async()=>{
 await assert.rejects(requireActiveSeason(client(),2099),/saison/);
 assert.equal(await requireActiveSeason(client(),2026),2026);
 for(const phase of ['regular','playoffs','offseason']) assert.equal(validateLifecycle({...row,phase}).phase,phase);
 assert.equal(regularIsOpen(row),true);
 assert.equal(regularIsOpen({...row,regular_writes_paused:true}),false);
 assert.equal(regularIsOpen({...row,regular_writes_paused:false}),true);
 assert.equal(regularIsOpen({...row,phase:'playoffs'}),false);
 assert.equal(regularIsOpen({...row,regular_finalized_at:'2026-10-04T00:00:00Z'}),false);
});
