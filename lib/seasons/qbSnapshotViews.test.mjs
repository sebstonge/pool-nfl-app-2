import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as snapshots from './qbSnapshot.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const swc = require('next/dist/build/swc');
const unknownName = 'QB historique non identifié';
const currentCatalog = [{id:'slot',name:'Tanner McKee',team:'Eagles',espn_athlete_id:'mckee'}];
const pick = (week, name = 'Jalen Hurts', athleteId = 'hurts') => ({
  id:`pick-${week}`,user_id:'u',qb_id:'slot',season:2026,week,
  selected_qb_name:name,selected_espn_athlete_id:athleteId,selected_team:'Eagles',
  qbs:currentCatalog[0],
});
const picks = [pick(2),pick(6),pick(7,'Tanner McKee','mckee')];
const ratings = [
  {qb_id:'slot',season:2026,week:2,actual_qb_name:'Jalen Hurts',actual_espn_athlete_id:'hurts',passer_rating:96.8},
  {qb_id:'slot',season:2026,week:6,actual_qb_name:'Tanner McKee',actual_espn_athlete_id:'mckee',passer_rating:104.2},
  {qb_id:'slot',season:2026,week:7,actual_qb_name:'Tanner McKee',actual_espn_athlete_id:'mckee',passer_rating:0},
];
const legacy = {id:'legacy',user_id:'u',qb_id:'legacy-slot',season:2026,week:1,qbs:currentCatalog[0]};
const legacyRating = {qb_id:'legacy-slot',season:2026,week:1,passer_rating:88.4};

async function loadView(path, extraExports = [], data = {}) {
  const source = await readFile(new URL(`../../app/${path}/RegularPage.js`,import.meta.url),'utf8');
  const {code} = await swc.transform(source + (extraExports.length ? `\nexport { ${extraExports.join(', ')} };` : ''), {
    filename:`${path}.jsx`,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'},
  });
  const states = [], effects = [], requests = [];
  let stateIndex = 0, effectIndex = 0;
  const react = {...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(effect) {
      const index = effectIndex++;
      if (!effects[index]) effects[index] = {effect};
    },
  };
  const client = {
    auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},
    from(table) {
      const request = {table}; requests.push(request);
      const query = {
        select(columns) {request.columns=columns;return query;},
        order() {return query;},
        then(resolve,reject) {return Promise.resolve({data:data[table] || [],error:null}).then(resolve,reject);},
      };
      return query;
    },
  };
  const exports = {};
  new Function('require','exports',code)(id => {
    if (id === 'react') return react;
    if (id.endsWith('/regularClient.mjs')) return {regularClient:()=>client};
    if (id.endsWith('/qbSnapshot.mjs')) return snapshots;
    if (id.endsWith('/supabase')) return {supabase:client};
    if (id.endsWith('/BottomNav')) return ()=>null;
    return require(id);
  },exports);
  const render = () => {stateIndex=effectIndex=0;return exports.default();};
  return {
    ...exports,states,requests,source,
    async mount() {
      global.window = {innerWidth:1280,addEventListener(){},removeEventListener(){}};
      render();
      effects.forEach(row=>row.cleanup=row.effect());
      await new Promise(resolve=>setImmediate(resolve));
      return render();
    },
    html:renderToStaticMarkup,
    destroy() {effects.forEach(row=>row.cleanup?.());delete global.window;},
  };
}

const viewData = (extraPicks = [],extraRatings = []) => ({
  teams:[{name:'Eagles',espn_abbr:'phi'}],
  users:[{id:'u',display_name:'Sam',real_name:'Samuel'}],
  qbs:currentCatalog,
  qb_picks:[...picks,...extraPicks],
  qb_ratings:[...ratings,...extraRatings],
  qb_weekly_stats:[{week:2,espn_athlete_id:'hurts',passer_rating:96.8},{week:6,espn_athlete_id:'mckee',passer_rating:104.2},{week:7,espn_athlete_id:'mckee',passer_rating:0}],
});

test('Tous les choix keeps S2 normal, S6 replacement and S7 McKee normal after the catalog changes',async()=>{
  const view = await loadView('tous-les-choix',['getDisplayedQbData','findQbGameData','QbPickCard']);
  const rows = picks.map(p=>view.getDisplayedQbData(p,ratings,{}));
  assert.deepEqual(rows.map(r=>[r.actualName,r.actualAthleteId,r.displayedRating,r.replaced]),[
    ['Jalen Hurts','hurts',96.8,false],['Tanner McKee','mckee',104.2,true],['Tanner McKee','mckee',0,false],
  ]);
  for (const [index,row] of rows.entries()) {
    for (const isMobile of [false,true]) {
      const html = view.html(React.createElement(view.QbPickCard,{
        qbPick:picks[index],qbRatings:ratings,players:[{id:'u',display_name:'Sam'}],
        qbSeasonAverages:{hurts:96.8,mckee:52.1},getTeamLogo:()=>'/eagles.png',isMobile,liveGames:{},
      }));
      assert.ok(html.includes(`/full/${row.actualAthleteId}.png`));
      assert.ok(html.includes('/eagles.png'));
      assert.equal(html.includes('🔄 Remplacement'),index===1);
      assert.ok(html.includes('Moy'));
      assert.ok(html.includes(`${isMobile ? 46 : 62}px minmax(0,1fr)`));
    }
  }
});

test('Tous les choix preserves a legacy official rating without deriving identity or replacements from the catalog',async()=>{
  const view = await loadView('tous-les-choix',['getDisplayedQbData','findQbGameData']);
  const row = view.getDisplayedQbData(legacy,[legacyRating],{});
  assert.equal(row.displayedRating,88.4);
  assert.equal(row.actualName,unknownName);
  assert.equal(row.actualAthleteId,null);
  assert.equal(row.replaced,false);
  assert.equal(row.displayedQb.team,'');
  assert.equal(view.findQbGameData(legacy,{game:{homeTeam:'Eagles',status:{state:'in'}}}),null);
  assert.match(view.source,/selected_qb_name,[\s\S]*selected_espn_athlete_id,[\s\S]*selected_team/);
});

test('temporary ESPN matching follows the selection snapshot and never labels a replacement before an official rating',async()=>{
  const view = await loadView('tous-les-choix',['getDisplayedQbData']);
  const liveGames = {game:{gameId:'g',homeTeam:'Eagles',awayTeam:'Cowboys',status:{state:'in'},passers:[
    {athleteId:'hurts',name:'Jalen Hurts',rating:111.4,teamNames:['Eagles']},
    {athleteId:'mckee',name:'Tanner McKee',rating:55,teamNames:['Eagles']},
  ]}};
  const normal = view.getDisplayedQbData(picks[0],[],liveGames);
  assert.equal(normal.actualAthleteId,'hurts');
  assert.equal(normal.displayedRating,111.4);
  liveGames.game.passers.shift();
  for (const state of ['in','post']) {
    liveGames.game.status.state=state;
    const temporary = view.getDisplayedQbData(picks[1],[],liveGames);
    assert.equal(temporary.actualAthleteId,'mckee');
    assert.equal(temporary.displayedRating,55);
    assert.equal(temporary.replaced,false);
  }
  const official = view.getDisplayedQbData(picks[1],ratings,liveGames);
  assert.equal(official.displayedRating,104.2);
  assert.equal(official.replaced,true);
});

test('Stats uses immutable selections and explicit official replacement state, including legacy rows',async()=>{
  const view = await loadView('analytics',[],viewData([legacy],[legacyRating]));
  try {
    const tree = await view.mount();
    const stats = view.states[2];
    assert.deepEqual(stats.myQbPicks.map(r=>[r.week,r.qbName,r.actualQbName,r.rating,r.replaced]),[
      [1,unknownName,unknownName,88.4,false],
      [2,'Jalen Hurts','Jalen Hurts',96.8,false],
      [6,'Jalen Hurts','Tanner McKee',104.2,true],
      [7,'Tanner McKee','Tanner McKee',0,false],
    ]);
    assert.equal(stats.bestQb.name,'Tanner McKee');
    assert.equal(stats.bestQb.espn_athlete_id,'mckee');
    assert.equal(view.requests.some(r=>r.table==='qbs'),false);
    const html = view.html(tree);
    assert.equal(html.match(/Remplacé par/g)?.length,1);
    assert.ok(html.includes('82px minmax(0, 1fr) auto'));
    assert.ok(html.includes('/full/mckee.png'));
    assert.ok(html.includes(unknownName));
    assert.ok(html.includes('88.4'));
  } finally {view.destroy();}
});

test('Stats preserves a known actual legacy identity without inventing a selection or replacement',async()=>{
  const known = {...legacyRating,passer_rating:150.3,actual_qb_name:'Original QB',actual_espn_athlete_id:'original'};
  const view = await loadView('analytics',[],viewData([legacy],[known]));
  try {
    const tree = await view.mount();
    const row = view.states[2].myQbPicks.find(r=>r.week===1);
    assert.equal(row.qbName,'Original QB');
    assert.equal(row.replaced,false);
    assert.equal(row.rating,150.3);
    assert.equal(view.states[2].bestQb.name,'Original QB');
    const html = view.html(tree);
    assert.ok(html.includes('/full/original.png'));
    assert.ok(html.includes('Original QB'));
    assert.ok(html.includes('150.3'));
  } finally {view.destroy();}
});

test('QB Ratings groups by the actual official athlete and retains unknown legacy ratings',async()=>{
  const view = await loadView('qb-ratings',[],viewData([legacy],[legacyRating]));
  try {
    const tree = await view.mount();
    const rows = view.states[0];
    assert.equal(rows.length,3);
    const hurts=rows.find(r=>r.qb.espn_athlete_id==='hurts');
    const mckee=rows.find(r=>r.qb.espn_athlete_id==='mckee');
    const unknown=rows.find(r=>r.qb.espn_athlete_id===null);
    assert.equal(hurts.qb.name,'Jalen Hurts');
    assert.equal(hurts.best.week,2);
    assert.equal(mckee.qb.name,'Tanner McKee');
    assert.equal(mckee.best.week,6);
    assert.equal(mckee.worst.week,7);
    assert.equal(mckee.worst.passer_rating,0);
    assert.equal(mckee.average,52.1);
    assert.equal(mckee.best.selected_by,'Sam');
    assert.equal(unknown.qb.name,unknownName);
    assert.equal(unknown.qb.team,'');
    assert.equal(unknown.best.passer_rating,88.4);
    assert.equal(unknown.average,null);
    assert.equal(view.requests.some(r=>r.table==='qbs'),false);
    const html=view.html(tree);
    assert.ok(html.includes('/full/hurts.png'));
    assert.ok(html.includes('/full/mckee.png'));
    assert.ok(html.includes('teamlogos/nfl/500/phi.png'));
    assert.ok(html.includes(unknownName));
    assert.ok(html.includes('88.4'));
  } finally {view.destroy();}
});
