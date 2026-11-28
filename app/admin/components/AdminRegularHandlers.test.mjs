import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const page=await readFile(new URL('../page.js',import.meta.url),'utf8');
function between(start,end){const a=page.indexOf(start),b=page.indexOf(end,a);assert.ok(a>=0&&b>a);return page.slice(a,b);}
const sources={
  rankings:between('  async function requestFullUpdate(currentSettings) {','  /* =========================================================\n     MISE À JOUR COMPLÈTE'),
  nextWeek:between('const nextWeek = async () => {','/* =========================================================\n   RESET MOT DE PASSE UTILISATEUR'),
};
const names={rankings:'requestFullUpdate',nextWeek:'nextWeek'};
function handler(key,bindings){return new Function(...Object.keys(bindings),sources[key]+`;return ${names[key]};`)(...Object.values(bindings));}
const response=(body,extra={})=>({ok:true,status:200,json:async()=>body,...extra});

function authDatabase(token='local-test',error=null){return {auth:{getSession:async()=>({data:{session:token?{access_token:token}:null},error})},from(){throw Error('Client DB mutation forbidden');}};}
const settings={current_season:2026,current_week:7,revision:4};
test('real score publication wrapper uses one authenticated request with season/week/revision and returns actual report',async()=>{
  const requests=[],result={updated:2,publication:{version:3,changed:true},notifications:{sent:1},warnings:[]};
  const run=handler('rankings',{settings,supabase:authDatabase(),fetch:async(...args)=>{requests.push(args);return response(result);}});
  assert.deepEqual(await run(settings),result);assert.equal(requests.length,1);
  assert.equal(requests[0][0],'/api/admin/regular-week-results');assert.equal(requests[0][1].headers.Authorization,'Bearer local-test');
  assert.deepEqual(JSON.parse(requests[0][1].body),{season:2026,week:7,revision:4});
});

test('publication wrapper exposes auth, HTTP conflict, and invalid response errors without another write',async()=>{
  for(const [supabase,fetch,pattern] of [
    [authDatabase(null),async()=>{throw Error('must not fetch');},/Session expirée/],
    [authDatabase(),async()=>response({error:'Conflit de semaine'},{ok:false,status:409}),/Conflit de semaine/],
    [authDatabase(),async()=>response(null,{json:async()=>{throw Error('bad json');}}),/pas pu être confirmée/],
  ])await assert.rejects(handler('rankings',{settings,supabase,fetch})(settings),pattern);
});

function nextWeekHarness({commit=response({week:8}),notify=response({success:true}),confirmed=true,token='local-test',load=async()=>{},loadStats=async()=>{}}={}){
  const events=[],messages=[],ref={current:false};
  const run=handler('nextWeek',{
    settings,nextWeekRunning:ref,window:{confirm:()=>{events.push(['confirm']);return confirmed;}},supabase:authDatabase(token),
    setMessage:value=>messages.push(value),fetch:async(url,options)=>{events.push([url,options]);return url==='/api/admin/regular-next-week'?await commit:await notify;},
    loadSettings:async()=>{events.push(['settings']);await load();},loadSelectionStats:async week=>{events.push(['stats',week]);await loadStats();},
  });
  return {run,events,messages,ref};
}
test('real next-week handler commits displayed context once, then notifies and reloads',async()=>{
  const h=nextWeekHarness();await h.run();
  assert.deepEqual(h.events.map(e=>e[0]),['confirm','/api/admin/regular-next-week','/api/push/first-player','settings','stats']);
  assert.deepEqual(JSON.parse(h.events[1][1].body),{season:2026,week:7,revision:4,confirm:true});
  assert.equal(h.events[1][1].headers.Authorization,'Bearer local-test');assert.equal(h.events.at(-1)[1],8);
  assert.match(h.messages.at(-1),/Semaine 8 ouverte/);assert.equal(h.ref.current,false);
});

test('next-week conflict never notifies or writes directly; retry keeps the same displayed revision',async()=>{
  const h=nextWeekHarness({commit:response({error:'Conflit 409'},{ok:false,status:409})});await h.run();await h.run();
  assert.match(h.messages.at(-1),/Conflit 409/);assert.equal(h.events.some(e=>e[0]==='/api/push/first-player'),false);
  const requests=h.events.filter(e=>e[0]==='/api/admin/regular-next-week');assert.equal(requests.length,2);assert.equal(requests[0][1].body,requests[1][1].body);
  assert.doesNotMatch(sources.nextWeek,/\.from\(|\.upsert\(|\.update\(/);
});

test('next-week display reload errors report the committed week honestly without repeating the mutation or push',async()=>{
  for(const options of [
    {load:async()=>{throw Error('Settings reload failed');}},
    {loadStats:async()=>{throw Error('Stats reload failed');}},
  ]){
    const h=nextWeekHarness(options);await h.run();
    assert.match(h.messages.at(-1),/^Semaine 8 ouverte\./);
    assert.match(h.messages.at(-1),/actualisation de l’affichage est incomplète/);
    assert.match(h.messages.at(-1),/Recharge la page/);assert.doesNotMatch(h.messages.at(-1),/^Erreur/);
    assert.equal(h.events.filter(e=>e[0]==='/api/admin/regular-next-week').length,1);
    assert.equal(h.events.filter(e=>e[0]==='/api/push/first-player').length,1);
    assert.equal(h.ref.current,false);
  }
});

test('next-week double clicks, cancellation, expired session and postcommit notification errors are handled',async()=>{
  let resolve;const commit=new Promise(r=>{resolve=r;});const h=nextWeekHarness({commit});
  const first=h.run();await new Promise(r=>setImmediate(r));await h.run();assert.equal(h.events.filter(e=>e[0]==='/api/admin/regular-next-week').length,1);
  resolve(response({week:8}));await first;
  const canceled=nextWeekHarness({confirmed:false});await canceled.run();assert.equal(canceled.events.length,1);
  const expired=nextWeekHarness({token:null});await expired.run();assert.match(expired.messages.at(-1),/Session expirée/);assert.equal(expired.events.length,1);
  const failedNotify=nextWeekHarness({notify:response(null,{ok:false,status:503})});await failedNotify.run();
  assert.match(failedNotify.messages.at(-1),/Semaine 8 ouverte/);assert.match(failedNotify.messages.at(-1),/notification/);assert.ok(failedNotify.events.some(e=>e[0]==='settings'));
});
