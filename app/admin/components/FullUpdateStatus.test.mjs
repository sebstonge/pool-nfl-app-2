import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url), React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'), swc=require('next/dist/build/swc');
const page=await readFile(new URL('../page.js',import.meta.url),'utf8');
const cardSource=await readFile(new URL('./FullUpdateStatus.js',import.meta.url),'utf8');
const css=await readFile(new URL('./FullUpdateStatus.module.css',import.meta.url),'utf8');
const start=page.indexOf('  const fullUpdate = async () => {');
const end=page.indexOf(' /* =========================================================\n   SEMAINE SUIVANTE',start);
assert.ok(start>=0 && end>start);
const fullUpdateSource=page.slice(start,end);
const {code}=await swc.transform(cardSource,{filename:'FullUpdateStatus.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const styles=Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m=>[m[1],m[1]])), exports={};
new Function('require','exports',code)(id=>id.endsWith('.css')?styles:require(id),exports);
const render=state=>renderToStaticMarkup(React.createElement(exports.default,{state}));
const running={status:'running',week:7,activeStep:'scores',completed:{},stepStates:{},details:{},warnings:[],error:null};
const success={...running,status:'success',activeStep:null,completed:{scores:1,teams:32,qb:2,rankings:13},details:{qbStats:5,notifications:0}};
const currentSettings={current_week:7,current_season:2026,revision:4};
const publication={updated:13,publication:{version:2,changed:true,baseline:false},notifications:{sent:0,failed:0,scheduled:0,noSubscription:2},warnings:[]};

function harness({overrides={},changedGames=[{away_team:'Bills',home_team:'Jets'}]}={}) {
  let state=null;
  const events=[],states=[],ref={current:false};
  const call=(name,result)=>async(...args)=>{events.push({name,args});return overrides[name]?overrides[name](...args):result;};
  const bindings={
    settings:{current_week:6},fullUpdateRunning:ref,setMessage:message=>events.push({name:'message',args:[message]}),
    setFullUpdateStatus:update=>{state=typeof update==='function'?update(state):update;states.push(structuredClone(state));},
    loadSettings:call('settings',currentSettings),
    updateScoresFromEspn:call('scores',{updated:1,changedGames,pending:0,warnings:[]}),
    updateTeamStandingsFromEspn:call('teams',{updated:32,notMatched:[]}),
    updateQBRatingsFromEspn:call('qb',{updated:2,notFound:[]}),
    updateAllQBWeeklyStatsFromEspn:call('qbStats',{updated:5,notFound:[]}),
    calculateScores:call('rankings',publication),
    loadSelectionStats:call('selectionStats',undefined),
  };
  const run=new Function(...Object.keys(bindings),fullUpdateSource+';return fullUpdate;')(...Object.values(bindings));
  return {run,events,states,ref,get state(){return state;}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('card remains in its original location; active and pending stages keep the existing design',()=>{
  assert.equal(render(null),'');
  const position=page.indexOf('<FullUpdateStatus state={fullUpdateStatus} />');
  assert.ok(position>page.indexOf('<h1>Admin ⚙️</h1>'));
  assert.ok(position<page.indexOf('          ACTIONS ADMIN'));
  assert.match(page,/disabled=\{fullUpdateStatus\?\.status === "running"\}/);
  const html=render(running);
  assert.match(html,/Mise à jour en cours/);assert.match(html,/semaine 7/);
  assert.equal((html.match(/class="step active"/g)||[]).length,1);
  assert.equal((html.match(/class="step pending"/g)||[]).length,3);
  assert.match(html,/aria-current="step"/);assert.match(html,/spinner/);
  assert.doesNotMatch(html,/card success|1 match|32 équipes/);
});

test('success displays real results and zero notifications; missing counts are never invented',()=>{
  const html=render(success);
  assert.match(html,/✓ Mise à jour complétée/);
  assert.equal((html.match(/class="step done"/g)||[]).length,4);
  for(const result of ['1 match','32 équipes','2 QB','13 joueurs','5 QB','0 envois'])assert.ok(html.includes(result),result);
  assert.match(html,/card success/);assert.match(html,/<details/);
  const zero=render({...success,completed:{scores:0,teams:0,qb:0,rankings:0}});
  for(const count of ['0 matchs','0 équipes','0 QB','0 joueurs'])assert.ok(zero.includes(count));
  const unknown=render({...running,completed:{scores:null,teams:undefined},activeStep:'qb'});
  assert.equal((unknown.match(/Terminée/g)||[]).length,2);
  assert.doesNotMatch(unknown,/0 matchs|0 équipes|undefined|NaN/);
});

test('partial stages retain achieved counts and show their warning without a success glow',()=>{
  const html=render({...success,status:'partial',stepStates:{teams:{status:'partial'}},warnings:['Équipe non associée']});
  assert.match(html,/Mise à jour partielle/);assert.match(html,/32 équipes · Partielle/);
  assert.match(html,/class="step partialStep"/);assert.doesNotMatch(html,/card success/);
  assert.match(html,/<details class="details">/);assert.doesNotMatch(html,/<details[^>]* open/);
  assert.match(html,/1 avertissement/);assert.match(html,/Équipe non associée/);
});

test('later fatal failure keeps earlier results, any count in the failed stage, and escapes its error',()=>{
  const html=render({...running,status:'partial',activeStep:null,completed:{scores:1,qb:2},stepStates:{qb:{status:'error'}},error:{step:'qb',message:'Indisponible <script>test</script>'}});
  assert.match(html,/Mise à jour partielle — QB Ratings/);assert.match(html,/2 QB · Échec/);
  assert.match(html,/class="step failed"/);assert.match(html,/1 match/);
  assert.match(html,/aria-live="assertive"/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/card success|spinner/);
  assert.match(render({...running,status:'error',activeStep:null,error:{step:'scores',message:'Erreur'}}),/Échec de la mise à jour — Scores ESPN/);
});

test('the real handler awaits each operation and preserves pool QB count during independent stats work',async()=>{
  const waits=Object.fromEntries(['scores','teams','qb','qbStats','rankings'].map(key=>[key,deferred()]));
  const h=harness({overrides:Object.fromEntries(Object.entries(waits).map(([key,d])=>[key,()=>d.promise]))});
  const run=h.run();await flush();
  assert.equal(h.state.week,7);assert.equal(h.state.activeStep,'scores');assert.deepEqual(h.state.completed,{});
  waits.scores.resolve({updated:4,changedGames:[]});await flush();
  assert.equal(h.state.activeStep,'teams');assert.deepEqual(h.state.completed,{scores:4});
  waits.teams.resolve({updated:19,notMatched:[]});await flush();
  assert.equal(h.state.activeStep,'qb');
  waits.qb.resolve({updated:3});await flush();
  assert.equal(h.state.activeStep,'qb');assert.equal(h.state.completed.qb,3);
  waits.qbStats.resolve({updated:8,notFound:[]});await flush();
  assert.equal(h.state.activeStep,'rankings');assert.equal(h.state.details.qbStats,8);
  waits.rankings.resolve({...publication,updated:11});await run;
  assert.equal(h.state.status,'success');assert.deepEqual(h.state.completed,{scores:4,teams:19,qb:3,rankings:11});
  assert.equal(h.ref.current,false);
});

test('publication owns notifications; no second push request is made and the displayed context is passed intact',async()=>{
  const h=harness();await h.run();
  assert.deepEqual(h.events.filter(e=>e.name!=='message').map(e=>e.name),['settings','scores','teams','qb','qbStats','rankings','selectionStats']);
  for(const name of ['scores','qb','qbStats','selectionStats'])assert.deepEqual(h.events.find(e=>e.name===name).args,[7]);
  assert.deepEqual(h.events.find(e=>e.name==='rankings').args,[7,currentSettings]);
  assert.doesNotMatch(fullUpdateSource,/\/api\/push\/rankings-updated|fetch\(/);
  assert.deepEqual(h.state.completed,success.completed);assert.deepEqual(h.state.details,{qbStats:5,notifications:0,notificationNote:null});
});

for(const [name,failedStep,completed,status] of [
  ['settings',null,{},'error'],['scores','scores',{},'error'],['teams','teams',{scores:1},'partial'],
  ['qb','qb',{scores:1,teams:32},'partial'],['qbStats','qb',{scores:1,teams:32,qb:2},'partial'],
  ['rankings','rankings',{scores:1,teams:32,qb:2},'partial'],
])test(`failure in ${name} is reported without losing already achieved counts`,async()=>{
  const h=harness({overrides:{[name]:async()=>{throw Error('Erreur ciblée');}}});await h.run();
  assert.equal(h.state.status,status);assert.deepEqual(h.state.error,{step:failedStep,message:'Erreur ciblée'});
  assert.deepEqual(h.state.completed,completed);assert.equal(h.events.at(-1).name,name);assert.equal(h.ref.current,false);
  if(failedStep)assert.equal(h.state.stepStates[failedStep].status,'error');
});

test('every importer issue is visible at its own step; later failure preserves those warnings',async()=>{
  const h=harness({overrides:{scores:async()=>({updated:1,warnings:['ESPN 503'],pending:3}),teams:async()=>({updated:31,notMatched:['Jets']}),qb:async()=>({updated:1,notFound:['QB A']}),qbStats:async()=>({updated:4,notFound:['QB B']}),rankings:async()=>{throw Error('Conflit 409');}}});
  await h.run();assert.equal(h.state.status,'partial');assert.equal(h.state.warnings.length,4);
  for(const step of ['scores','teams','qb'])assert.equal(h.state.stepStates[step].status,'partial');
  assert.equal(h.state.completed.teams,31);assert.equal(h.state.completed.qb,1);assert.equal(h.state.details.qbStats,4);
});

test('before/in games are legitimate pending results and do not create partial success',async()=>{
  const h=harness({changedGames:[],overrides:{scores:async()=>({updated:0,changedGames:[],pending:16}),qb:async()=>({updated:0,pending:2,notFound:[]}),qbStats:async()=>({updated:0,pending:16,notFound:[]})}});
  await h.run();assert.equal(h.state.status,'success');assert.deepEqual(h.state.warnings,[]);
  assert.equal(h.state.completed.scores,0);assert.equal(h.state.stepStates.scores.pending,16);
  assert.equal(h.events.some(e=>e.name==='rankings'),true);
});

test('unavailable sources with no achieved results end in error while retaining their zero counts and issues',async()=>{
  const h=harness({overrides:{
    scores:async()=>({updated:0,changedGames:[],warnings:['ESPN 503']}),
    teams:async()=>({updated:0,notMatched:['Équipes indisponibles']}),
    qb:async()=>({updated:0,notFound:['QB indisponible']}),
    qbStats:async()=>({updated:0,notFound:['Stats indisponibles']}),
    rankings:async()=>({...publication,updated:0,publication:{changed:false},warnings:['Publication incomplète']}),
  }});
  await h.run();assert.equal(h.state.status,'error');
  assert.deepEqual(h.state.completed,{scores:0,teams:0,qb:0,rankings:0});
  assert.equal(h.state.details.qbStats,0);assert.equal(h.state.warnings.length,5);
});

for(const warnings of [[],['ESPN indisponible']])test(`zero results followed by a fatal error remain error, with ${warnings.length} prior warning`,async()=>{
  const h=harness({overrides:{scores:async()=>({updated:0,changedGames:[],pending:2,warnings}),teams:async()=>{throw Error('Équipes indisponibles');}}});
  await h.run();assert.equal(h.state.status,'error');assert.deepEqual(h.state.completed,{scores:0});
  assert.deepEqual(h.state.warnings,warnings);assert.equal(h.state.error.step,'teams');
});

test('legitimate pregame zero results and healthy team updates still succeed',async()=>{
  const h=harness({overrides:{
    scores:async()=>({updated:0,changedGames:[],pending:16,warnings:[]}),
    qb:async()=>({updated:0,pending:2,notFound:[]}),
    qbStats:async()=>({updated:0,pending:16,notFound:[]}),
    rankings:async()=>({...publication,updated:0,publication:{changed:false}}),
  }});
  await h.run();assert.equal(h.state.status,'success');
  assert.deepEqual(h.state.completed,{scores:0,teams:32,qb:0,rankings:0});assert.deepEqual(h.state.warnings,[]);
});

test('successful independent QB stats count as achieved results if publication later fails',async()=>{
  const h=harness({overrides:{
    scores:async()=>({updated:0,changedGames:[],warnings:[]}),teams:async()=>({updated:0,notMatched:[]}),
    qb:async()=>({updated:0,notFound:[]}),qbStats:async()=>({updated:5,notFound:[]}),
    rankings:async()=>{throw Error('Publication indisponible');},
  }});
  await h.run();assert.equal(h.state.status,'partial');assert.equal(h.state.details.qbStats,5);
  assert.deepEqual(h.state.completed,{scores:0,teams:0,qb:0});
});

test('notification failures are partial; scheduled, no-subscription and baseline results are informative',async()=>{
  const failed=harness({overrides:{rankings:async()=>({...publication,notifications:{sent:2,failed:1}})}});
  await failed.run();assert.equal(failed.state.status,'partial');assert.equal(failed.state.details.notifications,2);
  assert.equal(failed.state.stepStates.rankings.status,'partial');assert.match(failed.state.warnings[0],/notification/);
  for(const result of [
    {...publication,notifications:{sent:0,failed:0,scheduled:2}},
    {...publication,publication:{changed:false,baseline:true},notifications:{sent:0,failed:0,noSubscription:3}},
  ]){
    const h=harness({overrides:{rankings:async()=>result}});await h.run();assert.equal(h.state.status,'success');
    assert.ok(h.state.details.notificationNote);
  }
});

test('double click cannot interleave progress; retry starts cleanly after an error',async()=>{
  const wait=deferred(),h=harness({overrides:{scores:()=>wait.promise}});
  const first=h.run();await flush();await h.run();assert.equal(h.events.filter(e=>e.name==='settings').length,1);
  wait.resolve({updated:0,changedGames:[]});await first;
  let fail=true;const retry=harness({overrides:{teams:async()=>{if(fail)throw Error('once');return {updated:0,notMatched:[]};}}});
  await retry.run();fail=false;const before=retry.states.length;await retry.run();
  assert.deepEqual(retry.states[before].completed,{});assert.equal(retry.states[before].error,null);assert.equal(retry.state.status,'success');
});

test('responsive CSS keeps bounded columns and respects reduced motion',()=>{
  assert.match(css,/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 350px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});
