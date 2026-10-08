import test from 'node:test';
import assert from 'node:assert/strict';
import {regularClient,initialOrder,regularEventKey} from './regularClient.mjs';
import {regularOrder} from '../notifications/regularOrder.mjs';
function database(){
 const data={settings:[{id:1,current_season:2026,current_week:1,phase:'regular',regular_finalized_at:null,revision:0,playoff_reminders_enabled:false}],season_participants:[{season:2026,user_id:'a',confirmed:true,initial_order:1},{season:2027,user_id:'b',confirmed:true,initial_order:2},{season:2027,user_id:'a',confirmed:true,initial_order:1}],users:[{id:'a'},{id:'b'},{id:'c'}],games:[{id:'g26',season:2026},{id:'g27',season:2027}],picks:[{game_id:'g26'},{game_id:'g27'}],weekly_scores:[{season:2026,user_id:'a',week:1,final_score:999},{season:2027,user_id:'a',week:1,final_score:1},{season:2027,user_id:'b',week:1,final_score:2}]},writes=[];
 return {data,writes,from(table){let filters=[],single=false;const chain={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,vs){filters.push(r=>vs.includes(r[k]));return this;},single(){single=true;return this;},insert(rows,options){writes.push({table,rows,options});return this;},upsert(rows,options){return this.insert(rows,options);},then(resolve,reject){const rows=(data[table]||[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:single?rows[0]:rows}).then(resolve,reject);}};return chain;}};
}
test('active readers separate scores, picks, participants and initial order across two week ones',async()=>{
 const db=database(),a=regularClient(db,{season:2026}),b=regularClient(db,{season:2027});
 assert.equal((await a.from('weekly_scores').select('*').eq('week',1)).data[0].final_score,999);
 const scores=(await b.from('weekly_scores').select('*').eq('week',1)).data;assert.deepEqual(scores.map(s=>s.final_score),[1,2]);
 assert.deepEqual((await a.from('picks').select('*')).data,[{game_id:'g26'}]);assert.deepEqual((await b.from('picks').select('*')).data,[{game_id:'g27'}]);
 assert.deepEqual((await a.from('users').select('*')).data.map(u=>u.id),['a']);
 const players=(await b.from('users').select('*')).data;
 assert.deepEqual(initialOrder(players.reverse()).map(u=>u.id),['a','b']);assert.deepEqual(regularOrder(players,2,scores).map(u=>u.id),['a','b']);
 assert.equal((await b.from('users').select('is_admin').eq('id','c')).data.length,1,'admin/profile identity is independent of membership');
});
test('all five weekly upserts include the pinned season and conflict key',async()=>{
 const db=database(),c=regularClient(db);
 assert.equal(await c.regularSeason(),2026);db.data.settings[0].current_season=2027;
 for(const table of ['qb_picks','qb_ratings','weekly_scores','qb_weekly_stats','qb_selection_weeks'])await c.from(table).upsert({week:1},{onConflict:'week'});
 assert.ok(db.writes.every(w=>w.rows.season===2026&&w.options.onConflict==='season,week'));
 await assert.rejects(Promise.resolve(c.from('qb_picks').insert({season:2027,week:1})),/Saison incohérente/);
});
test('notification namespaces keep existing 2026 reservations and isolate 2027',async()=>{
 const key='qb-turn-week-1-user-a';assert.equal(regularEventKey(2026,key),key);assert.notEqual(regularEventKey(2027,key),key);
 const db=database();for(const season of [2026,2027])await regularClient(db,{season}).from('push_notification_events').insert({event_key:key});
 assert.deepEqual(db.writes.map(w=>w.rows.season),[2026,2027]);assert.equal(new Set(db.writes.map(w=>w.rows.event_key)).size,2);
 assert.throws(()=>regularEventKey(2027,'season-2026-'+key));
});
