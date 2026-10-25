import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmLegacyRegularResults} from './regularResultEvidence.mjs';
import {regularPickResult} from './regularResults.mjs';
import {fixture as publicationFixture} from '../regular-publication/fixtures.mjs';

function fixture(options){
  const f=publicationFixture(options);
  for(const game of f.state.games)Object.assign(game,{home_score:21,away_score:14,result_status:null});
  return f;
}
const confirm=(f,games=f.state.games)=>confirmLegacyRegularResults(games,f.state.teams,{season:2026,fetcher:f.fetcher});

test('legacy ordinary wins and ties regain confirmed outcomes only in memory',async()=>{
  const f=fixture();
  f.state.games[1].home_score=14;
  f.events[1].competitions[0].competitors[0].score='14';
  const before=structuredClone(f.state),games=await confirm(f);
  assert.ok(games.every(game=>game.result_status==='final'));
  assert.equal(regularPickResult(games[0],f.state.picks[0]).points,2);
  assert.equal(regularPickResult(games[1],{picked_team:games[1].away_team,predicted_spread:0}).points,1);
  assert.deepEqual(f.state,before);
  assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(url=>url.startsWith('https://site.api.espn.com/')&&url.includes('/scoreboard?dates=2026&seasontype=2&week=')&&url.endsWith('&limit=100')));
});

for(const [name,mutate] of [
  ['wrong local season',f=>{f.state.games[0].season=2025;}],
  ['wrong local week',f=>{f.state.games[0].week=3;}],
  ['wrong event id',f=>{f.events[0].id='999';}],
  ['wrong event season',f=>{f.events[0].season.year=2025;}],
  ['wrong event week',f=>{f.events[0].week.number=2;}],
  ['wrong local team',f=>{f.state.games[0].home_team='Other team';}],
  ['changed provider team',f=>{f.events[0].competitions[0].competitors[0].team.abbreviation='BUF';}],
  ['changed saved score',f=>{f.state.games[0].home_score=22;}],
  ['live equal score',f=>{
    f.state.games[0].home_score=14;f.events[0].competitions[0].competitors[0].score='14';
    for(const status of [f.events[0].status,f.events[0].competitions[0].status])Object.assign(status.type,{state:'in',completed:false,name:'STATUS_IN_PROGRESS'});
  }],
  ['cancelled event',f=>{f.events[0].competitions[0].status.type.name='STATUS_CANCELED';}],
])test(`keeps ${name} pending`,async()=>{
  const f=fixture();mutate(f);const before=structuredClone(f.state);
  const [game]=await confirm(f,[f.state.games[0]]);
  assert.equal(game.result_status,null);assert.deepEqual(f.state,before);
});

for(const [name,mutate] of [
  ['wrong scoreboard season',board=>{board.season.year=2025;}],
  ['wrong scoreboard week',board=>{board.week.number=2;}],
  ['wrong scoreboard season type',board=>{board.season.type=3;}],
  ['duplicate scoreboard event',board=>{board.events.push(structuredClone(board.events[0]));}],
  ['partial scoreboard',board=>{board.events=[];}],
])test(`fails closed for ${name}`,async()=>{
  const f=fixture(),original=f.fetcher;
  f.fetcher=async url=>{const response=await original(url),board=await response.json();mutate(board);return {ok:true,json:async()=>board};};
  assert.equal((await confirm(f,[f.state.games[0]]))[0].result_status,null);
});

test('unavailable ESPN preserves every saved score and choice',async()=>{
  const f=fixture(),before=structuredClone(f.state.games);
  for(const fetcher of [async()=>{throw Error('offline');},async()=>({ok:false,status:503})]){
    f.fetcher=fetcher;assert.deepEqual(await confirm(f),before);
  }
});

test('TEST ids, other seasons/types, missing scores and known finals never trigger provider requests',async()=>{
  const f=fixture(),base=f.state.games[0];
  const games=[{...base,external_game_id:'TEST-101'},{...base,external_game_id:'TEST-QB'},
    {...base,season:2025},{...base,season_type:'postseason'},
    {...base,home_score:null},{...base,away_score:''},{...base,result_status:'final'}];
  assert.deepEqual(await confirm(f,games),games);assert.deepEqual(f.calls,[]);
  assert.deepEqual(await confirmLegacyRegularResults([base],f.state.teams,{season:undefined,fetcher:f.fetcher}),[base]);
  assert.deepEqual(f.calls,[]);
});

test('groups only loaded candidate weeks and bounds provider concurrency at four',async()=>{
  const f=fixture({weeks:[1,2,3,4,5,6]}),original=f.fetcher;
  let active=0,maximum=0;
  f.fetcher=async url=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));const response=await original(url);active--;return response;};
  assert.ok((await confirm(f)).every(game=>game.result_status==='final'));
  assert.equal(f.calls.length,6);assert.equal(maximum,4);
});

test('local duplicate event identity is not accepted as two confirmed games',async()=>{
  const f=fixture(),base=f.state.games[0];
  const games=[base,{...base,id:'duplicate'}];
  assert.deepEqual(await confirm(f,games),games);assert.deepEqual(f.calls,[]);
});
