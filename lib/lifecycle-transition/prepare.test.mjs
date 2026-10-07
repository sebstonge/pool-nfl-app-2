import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareTransition,TransitionError} from './prepare.mjs';
import {transitionFixture} from './fixtures.mjs';
import {transitionToPlayoffs} from './operations.mjs';
const prepare=f=>prepareTransition(f.state,{season:2099,revision:0,fetcher:f.fetcher});
test('read-only preparation: final records, 14 seeds, six official WC, #1 byes, no scores',async()=>{
 const f=transitionFixture(),before=structuredClone(f.state),p=await prepare(f);assert.deepEqual(f.state,before);assert.equal(p.seeds.length,14);assert.equal(p.games.length,6);
 assert.ok(p.games.every(g=>g.home_score===null&&g.away_score===null&&/^\d+$/.test(g.external_game_id)));
 assert.ok(!p.games.some(g=>[g.home_team,g.away_team].some(t=>['AFC1','NFC1'].includes(t))));assert.equal(f.calls.length,2);
});
for(const [name,change] of [
 ['wrong phase',f=>f.state.regular.settings.phase='offseason'],['already playoffs',f=>f.state.regular.settings.phase='playoffs'],
 ['wrong season',f=>f.state.regular.settings.current_season=2026],['stale revision',f=>f.state.regular.settings.revision=1],
 ['missing final publication',f=>f.state.publication=null],['invalidated publication',f=>f.state.publication_valid=false],
 ['reminders on',f=>f.state.regular.settings.playoff_reminders_enabled=true],
 ['TEST conflict',f=>f.state.games.push({id:7,round_id:1,external_game_id:'TEST-WC'})],
 ['official conflict',f=>f.state.games.push({id:8,round_id:1,external_game_id:'123'})],
 ['existing QB pick',f=>f.state.qb_picks.push({id:1})],
 ])test(`refuse before ESPN: ${name}`,async()=>{const f=transitionFixture();change(f);await assert.rejects(prepare(f));assert.equal(f.calls.length,0);});
for(const [name,change] of [
 ['13 seeds',f=>f.standings.children[0].standings.entries.pop()],
 ['8/6 conferences',f=>f.standings.children[0].standings.entries.push(f.standings.children[1].standings.entries.pop())],
 ['duplicate seeds',f=>f.standings.children[0].standings.entries[0].stats[0].value=2],
 ['invalid seed',f=>f.standings.children[0].standings.entries[0].stats[0].value=0],
 ['invalid ESPN team id',f=>f.standings.children[0].standings.entries[0].team.id='TEST-team'],
 ['non-final record',f=>f.standings.children[0].standings.entries[0].stats[1].value=0],
 ['missing final record',f=>f.standings.children[0].standings.entries[0].stats.pop()],
 ['wrong ESPN season',f=>f.standings.season.year=2026],
 ['5 WC games',f=>f.schedule.events.pop()],
 ['7 WC games',f=>f.schedule.events.push(f.schedule.events[0])],
 ['TEST event',f=>f.schedule.events[0].id='TEST-WC'],
 ['started game',f=>f.schedule.events[0].competitions[0].status.type.state='in'],
 ['wrong conference matchup',f=>f.schedule.events[0].competitions[0].competitors[0].team={id:'12',abbreviation:'NFC2'}],
 ['duplicate event',f=>f.schedule.events[0].id=f.schedule.events[1].id],
 ['unconfirmed time',f=>f.schedule.events[0].competitions[0].timeValid=false],
 ])test(`refuse prepared source: ${name}`,async()=>{const f=transitionFixture();change(f);await assert.rejects(prepare(f));});
test('provisional matching seeds retained; changed seeds explicitly refused',async()=>{
 const f=transitionFixture();f.state.seeds=structuredClone(f.seeds);await prepare(f);f.state.seeds[0].espn_team_id='100';await assert.rejects(prepare(f),/Seeds existants différents/);
});
test('pipeline reads and prepares before single commit RPC; absent publication does no write/network',async()=>{
 const f=transitionFixture(),calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='lifecycle_transition_state'?f.state:{phase:'playoffs'}};}};
 assert.deepEqual(await transitionToPlayoffs(client,{season:2099,revision:0,actor:'admin'},f.fetcher),{phase:'playoffs'});
 assert.deepEqual(calls.map(c=>c.name),['lifecycle_transition_state','transition_to_playoffs']);assert.equal(calls[1].args.p_prepared.games.length,6);
 calls.length=0;f.calls.length=0;f.state.publication_valid=false;await assert.rejects(transitionToPlayoffs(client,{season:2099,revision:0,actor:'admin'},f.fetcher));assert.equal(calls.length,1);assert.equal(f.calls.length,0);
});
test('actual Admin route rejects anonymous/nonadmin and ignores supplied browser snapshot',async()=>{
 const src=(await readFile(new URL('../../app/api/admin/lifecycle-transition/route.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export const/g,'const').replace('export async function POST','async function POST');
 let admin=false,validUser=true,calls=[];
 const client={auth:{getUser:async()=>({data:{user:validUser?{id:'admin'}:null}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_admin:admin}})};}};
 const handler=new Function('createClient','transitionToPlayoffs','TransitionError',src+';return POST;')(()=>client,async(_,p)=>{calls.push(p);return {phase:'playoffs'};},TransitionError);
 const request=(token='Bearer test',body={confirm:true,season:2099,revision:0,snapshot:'forged',is_admin:true})=>({headers:{get:()=>token},json:async()=>body});
 assert.equal((await handler(request(null))).status,401);assert.equal((await handler(request())).status,403);assert.equal(calls.length,0);
 admin=true;validUser=false;assert.equal((await handler(request())).status,401);validUser=true;
 assert.equal((await handler(request('Bearer test',{confirm:false}))).status,400);
 assert.equal((await handler(request())).status,200);assert.deepEqual(calls,[{season:2099,revision:0,actor:'admin'}]);
});
