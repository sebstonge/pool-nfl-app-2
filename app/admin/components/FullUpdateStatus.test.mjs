import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const page=await readFile(new URL('../page.js',import.meta.url),'utf8');
const cardSource=await readFile(new URL('./FullUpdateStatus.js',import.meta.url),'utf8');
const css=await readFile(new URL('./FullUpdateStatus.module.css',import.meta.url),'utf8');
const start=page.indexOf('  const fullUpdate = async () => {');
const end=page.indexOf(' /* =========================================================\n   SEMAINE SUIVANTE',start);
assert.ok(start>=0 && end>start);
const fullUpdateSource=page.slice(start,end);
const {code}=await swc.transform(cardSource,{filename:'FullUpdateStatus.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const styles=Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m=>[m[1],m[1]])),exports={};
new Function('require','exports',code)(id=>id.endsWith('.css')?styles:require(id),exports);
const render=state=>renderToStaticMarkup(React.createElement(exports.default,{state}));
const running={status:'running',week:7,activeStep:'scores',completed:{},details:{},warnings:[],error:null};
const success={...running,status:'success',activeStep:null,completed:{scores:1,teams:32,qb:2,rankings:13},details:{qbStats:5,notifications:0}};

function harness({overrides={},changedGames=[{away_team:'Bills',home_team:'Jets'}],sent=0,token='local-test'}={}) {
  let state=null;
  const events=[],states=[],ref={current:false};
  const call=(name,result)=>async(...args)=>{events.push({name,args});return overrides[name]?overrides[name](...args):result;};
  const bindings={
    settings:{current_week:6},fullUpdateRunning:ref,setMessage:message=>events.push({name:'message',args:[message]}),
    setFullUpdateStatus:update=>{state=typeof update==='function'?update(state):update;states.push(structuredClone(state));},
    loadSettings:call('settings',{current_week:7}),
    updateScoresFromEspn:call('scores',{updated:1,changedGames}),
    updateTeamStandingsFromEspn:call('teams',{updated:32,notMatched:[]}),
    updateQBRatingsFromEspn:call('qb',{updated:2,notFound:[]}),
    updateAllQBWeeklyStatsFromEspn:call('qbStats',{updated:5,notFound:[]}),
    calculateScores:call('rankings',13),
    supabase:{auth:{getSession:call('session',{data:{session:token?{access_token:token}:null}})}},
    fetch:call('notify',{ok:true,json:async()=>({success:true,sent})}),
    loadSelectionStats:call('selectionStats',undefined),
    console:{log(){},error(){}},
  };
  const run=new Function(...Object.keys(bindings),fullUpdateSource+';return fullUpdate;')(...Object.values(bindings));
  return {run,events,states,ref,get state(){return state;}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('nothing is displayed before an update; card is inserted under the hero before Admin actions',()=>{
  assert.equal(render(null),'');
  const position=page.indexOf('<FullUpdateStatus state={fullUpdateStatus} />');
  assert.ok(position>page.indexOf('<h1>Admin ⚙️</h1>'));
  assert.ok(position<page.indexOf('          ACTIONS ADMIN'));
  assert.match(page,/disabled=\{fullUpdateStatus\?\.status === "running"\}/);
});

test('pending and active stages are distinct, with no invented counts or success glow',()=>{
  const html=render(running);
  assert.match(html,/Mise à jour en cours/);assert.match(html,/semaine 7/);
  assert.equal((html.match(/class="step active"/g)||[]).length,1);
  assert.equal((html.match(/class="step pending"/g)||[]).length,3);
  assert.match(html,/aria-current="step"/);assert.match(html,/spinner/);
  assert.doesNotMatch(html,/class="card success"|1 match|32 équipes/);
});

test('success displays all four real results and optional details, including zero notifications',()=>{
  const html=render(success);
  assert.match(html,/✓ Mise à jour complétée/);assert.match(html,/semaine 7/);
  assert.equal((html.match(/class="step done"/g)||[]).length,4);
  for(const result of ['1 match','32 équipes','2 QB','13 joueurs','5 QB','0 envois'])assert.ok(html.includes(result),result);
  assert.match(html,/class="card success"/);assert.match(html,/<details/);
});

test('zero counts stay valid; absent counts are never replaced with zero',()=>{
  const zero=render({...success,completed:{scores:0,teams:0,qb:0,rankings:0}});
  assert.match(zero,/0 matchs/);assert.match(zero,/0 équipes/);assert.match(zero,/0 QB/);assert.match(zero,/0 joueurs/);
  const unknown=render({...running,completed:{scores:null,teams:undefined},activeStep:'qb'});
  assert.equal((unknown.match(/Terminée/g)||[]).length,2);
  assert.doesNotMatch(unknown,/0 matchs|0 équipes|undefined|NaN/);
});

test('failure identifies its stage, preserves completed stages and leaves later ones pending',()=>{
  const html=render({...running,status:'error',activeStep:null,completed:{scores:1},error:{step:'teams',message:'Indisponible <script>test</script>'}});
  assert.match(html,/Échec de la mise à jour — Équipes NFL/);
  assert.equal((html.match(/class="step done"/g)||[]).length,1);
  assert.equal((html.match(/class="step failed"/g)||[]).length,1);
  assert.equal((html.match(/class="step pending"/g)||[]).length,2);
  assert.match(html,/aria-live="assertive"/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/class="card success"|spinner/);
});

test('warnings and secondary results remain collapsed and do not replace the four main stages',()=>{
  const html=render({...success,warnings:['Équipe non associée'],details:{notificationNote:'Aucun nouveau score à notifier.'}});
  assert.match(html,/<details class="details">/);assert.doesNotMatch(html,/<details[^>]* open/);
  assert.match(html,/1 avertissement/);assert.match(html,/Équipe non associée/);assert.match(html,/Aucun nouveau score à notifier/);
  assert.equal((html.match(/class="step done"/g)||[]).length,4);
});

test('the real client handler advances only after each awaited operation resolves',async()=>{
  const waits=Object.fromEntries(['scores','teams','qb','qbStats','rankings'].map(key=>[key,deferred()]));
  const h=harness({overrides:Object.fromEntries(Object.entries(waits).map(([key,d])=>[key,()=>d.promise]))});
  const run=h.run();await flush();
  assert.equal(h.state.week,7);assert.equal(h.state.activeStep,'scores');assert.deepEqual(h.state.completed,{});
  waits.scores.resolve({updated:4,changedGames:[]});await flush();
  assert.equal(h.state.activeStep,'teams');assert.deepEqual(h.state.completed,{scores:4});
  waits.teams.resolve({updated:19,notMatched:[]});await flush();
  assert.equal(h.state.activeStep,'qb');assert.deepEqual(h.state.completed,{scores:4,teams:19});
  waits.qb.resolve({updated:3});await flush();
  assert.equal(h.state.activeStep,'qb');assert.equal('qb' in h.state.completed,false);
  waits.qbStats.resolve({updated:8,notFound:[]});await flush();
  assert.equal(h.state.activeStep,'rankings');assert.equal(h.state.completed.qb,3);assert.equal(h.state.details.qbStats,8);
  waits.rankings.resolve(11);await run;
  assert.equal(h.state.status,'success');assert.deepEqual(h.state.completed,{scores:4,teams:19,qb:3,rankings:11});
  assert.equal(h.ref.current,false);
});

test('business calls retain their order, week, notification request and actual returned counts',async()=>{
  const h=harness();await h.run();
  assert.deepEqual(h.events.filter(e=>e.name!=='message').map(e=>e.name),['settings','scores','teams','qb','qbStats','rankings','session','notify','selectionStats']);
  for(const name of ['scores','qb','qbStats','rankings','selectionStats'])assert.deepEqual(h.events.find(e=>e.name===name).args,[7]);
  const request=h.events.find(e=>e.name==='notify').args;
  assert.equal(request[0],'/api/push/rankings-updated');assert.equal(request[1].method,'POST');
  assert.deepEqual(JSON.parse(request[1].body),{week:7,gameLabel:'Bills @ Jets'});
  assert.deepEqual(h.state.completed,success.completed);assert.deepEqual(h.state.details,{qbStats:5,notifications:0,notificationNote:null});
  assert.ok(h.events.filter(e=>e.name==='message').every(e=>e.args[0]===''));
});

for(const [name,failedStep,completed] of [
  ['settings',null,{}],['scores','scores',{}],['teams','teams',{scores:1}],
  ['qb','qb',{scores:1,teams:32}],['qbStats','qb',{scores:1,teams:32}],['rankings','rankings',{scores:1,teams:32,qb:2}],
])test(`failure in ${name} is reported at the real stage without running later operations`,async()=>{
  const h=harness({overrides:{[name]:async()=>{throw Error('Erreur ciblée');}}});await h.run();
  assert.equal(h.state.status,'error');assert.deepEqual(h.state.error,{step:failedStep,message:'Erreur ciblée'});
  assert.deepEqual(h.state.completed,completed);assert.equal(h.events.at(-1).name,name);
  assert.equal(h.ref.current,false);
});

test('no changed games skips notifications as before and reports no invented count',async()=>{
  const h=harness({changedGames:[]});await h.run();
  assert.equal(h.state.status,'success');assert.equal(h.state.details.notifications,null);
  assert.match(h.state.details.notificationNote,/Aucun nouveau score/);
  assert.equal(h.events.some(e=>e.name==='notify'||e.name==='session'),false);
});

test('notification errors remain non-blocking and are shown discreetly, without false success counts',async()=>{
  for(const overrides of [{notify:async()=>{throw Error('offline');}},{notify:async()=>({ok:false,json:async()=>({error:'failed'})})}]){
    const h=harness({overrides});await h.run();assert.equal(h.state.status,'success');
    assert.equal(h.state.details.notifications,null);assert.match(h.state.details.notificationNote,/pas été confirmé/);
  }
  const noSession=harness({token:null});await noSession.run();
  assert.equal(noSession.state.status,'success');assert.equal(noSession.events.some(e=>e.name==='notify'),false);
});

test('missing team and QB stat matches remain accessible as warnings',async()=>{
  const h=harness({overrides:{teams:async()=>({updated:31,notMatched:['Jets']}),qbStats:async()=>({updated:4,notFound:['QB test']})}});
  await h.run();assert.equal(h.state.status,'success');assert.equal(h.state.warnings.length,2);
  assert.equal(h.state.completed.teams,31);assert.equal(h.state.details.qbStats,4);
});

test('double click cannot interleave progress; retry starts cleanly after an error',async()=>{
  const wait=deferred(),h=harness({overrides:{scores:()=>wait.promise}});
  const first=h.run();await flush();await h.run();
  assert.equal(h.events.filter(e=>e.name==='settings').length,1);
  wait.resolve({updated:0,changedGames:[]});await first;
  let fail=true;
  const retry=harness({overrides:{teams:async()=>{if(fail)throw Error('once');return {updated:0,notMatched:[]};}}});
  await retry.run();assert.equal(retry.state.status,'error');fail=false;
  const before=retry.states.length;await retry.run();
  assert.deepEqual(retry.states[before].completed,{});assert.equal(retry.states[before].error,null);
  assert.equal(retry.state.status,'success');assert.equal(retry.state.completed.teams,0);
});

test('responsive CSS keeps bounded columns and respects reduced motion',()=>{
  assert.match(css,/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 350px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});
