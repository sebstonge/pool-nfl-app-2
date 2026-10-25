import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as results from '../../lib/seasons/regularResults.mjs';
import * as snapshots from '../../lib/seasons/qbSnapshot.mjs';
import {fixture as publicationFixture} from '../../lib/regular-publication/fixtures.mjs';

const require=createRequire(import.meta.url);
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const swc=require('next/dist/build/swc');
const game=(id,home,away,extra={})=>({id,week:1,home_team:'Home',away_team:'Away',home_score:home,away_score:away,result_status:'final',...extra});
const pick=(id,g,team='Home',spread=3,user='u')=>({id,user_id:user,games:g,picked_team:team,predicted_spread:spread});

async function loadStats(picks,{teams=[],season=2026,fetcher}={}){
  const source=await readFile(new URL('./RegularPage.js',import.meta.url),'utf8');
  const {code}=await swc.transform(source,{filename:'analytics.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
  const states=[],effects=[],requests=[];
  let stateIndex=0,effectIndex=0;
  const react={...React,useState(initial){const i=stateIndex++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(effect){const i=effectIndex++;if(!effects[i])effects[i]={effect};}};
  const data={users:[{id:'u',display_name:'Sam'},{id:'v',display_name:'Val'}],picks,teams};
  const client={regularSeason:async()=>season,auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(table){const request={table};requests.push(request);const query={select(columns){request.columns=columns;return query;},then(resolve,reject){return Promise.resolve({data:data[table]||[],error:null}).then(resolve,reject);}};return query;}};
  const exports={};
  new Function('require','exports',code)(id=>{
    if(id==='react')return react;
    if(id.endsWith('/regularClient.mjs'))return {regularClient:()=>client};
    if(id.endsWith('/regularResults.mjs'))return results;
    if(id.endsWith('/qbSnapshot.mjs'))return snapshots;
    if(id.endsWith('/supabase'))return {supabase:client};
    if(id.endsWith('/BottomNav'))return ()=>null;
    return require(id);
  },exports);
  const render=()=>{stateIndex=effectIndex=0;return exports.default();};
  const previousWindow=global.window;
  const previousFetch=global.fetch;
  if(fetcher)global.fetch=fetcher;
  global.window={innerWidth:1280,addEventListener(){},removeEventListener(){}};
  try{
    render();effects.forEach(row=>row.cleanup=row.effect());
    await new Promise(resolve=>setImmediate(resolve));
    const tree=render();
    return {stats:states[2],html:renderToStaticMarkup(tree),requests};
  }finally{effects.forEach(row=>row.cleanup?.());global.fetch=previousFetch;if(previousWindow===undefined)delete global.window;else global.window=previousWindow;}
}

test('Stats counts both sides of a confirmed tie as completed without inventing winners or exact spreads',async()=>{
  const tie=game('tie',17,17);
  const {stats,html,requests}=await loadStats([pick('home',tie,'Home',0),pick('away',tie,'Away',0,'v')]);
  assert.equal(stats.totalPicks,2);
  assert.equal(stats.totalCorrect,0);
  assert.equal(stats.totalExact,0);
  assert.deepEqual([stats.consensusWins,stats.consensusLosses,stats.consensusTies],[0,0,1]);
  assert.equal(stats.bestConsensusWeek,undefined);
  assert.equal(stats.worstConsensusWeek,undefined);
  assert.ok(html.includes(results.REGULAR_TIE_NOTE));
  assert.ok(html.includes('1 nul'));
  assert.match(requests.find(r=>r.table==='picks').columns,/result_status/);
});

test('Stats excludes pending scores and keeps normal winner, exact and wrong counts',async()=>{
  const pending=game('pending',10,10,{result_status:null});
  const unprovenWinner=game('unproven',21,7,{result_status:null});
  const win=game('win',21,7);
  const {stats,html}=await loadStats([
    pick('pending',pending),pick('unproven',unprovenWinner),
    pick('exact',win,'Home',14),pick('ordinary',win,'Home',3,'v'),pick('wrong',win,'Away',14,'v'),
  ]);
  assert.equal(stats.totalPicks,3);
  assert.equal(stats.totalCorrect,2);
  assert.equal(stats.totalExact,1);
  assert.deepEqual([stats.consensusWins,stats.consensusLosses,stats.consensusTies],[1,0,0]);
  assert.equal(stats.consensusPct,100);
  assert.equal(html.includes(results.REGULAR_TIE_NOTE),false);
});

test('consensus treats ties separately from wins and losses in overall and weekly percentages',async()=>{
  const {stats}=await loadStats([
    pick('tie',game('tie',7,7)) ,
    pick('win',game('win',24,21),'Home'),
    pick('loss',game('loss',21,24),'Home'),
  ]);
  assert.deepEqual([stats.consensusWins,stats.consensusLosses,stats.consensusTies],[1,1,1]);
  assert.equal(stats.consensusPct,50);
  assert.deepEqual(stats.bestConsensusWeek,{week:1,wins:1,losses:1,ties:1,pct:50});
});

test('winner success percentages exclude ties while completed-pick counts retain them',async()=>{
  const {stats,html}=await loadStats([pick('tie',game('tie',7,7)),pick('win',game('win',24,21),'Home')]);
  assert.equal(stats.totalPicks,2);assert.equal(stats.totalCorrect,1);assert.equal(stats.totalDecisivePicks,1);
  assert.equal(stats.topCorrect[0].detail,'100 % de bons gagnants');
  assert.match(html,/100 % des choix avec gagnant/);
  assert.doesNotMatch(html,/50 % de bons gagnants|50 % des choix avec gagnant/);
});

test('Stats confirms legacy ordinary history and ties from matching FINAL proof before calculating',async()=>{
  const f=publicationFixture();
  f.state.games.forEach(g=>Object.assign(g,{home_score:21,away_score:14,result_status:null}));
  f.state.games[1].home_score=14;f.events[1].competitions[0].competitors[0].score='14';
  const picks=[pick('ordinary',f.state.games[0],f.state.games[0].home_team,7),pick('tie',f.state.games[1],f.state.games[1].away_team,0)];
  const before=structuredClone(picks);
  const {stats,requests}=await loadStats(picks,{teams:f.state.teams,fetcher:f.fetcher});
  assert.equal(stats.totalPicks,2);assert.equal(stats.totalCorrect,1);assert.equal(stats.totalExact,1);
  assert.deepEqual([stats.consensusWins,stats.consensusLosses,stats.consensusTies],[1,0,1]);
  assert.equal(stats.topCorrect[0].detail,'100 % de bons gagnants');
  assert.equal(f.calls.length,2);assert.deepEqual(picks,before);
  assert.match(requests.find(r=>r.table==='picks').columns,/season_type/);
  assert.match(requests.find(r=>r.table==='picks').columns,/external_game_id/);
});
