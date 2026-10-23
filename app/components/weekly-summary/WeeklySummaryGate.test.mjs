import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),React=require('react'),swc=require('next/dist/build/swc');
const source=await readFile(new URL('./WeeklySummaryGate.js',import.meta.url),'utf8');
const {code}=await swc.transform(source,{filename:'WeeklySummaryGate.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const recap={season:2026,week:5,nextWeek:6,score:{points:4.512,rank:2,participants:13},qb:{},overall:{},games:[],teams:[]};
const sessionFor=id=>({user:{id},access_token:`token-${id}`});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function surface(){
  const listeners=new Map();
  return {
    listeners,
    addEventListener(name,handler){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler);},
    removeEventListener(name,handler){listeners.get(name)?.delete(handler);if(!listeners.get(name)?.size)listeners.delete(name);},
    emit(name){for(const handler of [...listeners.get(name)||[]])handler();},
  };
}

function fixture({path='/matchs',initialSession=sessionFor('player-a')}={}){
  const states=[],refs=[],effects=[],requests=[],sessionResults=[],stateWrites=[];
  const window=surface(),document={...surface(),visibilityState:'visible'};
  let pathname=path,session=initialSession,authListener=null,unsubscribed=false;
  let stateIndex=0,refIndex=0,effectIndex=0,pendingEffects=[],dirty=false,tree=null,destroyed=false,sessionCalls=0;
  const react={
    ...React,
    useState(initial){
      const index=stateIndex++;
      if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
      return [states[index],update=>{
        const value=typeof update==='function'?update(states[index]):update;
        if(!Object.is(value,states[index])){states[index]=value;dirty=true;stateWrites.push({index,value,afterUnmount:destroyed});}
      }];
    },
    useRef(initial){return refs[refIndex++] ||= {current:initial};},
    useEffect(callback,deps){
      const index=effectIndex++,previous=effects[index];
      if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))pendingEffects.push({index,callback,deps});
    },
  };
  const supabase={auth:{
    onAuthStateChange(callback){authListener=callback;return {data:{subscription:{unsubscribe(){unsubscribed=true;authListener=null;}}}};},
    async getSession(){sessionCalls++;const value=sessionResults.length?await sessionResults.shift():session;return {data:{session:value}};},
  }};
  const fetch=(url,options={})=>{const wait=deferred();requests.push({url,options,...wait});return wait.promise;};
  function DialogStub(){return null;}
  const exports={};
  new Function('require','exports','window','document','fetch',code)(id=>
    id==='react'?react:id==='next/navigation'?{usePathname:()=>pathname}:
    id==='../../../lib/supabase'?{supabase}:id==='./WeeklySummaryDialog'?DialogStub:require(id),
    exports,window,document,fetch,
  );
  function render(){
    if(destroyed)throw Error('Cannot render an unmounted gate');
    stateIndex=refIndex=effectIndex=0;pendingEffects=[];dirty=false;
    tree=exports.default();
    for(const {index,callback,deps} of pendingEffects){effects[index]?.cleanup?.();effects[index]={deps,cleanup:callback()};}
    return tree;
  }
  async function flush(){
    for(let i=0;i<4;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&!destroyed)render();}
    return tree;
  }
  function respond(index,body={summary:null},{ok=true,status=ok?200:500}={}){
    assert.ok(requests[index],`Request ${index} exists`);
    requests[index].resolve({ok,status,json:async()=>body});
  }
  function destroy(){if(destroyed)return;destroyed=true;for(const effect of effects)effect?.cleanup?.();}
  render();
  return {
    requests,window,document,flush,respond,destroy,stateWrites,
    get props(){return tree.props;},get sessionCalls(){return sessionCalls;},get unsubscribed(){return unsubscribed;},
    close:()=>tree.props.onClose(),
    async show(summary=recap){await flush();respond(requests.length-1,{summary});await flush();},
    async navigate(path){pathname=path;render();await flush();},
    async auth(nextSession){session=nextSession;authListener?.(nextSession?'SIGNED_IN':'SIGNED_OUT',nextSession);await flush();},
    queueSession(value){sessionResults.push(value);},
  };
}

test('only the six regular pages request a recap, including direct navigation',async()=>{
  for(const path of ['/','/matchs','/tous-les-choix','/qb-ratings','/analytics','/classements']){
    const h=fixture({path});
    try{await h.flush();assert.equal(h.requests.length,1,path);assert.equal(h.sessionCalls,1,path);}
    finally{h.destroy();}
  }
  for(const path of ['/admin','/admin/series','/series','/series/matchs','/login','/inconnue']){
    const h=fixture({path});
    try{await h.flush();assert.equal(h.requests.length,0,path);assert.equal(h.sessionCalls,0,path);assert.equal(h.props.summary,null,path);}
    finally{h.destroy();}
  }
});

test('simple display authenticates a GET and never marks the recap as seen',async()=>{
  const h=fixture();
  try{
    await h.show();
    const request=h.requests[0];
    assert.equal(request.url,'/api/weekly-summary');assert.equal(request.options.method,undefined);
    assert.deepEqual(request.options.headers,{Authorization:'Bearer token-player-a'});
    assert.equal(request.options.cache,'no-store');assert.equal(request.options.body,undefined);
    assert.ok(request.options.signal instanceof AbortSignal);assert.equal(request.options.signal.aborted,false);
    assert.deepEqual(h.props.summary,recap);assert.equal(h.props.busy,false);assert.equal(h.props.error,'');
    await h.flush();assert.equal(h.requests.length,1);
  }finally{h.destroy();}
});

test('the shared Dialog onClose posts only season/week and waits for the successful response',async()=>{
  const h=fixture();
  try{
    await h.show();const closing=h.close();await h.flush();
    assert.equal(h.requests.length,2);assert.deepEqual(h.props.summary,recap);assert.equal(h.props.busy,true);
    const post=h.requests[1];
    assert.equal(post.url,'/api/weekly-summary');assert.equal(post.options.method,'POST');
    assert.deepEqual(post.options.headers,{Authorization:'Bearer token-player-a','Content-Type':'application/json'});
    assert.deepEqual(JSON.parse(post.options.body),{season:2026,week:5});
    assert.doesNotMatch(post.options.body,/user|player-a|token/);
    // Even a received 200 must finish parsing before the gate acknowledges dismissal.
    const json=deferred();post.resolve({ok:true,status:200,json:()=>json.promise});await h.flush();
    assert.deepEqual(h.props.summary,recap);assert.equal(h.props.busy,true);
    json.resolve({ok:true});await closing;await h.flush();
    assert.equal(h.props.summary,null);assert.equal(h.props.busy,false);assert.equal(h.props.error,'');
  }finally{h.destroy();}
});

test('rapid close actions cannot send more than one acknowledgement',async()=>{
  const h=fixture();
  try{
    await h.show();const first=h.close(),second=h.close(),third=h.close();await h.flush();
    assert.equal(h.requests.filter(request=>request.options.method==='POST').length,1);
    h.respond(1,{ok:true});await Promise.all([first,second,third]);await h.flush();
    assert.equal(h.props.summary,null);
    await h.close();assert.equal(h.requests.length,2);
  }finally{h.destroy();}
});

test('the server null response stays closed after a reload and for another player with no recap',async()=>{
  const first=fixture();
  try{
    await first.show();const closing=first.close();await first.flush();first.respond(1,{ok:true});await closing;await first.flush();
    assert.equal(first.props.summary,null);
  }finally{first.destroy();}
  const reloaded=fixture();
  try{await reloaded.show(null);assert.equal(reloaded.props.summary,null);assert.equal(reloaded.requests.length,1);}
  finally{reloaded.destroy();}
  const other=fixture({initialSession:sessionFor('other-player')});
  try{await other.show(null);assert.equal(other.props.summary,null);assert.equal(other.requests.length,1);}
  finally{other.destroy();}
});

test('a session switch immediately hides the previous recap and ignores that sessions late GET',async()=>{
  const h=fixture();
  try{
    await h.show();h.window.emit('focus');await h.flush();assert.equal(h.requests.length,2);
    await h.auth(sessionFor('player-b'));
    assert.equal(h.props.summary,null);assert.equal(h.requests[1].options.signal.aborted,true);
    assert.equal(h.requests.length,3);assert.equal(h.requests[2].options.headers.Authorization,'Bearer token-player-b');
    h.respond(1,{summary:{...recap,week:4}});await h.flush();assert.equal(h.props.summary,null);
    const next={...recap,score:{points:1.234,rank:9,participants:13}};
    h.respond(2,{summary:next});await h.flush();assert.deepEqual(h.props.summary,next);
  }finally{h.destroy();}
});

test('logout clears the visible recap and aborts any pending refresh without requesting as a guest',async()=>{
  const h=fixture();
  try{
    await h.show();h.window.emit('focus');await h.flush();
    await h.auth(null);assert.equal(h.props.summary,null);assert.equal(h.requests[1].options.signal.aborted,true);
    assert.equal(h.requests.length,2);
    h.respond(1,{summary:recap});await h.flush();assert.equal(h.props.summary,null);
  }finally{h.destroy();}
});

test('a GET started before dismissal cannot reopen the dialog after the POST succeeds',async()=>{
  const h=fixture();
  try{
    await h.show();h.window.emit('focus');await h.flush();assert.equal(h.requests.length,2);
    const closing=h.close();await h.flush();assert.equal(h.requests.length,3);
    h.respond(2,{ok:true});await closing;await h.flush();assert.equal(h.props.summary,null);
    h.respond(1,{summary:recap});await h.flush();assert.equal(h.props.summary,null);
    h.window.emit('focus');await h.flush();assert.equal(h.requests.length,4);
    h.respond(3,{summary:null});await h.flush();assert.equal(h.props.summary,null);
  }finally{h.destroy();}
});

test('a failed acknowledgement keeps the dialog open and the same close action can retry',async()=>{
  const h=fixture();
  try{
    await h.show();const first=h.close();await h.flush();
    h.respond(1,{error:'Enregistrement indisponible. Réessaie.'},{ok:false,status:503});await first;await h.flush();
    assert.deepEqual(h.props.summary,recap);assert.equal(h.props.busy,false);assert.match(h.props.error,/Réessaie/);
    const retry=h.close();await h.flush();assert.equal(h.props.error,'');assert.equal(h.props.busy,true);
    assert.deepEqual(JSON.parse(h.requests[2].options.body),{season:2026,week:5});
    h.respond(2,{ok:true});await retry;await h.flush();assert.equal(h.props.summary,null);assert.equal(h.props.busy,false);
  }finally{h.destroy();}
});

test('an expired session cannot acknowledge a recap with the previous players credentials',async()=>{
  const h=fixture();
  try{
    await h.show();h.queueSession(sessionFor('different-player'));
    await h.close();await h.flush();
    assert.equal(h.requests.length,1);assert.deepEqual(h.props.summary,recap);
    assert.match(h.props.error,/Session expirée/);assert.equal(h.props.busy,false);
  }finally{h.destroy();}
});

test('focus and visibility refreshes are deduplicated and unmount removes listeners and aborts requests',async()=>{
  const h=fixture();
  try{
    await h.flush();const initial=h.requests[0];h.window.emit('focus');await h.flush();assert.equal(h.requests.length,1);
    h.respond(0,{summary:recap});await h.flush();
    h.document.visibilityState='hidden';h.window.emit('focus');h.document.emit('visibilitychange');await h.flush();assert.equal(h.requests.length,1);
    h.document.visibilityState='visible';h.document.emit('visibilitychange');await h.flush();assert.equal(h.requests.length,2);
    assert.equal(h.window.listeners.get('focus').size,1);assert.equal(h.document.listeners.get('visibilitychange').size,1);
    h.destroy();assert.equal(h.unsubscribed,true);assert.equal(initial.options.signal.aborted,true);
    assert.equal(h.requests[1].options.signal.aborted,true);assert.equal(h.window.listeners.size,0);assert.equal(h.document.listeners.size,0);
    h.respond(1,{summary:{...recap,week:4}});await h.flush();
    assert.equal(h.stateWrites.some(write=>write.afterUnmount),false);
  }finally{h.destroy();}
});

test('navigation out of regular pages hides the recap, aborts refresh and detaches focus handlers',async()=>{
  const h=fixture();
  try{
    await h.show();const initial=h.requests[0];await h.navigate('/series/matchs');
    assert.equal(h.props.summary,null);assert.equal(initial.options.signal.aborted,true);
    assert.equal(h.window.listeners.size,0);assert.equal(h.document.listeners.size,0);
    h.window.emit('focus');await h.flush();assert.equal(h.requests.length,1);
    await h.navigate('/classements');assert.equal(h.requests.length,2);
    h.respond(1,{summary:null});await h.flush();assert.equal(h.props.summary,null);
  }finally{h.destroy();}
});
