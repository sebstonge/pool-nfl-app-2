import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {publicPaths,publicExperience,seriesHref,adminHref} from './publicRouting.mjs';
import {requestLifecycleAction} from './adminActions.mjs';
import {TransitionError} from '../lifecycle-transition/prepare.mjs';
import {RoundError} from '../playoffs/rounds.mjs';
import {PublicationError} from '../regular-publication/espn.mjs';
const require=createRequire(import.meta.url);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const swc=require('next/dist/build/swc');
async function compiled(path,dependencies){
 const source=await readFile(new URL(path,import.meta.url),'utf8');
 const {code}=await swc.transform(source,{filename:'test.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const exports={};
 new Function('require','exports',code)(id=>{if(id==='react/jsx-runtime')return require(id);const value=dependencies(id);return value?.default?{__esModule:true,...value}:value;},exports);
 return exports;
}
for(const phase of ['regular','playoffs'])for(const path of publicPaths)test(`actual public dispatcher ${path} in ${phase}`,async()=>{
 const page=await compiled('../../app'+(path==='/'?'':path)+'/page.js',id=>{
  if(id.endsWith('publicServer'))return {loadPublicContext:async()=>({phase})};
  if(id.endsWith('publicRouting.mjs'))return {publicExperience};
  if(id.endsWith('RegularPage'))return {default:props=>React.createElement('div',null,path==='/'?props.phase:'regular')};
  if(id.endsWith('SeriesExperience'))return {default:props=>React.createElement('section',{'data-public':props.publicUrls},props.children)};
  if(id.includes('series'))return {default:()=>React.createElement('div',null,'playoffs')};
  throw Error(id);
 });
 const html=renderToStaticMarkup(await page.default());
 assert.match(html,new RegExp(phase));
 if(path!=='/'&&phase==='playoffs')assert.match(html,/data-public="true"/);
 assert.equal(page.dynamic,'force-dynamic');
});
test('canonical links and direct preview links keep all six destinations',()=>{
 for(const path of publicPaths){
  const preview=path==='/'?'/series':'/series'+path;
  assert.equal(seriesHref(preview,true),path);assert.equal(seriesHref(preview,false),preview);
 }
 assert.equal(seriesHref('/admin/playoffs',true),'/admin/playoffs');
 assert.equal(adminHref('regular'),'/admin');assert.equal(adminHref('playoffs'),'/admin/playoffs');
 assert.throws(()=>publicExperience(undefined));
});
test('actual navigation renders the same labels with canonical URLs or preview URLs',async()=>{
 for(const publicUrls of [false,true]){
  const nav=await compiled('../../app/series/components/SeriesNav.js',id=>{
   if(id==='react')return React;
   if(id==='./SeriesLinks')return {usePublicSeriesUrls:()=>publicUrls};
   if(id.endsWith('publicRouting.mjs'))return {seriesHref};
   throw Error(id);
  });
  const html=renderToStaticMarkup(React.createElement(nav.default));
  for(const path of publicPaths)assert.ok(html.includes('href="'+(publicUrls?path:path==='/'?'/series':'/series'+path)+'"'));
  assert.match(html,/bottom-nav/);assert.match(html,/QB Ratings/);
 }
});
const context={current_season:2099,revision:5};
test('confirmation and authentication required before any lifecycle POST',async()=>{
 let calls=0;const fetcher=async()=>{calls++;};
 const client={auth:{getSession:async()=>({data:{session:null}})}};
 await assert.rejects(requestLifecycleAction(client,{action:'transition',context,confirmed:false},fetcher),/Confirmation/);
 await assert.rejects(requestLifecycleAction(client,{action:'transition',context,confirmed:true},fetcher),/Connecte/);
 assert.equal(calls,0);
});
for(const action of ['publish','transition'])test('explicit '+action+' sends only trusted route inputs and preserves failures',async()=>{
 const calls=[],client={auth:{getSession:async()=>({data:{session:{access_token:'local'}}})}};
 const input={action,context,confirmed:true};
 const result=await requestLifecycleAction(client,input,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({phase:'playoffs'})};});
 assert.equal(result.phase,'playoffs');assert.equal(calls.length,1);
 assert.equal(calls[0].url,action==='publish'?'/api/admin/regular-final-publication':'/api/admin/lifecycle-transition');
 assert.deepEqual(JSON.parse(calls[0].options.body),{confirm:true,season:2099,revision:5});
 await assert.rejects(requestLifecycleAction(client,input,async()=>({ok:false,json:async()=>({error:'TEST-WC bloque la transition'})})),/TEST-WC/);
 assert.deepEqual(context,{current_season:2099,revision:5});
});
test('business errors from existing server routes are readable; nonadmin cannot call engine',async()=>{
 for(const [route,engine,ErrorType] of [
  ['lifecycle-transition','transitionToPlayoffs',RoundError],
  ['regular-final-publication','publishFinalRegular',PublicationError],
 ]){
  let admin=true,calls=0;
  const client={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_admin:admin}})}}};
  const page=await compiled('../../app/api/admin/'+route+'/route.js',id=>{
   if(id==='@supabase/supabase-js')return {createClient:()=>client};
   if(id.endsWith('operations.mjs'))return {[engine]:async()=>{calls++;throw new ErrorType('Calendrier incomplet');}};
   if(id.endsWith('rounds.mjs'))return {RoundError};
   if(id.endsWith('/espn.mjs'))return {PublicationError};
   if(id.endsWith('prepare.mjs'))return {TransitionError};
   throw Error(id);
  });
  const request={headers:{get:()=> 'Bearer test'},json:async()=>({confirm:true,season:2099,revision:5})};
  const result=await page.POST(request);assert.equal(result.status,409);assert.equal((await result.json()).error,'Calendrier incomplet');
  admin=false;assert.equal((await page.POST(request)).status,403);assert.equal(calls,1);
 }
});
test('scope: existing login, password change and bell remain; direct series layout survives',async()=>{
 const home=await readFile(new URL('../../app/RegularPage.js',import.meta.url),'utf8');
 assert.match(home,/mustChangePassword/);assert.match(home,/signInWithPassword/);assert.match(home,/handleEnableNotifications/);
 assert.match(home,/phase==='playoffs'.*!mustChangePassword\) return playoffsHome/);
 assert.match(home,/profile\?\.is_admin === true/);
 const ui=await readFile(new URL('../../app/admin/components/LifecycleActions.js',import.meta.url),'utf8');
 assert.match(ui,/confirmed!==true/);assert.match(ui,/disabled=\{busy\|\|!ack\}/);
 assert.match(ui,/window.location.assign\('\/admin\/playoffs'\)/);
 assert.match(ui,/catch\(e\)\{setError\(e.message\);\}/);
 assert.doesNotMatch(ui,/\.rpc\(|\.update\(/);
 const layout=await readFile(new URL('../../app/series/layout.js',import.meta.url),'utf8');
 assert.match(layout,/SeriesExperience/);
});
function hooks(initial=[]){
 const values=initial.slice(),refs=[];let index=0,refIndex=0;
 return {react:{...React,useEffect:()=>{},useState:initial=>{const i=index++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});}},
  render:Component=>{index=0;refIndex=0;return Component();},values};
}
function findElement(node,predicate){
 if(!node||typeof node!=='object')return null;
 if(Array.isArray(node)){for(const child of node){const found=findElement(child,predicate);if(found)return found;}return null;}
 if(predicate(node))return node;
 return findElement(node.props?.children,predicate);
}
test('actual action component: cancel/unconfirmed does nothing, error stays visible, success navigates',async()=>{
 const h=hooks([context,'','',null,false]),calls=[],navigation=[];
 let fail=true;
 const ui=await compiled('../../app/admin/components/LifecycleActions.js',id=>{
  if(id==='react')return h.react;
  if(id.endsWith('/supabase'))return {supabase:{}};
  if(id.endsWith('/context.mjs'))return {loadLifecycle:async()=>context,regularIsOpen:()=>true};
  if(id.endsWith('/adminActions.mjs'))return {requestLifecycleAction:async(_,input)=>{calls.push(input);if(fail)throw Error('Snapshot périmé');return {phase:'playoffs'};}};
  if(id.endsWith('.css'))return {default:{}};
  throw Error(id);
 });
 const render=()=>h.render(ui.default);
 globalThis.window={location:{assign:url=>navigation.push(url)}};
 try{
  let tree=render();
  findElement(tree,n=>n.type==='button'&&n.props.children==='PASSER EN SÉRIES').props.onClick();
  tree=render();let dialog=findElement(tree,n=>typeof n.type==='function');
  dialog.props.onCancel();assert.equal(h.values[3],null);assert.equal(calls.length,0);
  findElement(render(),n=>n.type==='button'&&n.props.children==='PASSER EN SÉRIES').props.onClick();
  dialog=findElement(render(),n=>typeof n.type==='function');
  await dialog.props.onConfirm(false);assert.equal(calls.length,0);
  await dialog.props.onConfirm(true);assert.equal(calls.length,1);assert.equal(navigation.length,0);
  assert.equal(findElement(render(),n=>n.props?.role==='alert').props.children,'Snapshot périmé');
  fail=false;
  findElement(render(),n=>n.type==='button'&&n.props.children==='PASSER EN SÉRIES').props.onClick();
  await findElement(render(),n=>typeof n.type==='function').props.onConfirm(true);
  assert.deepEqual(navigation,['/admin/playoffs']);assert.equal(calls[1].action,'transition');
 }finally{delete globalThis.window;}
});
for(const [name,user,profile,mustChange,expected] of [
 ['anonymous',null,null,false,false],
 ['password change',{id:'u'},{display_name:'Player',real_name:'Player'},true,false],
 ['authenticated',{id:'u'},{display_name:'Player',real_name:'Player'},false,true],
])test('actual home preserves '+name+' flow in playoffs',async()=>{
 const initial=[];initial[0]=user;initial[1]=profile;initial[10]=mustChange;
 const h=hooks(initial),marker=React.createElement('div',null,'series-marker');
 const page=await compiled('../../app/RegularPage.js',id=>{
  if(id==='react')return h.react;
  if(id.endsWith('/supabase'))return {supabase:{}};
  if(id.endsWith('/BottomNav'))return {default:()=>null};
  throw Error(id);
 });
 const tree=h.render(()=>page.default({phase:'playoffs',playoffsHome:marker}));
 assert.equal(tree===marker,expected);
 if(!expected){const html=renderToStaticMarkup(tree);assert.ok(!html.includes('series-marker'));assert.match(html,mustChange?/mot de passe/:/Se connecter/);}
});
test('server context is uncached and does not fall back to regular when authority fails',async()=>{
 let noStoreCalls=0;const row={id:1,current_season:2099,current_week:18,phase:'playoffs',revision:1,regular_finalized_at:null,playoff_reminders_enabled:false};
 const module=await compiled('./publicServer.js',id=>{
  if(id==='server-only')return {};
  if(id==='next/cache')return {unstable_noStore:()=>noStoreCalls++};
  if(id==='@supabase/supabase-js')return {createClient:()=>({})};
  if(id==='./context.mjs')return {loadLifecycle:async()=>{if(!row.phase)throw Error('unavailable');return row;}};
  throw Error(id);
 });
 assert.equal((await module.loadPublicContext()).phase,'playoffs');assert.equal(noStoreCalls,1);
 row.phase=null;await assert.rejects(module.loadPublicContext(),/unavailable/);
});
