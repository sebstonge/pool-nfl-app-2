import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEspnSeeds, validateSeedRows, seedSnapshot, wildCardSeeds } from './seeds.mjs';
import { syncPlayoffSeedsFromEspn, finalizePlayoffSeeds } from './seedOperations.mjs';
import { fetchEspnStandings, ESPN_STANDINGS_URL } from '../espnStandings.mjs';
import { collectiveRounds } from '../../app/series/components/playoff-tree/collectiveData.mjs';
import { projectProgression } from '../../app/series/components/playoff-tree/collectiveProgression.mjs';
const rows = ['AFC','NFC'].flatMap((conference,c)=>Array.from({length:7},(_,i)=>({season:2026,team:`${conference}${i+1}`,espn_team_id:String(c*16+i+1),conference,seed:i+1})));
const local = rows.map(row=>({name:row.team,espn_abbr:row.team}));
const espn = {season:{year:2026},children:['AFC','NFC'].map(conference=>({abbreviation:conference,children:[{standings:{entries:rows.filter(r=>r.conference===conference).map(r=>({team:{id:r.espn_team_id,abbreviation:r.team},stats:[{name:'playoffSeed',value:r.seed}]}))}}]}))};
const clone = value=>structuredClone(value);
const finalRows=rows.map(r=>({...r,captured_at:'2027-01-10T00:00:00Z',finalized_at:'2027-01-11T00:00:00Z'}));

test('existing standings endpoint reused, explicit season checked',async()=>{
 await fetchEspnStandings({season:2026,fetcher:async url=>{assert.equal(url,`${ESPN_STANDINGS_URL}&season=2026`);return {ok:true,json:async()=>espn};}});
 await assert.rejects(fetchEspnStandings({season:2025,fetcher:async()=>({ok:true,json:async()=>espn})}),/autre saison/);
});
test('conference is inherited and explicit playoffSeed determines order, not array index',()=>{
 const data=clone(espn);data.children[0].children[0].standings.entries.reverse();
 assert.deepEqual(extractEspnSeeds(data,2026,local).map(r=>r.seed).slice(0,7),[7,6,5,4,3,2,1]);
 data.children[0].children[0].standings.entries.push({team:{id:'99',abbreviation:'OUT'},stats:[{name:'playoffSeed',value:8}]});
 assert.equal(extractEspnSeeds(data,2026,local).length,14);
});
test('missing seed, unknown conference, unmapped/ambiguous team and incomplete field fail closed',()=>{
 const data=clone(espn);data.children[0].children[0].standings.entries[0].stats=[];
 assert.throws(()=>extractEspnSeeds(data,2026,local),/playoffSeed/);
 const noConf=clone(espn);delete noConf.children[0].abbreviation;
 assert.throws(()=>extractEspnSeeds(noConf,2026,local),/Conférence/);
 assert.throws(()=>extractEspnSeeds(espn,2026,local.slice(1)),/Correspondance/);
 assert.throws(()=>extractEspnSeeds(espn,2026,[...local,local[0]]),/Correspondance/);
 assert.throws(()=>validateSeedRows(rows.slice(1),2026),/14/);
});
test('duplicate slot, canonical team or ESPN identity are rejected',()=>{
 for(const field of ['seed','team','espn_team_id']) {
  const invalid=clone(rows);invalid[1][field]=invalid[0][field];assert.throws(()=>validateSeedRows(invalid,2026));
 }
 const invalid=clone(rows);invalid[7].conference='AFC';assert.throws(()=>validateSeedRows(invalid,2026));
});
test('draft/mixed snapshots never activate progression; finals preserve original seeds',()=>{
 assert.equal(seedSnapshot(rows,2026),undefined);
 assert.equal(seedSnapshot(finalRows.map((r,i)=>i? r:{...r,finalized_at:null}),2026),undefined);
 const snapshot=seedSnapshot(finalRows,2026);
 const wc=wildCardSeeds(snapshot);
 assert.deepEqual(wc.byes.map(r=>[r.team,r.qualifiedForDivisional]),[['AFC1',true],['NFC1',true]]);
 assert.deepEqual(wc.matchups.map(m=>[m.home.seed,m.away.seed]),[[2,7],[3,6],[4,5],[2,7],[3,6],[4,5]]);
 const games=[[2,7],[3,6],[4,5]].map(([h,a])=>({id:`${h}`,round_id:'wc',home_team:`AFC${h}`,away_team:`AFC${a}`}));
 const live={'2':{state:'post',homeScore:20,awayScore:7},'3':{state:'post',homeScore:7,awayScore:20},'4':{state:'post',homeScore:7,awayScore:20}};
 const result=projectProgression(collectiveRounds([{id:'wc',round_key:'wild_card'}],games),live,snapshot,2026);
 assert.deepEqual(result[1].games.filter(g=>g.conference==='AFC').map(g=>[g.home_seed,g.away_seed]),[[1,6],[2,5]]);
 assert.equal(snapshot.teams.find(r=>r.team==='AFC6').seed,6);
});
function mockClient(existing=[]) {
 const calls=[];
 return {calls,from(table){const q={select(){return q;},eq(){return q;},order(){return q;},then(resolve){return Promise.resolve({data:table==='teams'?local:existing}).then(resolve);}};return q;},async rpc(name,args){calls.push({name,args});return {data:'captured'};}};
}
test('draft can be synchronized repeatedly, final rejected before fetch or mutation',async()=>{
 const client=mockClient();let count=0;const fetcher=async()=>{count++;return {ok:true,json:async()=>espn};};
 await syncPlayoffSeedsFromEspn(client,2026,fetcher);await syncPlayoffSeedsFromEspn(client,2026,fetcher);
 assert.equal(client.calls.length,2);assert.equal(client.calls[0].args.p_rows.length,14);
 const frozen=mockClient(finalRows);await assert.rejects(syncPlayoffSeedsFromEspn(frozen,2026,fetcher),/finalisé/);
 assert.equal(count,2);assert.equal(frozen.calls.length,0);
});
test('incomplete ESPN leaves draft untouched; finalization needs explicit confirmation',async()=>{
 const client=mockClient(rows);const broken=clone(espn);broken.children.pop();
 await assert.rejects(syncPlayoffSeedsFromEspn(client,2026,async()=>({ok:true,json:async()=>broken})),/14/);
 assert.equal(client.calls.length,0);
 await assert.rejects(finalizePlayoffSeeds(client,2026,'2027-01-10',false),/Confirmation/);
 await finalizePlayoffSeeds(client,2026,'2027-01-10',true);
 assert.equal(client.calls[0].name,'finalize_playoff_seeds');
});
