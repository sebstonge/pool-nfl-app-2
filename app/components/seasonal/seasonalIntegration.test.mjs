import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as results from '../../../lib/seasons/regularResults.mjs';
import * as snapshots from '../../../lib/seasons/qbSnapshot.mjs';
import {getSeasonalGameAccent} from '../../../lib/seasonal/seasonalTheme.mjs';

const require=createRequire(import.meta.url),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const noTheme=()=>({theme:null,pageClassName:'',gameAccent:()=>null});

async function compiled(path,dependencies,environment='development'){
  const source=await read(path);
  const {code}=await swc.transform(source,{
    filename:path.endsWith('.js')?path:'test.jsx',
    jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},
    module:{type:'commonjs'},
  });
  const exports={};
  new Function('require','exports','process',code)(id=>{
    if(id==='react/jsx-runtime')return require(id);
    const value=dependencies(id);
    return value?.default?{__esModule:true,...value}:value;
  },exports,{env:{NODE_ENV:environment}});
  return exports;
}

let dataAccesses=0;
const forbiddenClient=new Proxy({}, {get(){dataAccesses++;throw Error('The visual gallery must never access a data client');}});
async function realSamples(path){
  return compiled(path,id=>{
    if(id==='react')return React;
    if(id.endsWith('/regularResults.mjs'))return results;
    if(id.endsWith('/qbSnapshot.mjs'))return snapshots;
    if(id.endsWith('/regularClient.mjs'))return {regularClient:()=>forbiddenClient};
    if(id.endsWith('/supabase'))return {supabase:forbiddenClient};
    if(id.endsWith('/seasonal/useSeasonalTheme'))return {default:noTheme};
    if(id.endsWith('/seasonal/homeSchedule.mjs'))return {loadHomeSeasonalSchedule:()=>{dataAccesses++;throw Error('No home loader in the gallery');}};
    return {};
  });
}
const home=await realSamples('../../RegularPage.js');
const personal=await realSamples('../../matchs/RegularPage.js');
const collective=await realSamples('../../tous-les-choix/RegularPage.js');

test('local gallery route is unavailable in Production and tests, and renders only in development',async()=>{
  const Gallery=()=>null;
  for(const environment of ['production','test','development']){
    const route=await compiled('../../dev/seasonal-preview/page.js',id=>{
      if(id==='next/navigation')return {notFound(){throw Error('NEXT_NOT_FOUND');}};
      if(id.endsWith('/SeasonalPreview'))return {default:Gallery};
      throw Error(id);
    },environment);
    if(environment==='development')assert.equal(route.default().type,Gallery);
    else assert.throws(()=>route.default(),/NEXT_NOT_FOUND/);
  }
});

async function gallery({theme='christmas',page='matchs',width=1440,environment='development'}={}){
  let stateIndex=0;
  const module=await compiled('./SeasonalPreview.js',id=>{
    if(id==='react')return {...React,useEffect(){},useState(initial){const i=stateIndex++;return [i===0?width:i===1?page:initial,()=>{}];}};
    if(id==='../../RegularPage')return home;
    if(id==='../../matchs/RegularPage')return personal;
    if(id==='../../tous-les-choix/RegularPage')return collective;
    if(id.endsWith('/BottomNav'))return {default:()=>React.createElement('nav',{'data-test':'existing-navigation'})};
    if(id==='./useSeasonalTheme')return {default:()=>({theme,pageClassName:theme?`surface ${theme}`:'',gameAccent:(game,index)=>getSeasonalGameAccent(game,theme,{preview:theme,environment,previewIndex:index})})};
    if(id.endsWith('.css'))return {default:{notice:'notice',page:'preview-page',games:'games',homeGrid:'homeGrid',heading:'heading',submitted:'submitted'}};
    throw Error(id);
  },environment);
  return renderToStaticMarkup(React.createElement(module.default));
}

test('gallery reuses the actual regular card exports at desktop and mobile widths without any data access',async()=>{
  assert.equal(typeof home.SeasonalHomeNavSample,'function');
  assert.equal(typeof personal.SeasonalSubmittedGameSample,'function');
  assert.equal(typeof collective.SeasonalCollectiveGameSample,'function');
  for(const width of [1440,390,320])for(const page of ['home','matchs','tous-les-choix']){
    const html=await gallery({page,width});
    assert.match(html,/data-seasonal-theme="christmas"/);
    assert.match(html,/existing-navigation/);
    if(page==='home'){
      assert.match(html,/Pool NFL 🏈/);
      assert.equal((html.match(/home-nav-card/g)||[]).length,3);
    }else{
      for(const team of ['Bills','Lions','Cowboys','Eagles','Packers','Bears'])assert.ok(html.includes(team),team);
      assert.equal((html.match(/data-seasonal-accent="christmas-eve"/g)||[]).length,1);
      assert.equal((html.match(/data-seasonal-accent="christmas-day"/g)||[]).length,1);
      assert.match(html,/par 7/);
      assert.doesNotMatch(html,/Thanksgiving Week|Semaine de Thanksgiving|Christmas Week|Semaine de Noël/);
    }
  }
  assert.equal(dataAccesses,0);
  assert.equal(await gallery({environment:'production'}),'');
  const source=await read('./SeasonalPreview.js');
  assert.doesNotMatch(source,/\.from\(|\.rpc\(|fetch\(|getSession\(|localStorage|sessionStorage/);
});

test('development samples distinguish the accented Thanksgiving card from ordinary neighbours',async()=>{
  for(const page of ['matchs','tous-les-choix']){
    const html=await gallery({theme:'thanksgiving',page});
    assert.equal((html.match(/data-seasonal-accent="thanksgiving"/g)||[]).length,1);
    assert.doesNotMatch(html,/data-seasonal-accent="christmas/);
  }
});

test('seasonal attribute changes no existing collective card markup, information or functional styling',()=>{
  const props={
    game:{id:'g',home_team:'Lions',away_team:'Bills',home_score:20,away_score:27,result_status:'final',game_date:'2026-11-26T18:00:00Z'},
    gamePicks:[{id:'pick-u',user_id:'u',picked_team:'Bills',predicted_spread:7}],
    players:[{id:'u',display_name:'Alex'}],getTeamLogo:()=>null,formatTeamRecord:()=>'',
    isMobile:false,isDesktop:true,liveGame:null,qbPicks:[],qbRatings:[],liveGames:{},
  };
  const base=renderToStaticMarkup(React.createElement(collective.SeasonalCollectiveGameSample,props));
  for(const seasonalAccent of ['thanksgiving','christmas-eve','christmas-day']){
    const decorated=renderToStaticMarkup(React.createElement(collective.SeasonalCollectiveGameSample,{...props,seasonalAccent}));
    assert.equal(decorated.replace(` data-seasonal-accent="${seasonalAccent}"`,''),base);
  }
});

test('regular surfaces share one detector; historical collective pages and playoffs home cannot borrow active decorations',async()=>{
  const homeSource=await read('../../RegularPage.js');
  const personalSource=await read('../../matchs/RegularPage.js');
  const collectiveSource=await read('../../tous-les-choix/RegularPage.js');
  assert.match(homeSource,/useSeasonalTheme\(seasonalSchedule\?\.games,[\s\S]*?enabled: phase === 'regular'/);
  assert.match(homeSource,/if \(!user \|\| phase !== 'regular'\)/);
  assert.match(personalSource,/useSeasonalTheme\(games, \{activeWeek: currentWeek\}\)/);
  assert.match(collectiveSource,/useSeasonalTheme\(weekGames, \{activeWeek: currentWeek, viewedWeek\}\)/);
  for(const source of [homeSource,personalSource,collectiveSource]){
    assert.match(source,/data-seasonal-theme=\{theme \|\| undefined\}/);
    assert.ok(source.includes('className={`page${pageClassName ? ` ${pageClassName}` : ""}`}'));
  }
  assert.equal((personalSource.match(/data-seasonal-accent=\{gameAccent\(game, index\)\}/g)||[]).length,2);
  assert.match(collectiveSource,/seasonalAccent=\{gameAccent\(game, index\)\}/);
});
