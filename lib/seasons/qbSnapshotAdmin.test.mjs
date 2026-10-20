import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectionSnapshot} from './qbSnapshot.mjs';
const source=await readFile(new URL('../../app/admin/page.js',import.meta.url),'utf8');
const start=source.indexOf('  async function updateQBRatingsFromEspn(');
const end=source.indexOf('/* =========================================================\n   STATS HEBDOMADAIRES',start);
const updater=new Function('supabase','fetch','selectionSnapshot',source.slice(start,end)+';return updateQBRatingsFromEspn;');
const pick=(week,name='Jalen Hurts',id='1')=>({qb_id:'row',week,season:2026,selected_qb_name:name,selected_espn_athlete_id:id,selected_team:'Eagles',qbs:{id:'row',name:'Current different QB',espn_athlete_id:'99',team:'Other team'}});
async function run(choice,passers){
 const writes=[],requests=[];
 const client={from(table){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id:'existing-substitute'}}),upsert:async values=>{writes.push(values);return {};},then(resolve){resolve({data:table==='qb_picks'?[choice]:[{id:'game',home_team:'Philadelphia Eagles',away_team:'Dallas Cowboys',external_game_id:'123'}]});}};return q;}};
 const fetcher=async url=>{requests.push(url);return {ok:true,json:async()=>({header:{competitions:[{status:{type:{state:'post'}}}]},boxscore:{players:[{team:{shortDisplayName:'Eagles'},statistics:[{name:'passing',labels:['RTG'],athletes:passers.map(p=>({athlete:{id:p.id,displayName:p.name},stats:[String(p.rating)]}))}]}]}})};};
 const result=await updater(client,fetcher,selectionSnapshot)(choice.week);return {result,writes,requests};
}
for(const [week,name,id,passers,actual,value] of [
 [2,'Jalen Hurts','1',[{id:'1',name:'Jalen Hurts',rating:85.9}],'1',85.9],
 [6,'Jalen Hurts','1',[{id:'2',name:'Tanner McKee',rating:104.7}],'2',104.7],
 [7,'Tanner McKee','2',[{id:'2',name:'Tanner McKee',rating:99.1}],'2',99.1],
])test(`Admin week ${week} records official passer from snapshot after catalog was repurposed`,async()=>{
 const r=await run(pick(week,name,id),passers);assert.equal(r.result.updated,1);assert.equal(r.requests.length,1);assert.equal(r.writes[0].qb_id,'row');assert.equal(r.writes[0].week,week);assert.equal(r.writes[0].actual_espn_athlete_id,actual);assert.equal(r.writes[0].passer_rating,value);
});
test('Admin never rewrites legacy ratings by guessing the initial identity from qbs',async()=>{
 const choice={qb_id:'old',week:2,qbs:{name:'Current QB',team:'Eagles',espn_athlete_id:'9'}};
 const r=await run(choice,[]);assert.deepEqual(r.writes,[]);assert.deepEqual(r.requests,[]);assert.match(r.result.notFound[0],/identité historique à confirmer/);
});
