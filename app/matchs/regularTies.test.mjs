import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as results from '../../lib/seasons/regularResults.mjs';

const require=createRequire(import.meta.url),React=require('react');
const swc=require('next/dist/build/swc'),{renderToStaticMarkup}=require('react-dom/server');
async function view(path,names){
  const source=await readFile(new URL(`../${path}/RegularPage.js`,import.meta.url),'utf8');
  const {code}=await swc.transform(`${source}\nexport {${names.join(',')}};`,{
    filename:`${path}.jsx`,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'},
  });
  const exports={};
  new Function('require','exports',code)(id=>{
    if(id==='react'||id==='react/jsx-runtime')return require(id);
    if(id.endsWith('/regularResults.mjs'))return results;
    if(id.endsWith('/regularClient.mjs'))return {regularClient:()=>({})};
    return {};
  },exports);
  return {...exports,source};
}
const game={id:'g',home_team:'Home',away_team:'Away',home_score:20,away_score:20,game_date:'2026-10-25T17:00:00Z',result_status:'final'};
const pick={picked_team:'Home',predicted_spread:0};
const props={game,pick,getTeamLogo:()=>null,formatTeamRecord:()=>'',isMobile:false,isDesktop:true};

test('Mes choix gives either tied side yellow one-point badge, and pending ties stay neutral',async()=>{
  const v=await view('matchs',['getPickBadge','getPickPoints','SubmittedGameCard']);
  for(const picked_team of ['Home','Away']){
    assert.equal(v.getPickBadge(game,{...pick,picked_team}),'🟡');
    assert.equal(v.getPickPoints(game,{...pick,picked_team}),1);
  }
  const html=renderToStaticMarkup(React.createElement(v.SubmittedGameCard,props));
  assert.match(html,/Égalité/);assert.match(html,/1 point/);assert.ok(html.includes(results.REGULAR_TIE_NOTE));
  assert.doesNotMatch(html,/2 points/);
  const pending={...game,result_status:null};
  assert.equal(v.getPickBadge(pending,pick),'⚪');assert.equal(v.getPickPoints(pending,pick),null);
  const pendingHtml=renderToStaticMarkup(React.createElement(v.SubmittedGameCard,{...props,game:pending}));
  assert.ok(!pendingHtml.includes(results.REGULAR_TIE_NOTE));assert.match(pendingHtml,/À confirmer/);
});

test('Tous les choix shows a tie point for either side, preserving normal result badges',async()=>{
  const v=await view('tous-les-choix',['getPickResult','GamePicksCard']);
  for(const picked_team of ['Home','Away'])assert.deepEqual(v.getPickResult(game,{...pick,picked_team}),{badge:'🟡',points:1,label:'Égalité · 1 pt'});
  assert.equal(v.getPickResult({...game,result_status:null},pick).points,null);
  const final={...game,home_score:27};
  assert.deepEqual([v.getPickResult(final,{...pick,predicted_spread:7}).points,v.getPickResult(final,{...pick,predicted_spread:3}).points,v.getPickResult(final,{...pick,picked_team:'Away'}).points],[2,1,0]);
  const cardProps={game,gamePicks:[],players:[],getTeamLogo:()=>null,formatTeamRecord:()=>'',isMobile:false,isDesktop:true,qbPicks:[],qbRatings:[],liveGames:{}};
  assert.ok(renderToStaticMarkup(React.createElement(v.GamePicksCard,cardProps)).includes(results.REGULAR_TIE_NOTE));
  assert.ok(!renderToStaticMarkup(React.createElement(v.GamePicksCard,{...cardProps,game:final})).includes(results.REGULAR_TIE_NOTE));
  assert.match(v.source,/home_score,\s+result_status,/);
});

test('new spread input and submit validation require positive integers',async()=>{
  const {source}=await view('matchs',[]);
  assert.match(source,/type="number"\s+min="1"\s+step="1"/);
  assert.match(source,/!Number\.isInteger\(spread\) \|\| spread <= 0/);
  assert.ok(source.indexOf('spread <= 0')<source.indexOf('const pickRows ='));
});

test('both match views confirm saved legacy games before exposing the weekly game state',async()=>{
  for(const [path,setter] of [['matchs','setAllWeekGames'],['tous-les-choix','setAllWeekGames']]){
    const {source}=await view(path,[]);
    const confirmation=source.indexOf('await confirmLegacyRegularResults(');
    assert.ok(confirmation>0);
    assert.ok(source.indexOf(`${setter}(`,confirmation)>confirmation);
    assert.match(source,/season: await supabase\.regularSeason\?\.\(\)/);
  }
});
