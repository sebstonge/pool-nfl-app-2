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
const publication={updated:13,publication:{version:2,changed:true,baseline:false},notifications:{sent:0,failed:0,scheduled:0,noSubscription:2},completed:success.completed,qbStats:5,warnings:[]};

function harness({overrides={}}={}) {
  let state=null;
  const events=[],states=[],ref={current:false};
  const call=(name,result)=>async(...args)=>{events.push({name,args});return overrides[name]?overrides[name](...args):result;};
  const bindings={
    settings:{current_week:6},fullUpdateRunning:ref,setMessage:message=>events.push({name:'message',args:[message]}),
    setFullUpdateStatus:update=>{state=typeof update==='function'?update(state):update;states.push(structuredClone(state));},
    loadSettings:call('settings',currentSettings),
    requestFullUpdate:call('publish',publication),
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

test('the real handler calls the server once and displays only actual server progress',async()=>{
  const wait=deferred(),h=harness({overrides:{publish:()=>wait.promise}});
  const first=h.run();await flush();
  assert.deepEqual(h.state,{status:'running',week:7});
  await h.run();assert.equal(h.events.filter(event=>event.name==='publish').length,1);
  wait.resolve(publication);await first;
  assert.deepEqual(h.events.filter(event=>event.name!=='message').map(event=>event.name),['settings','publish','selectionStats']);
  assert.deepEqual(h.events.find(event=>event.name==='publish').args,[currentSettings]);
  assert.deepEqual(h.state.completed,success.completed);
  assert.equal(h.state.status,'success');assert.equal(h.ref.current,false);
  assert.doesNotMatch(fullUpdateSource,/\/api\/push\/rankings-updated|fetch\(/);
});

test('provider warnings and notification issues retain the committed counts',async()=>{
  const h=harness({overrides:{publish:async()=>({...publication,warnings:['ESPN 503'],notifications:{sent:2,failed:1,scheduled:2}})}});
  await h.run();
  assert.equal(h.state.status,'partial');
  assert.deepEqual(h.state.completed,success.completed);
  assert.equal(h.state.details.qbStats,5);
  assert.equal(h.state.details.notifications,2);
  assert.match(h.state.details.notificationNote,/2 notification/);
  assert.equal(h.state.warnings.length,2);
});

test('a conflict reports failure without invented counts and a retry starts cleanly',async()=>{
  let first=true;
  const h=harness({overrides:{publish:async()=>{if(first)throw Error('Conflit côté serveur');return publication;}}});
  await h.run();
  assert.equal(h.state.status,'error');assert.equal(h.state.completed,undefined);
  assert.equal(h.state.error.message,'Conflit côté serveur');
  first=false;await h.run();assert.equal(h.state.status,'success');
  assert.equal(h.ref.current,false);
});

test('responsive CSS keeps bounded columns and respects reduced motion',()=>{
  assert.match(css,/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 350px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
});
