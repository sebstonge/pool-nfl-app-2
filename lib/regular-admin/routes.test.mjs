import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
async function harness(route){
 const h={user:{id:'verified-admin'},admin:true,authError:null,profileError:null,error:null,calls:[],tokens:[]};
 const auth={auth:{getUser:async token=>{h.tokens.push(token);return {data:{user:h.user},error:h.authError};}}};
 const service={from(table){assert.equal(table,'users');const q={select(){return q;},eq(k,v){assert.equal(k,'id');assert.equal(v,'verified-admin');return q;},maybeSingle:async()=>({data:{is_admin:h.admin},error:h.profileError})};return q;}};
 const source=await readFile(new URL(`../../app/api/admin/${route}/route.js`,import.meta.url),'utf8');
 const {code}=await swc.transform(source,{filename:'route.js',jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}});
 const operation=async(client,request)=>{assert.equal(client,service);h.calls.push(request);if(h.error)throw h.error;return {updated:2,week:8};};
 const imports=id=>{
  if(id==='@supabase/supabase-js')return {createClient:(_url,key)=>key==='anon'?auth:service};
  if(id.endsWith('/operations.mjs'))return {publishRegularWeek:operation,advanceRegularWeek:operation};
  if(id.endsWith('/pushNotifications'))return {sendRegularPushToUser:async()=>{throw Error('No transport in route auth test');}};
  throw Error('Unexpected dependency');
 };
 const exports={};new Function('require','exports','process','console',code)(imports,exports,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://local.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}},{error(){}});
 h.run=(body={season:2026,week:7,revision:2,confirm:true},token='Bearer verified-token')=>exports.POST({headers:{get:()=>token},json:async()=>body});
 return h;
}
for(const route of ['regular-week-results','regular-next-week']){
 test(`${route}: validated Admin supplies actor; browser cannot inject results or identity`,async()=>{
  const h=await harness(route),response=await h.run({season:2026,week:7,revision:2,confirm:true,actor:'forged',results:[{final_score:999}]});
  assert.equal(response.status,200);assert.deepEqual(h.tokens,['verified-token']);
  assert.deepEqual(h.calls,[{season:2026,week:7,revision:2,actor:'verified-admin'}]);
 });
 test(`${route}: missing or invalid authentication makes no business call`,async()=>{
  const h=await harness(route);assert.equal((await h.run(undefined,null)).status,401);
  h.authError=Error('bad jwt');assert.equal((await h.run()).status,401);assert.deepEqual(h.calls,[]);
 });
 test(`${route}: ordinary account cannot call business operation`,async()=>{
  const h=await harness(route);h.admin=false;assert.equal((await h.run()).status,403);assert.deepEqual(h.calls,[]);
 });
 test(`${route}: malformed context is refused before mutation`,async()=>{
  const h=await harness(route);
  for(const bad of [{},{season:2026,week:'7',revision:2,confirm:true},{season:2026,week:7,revision:-1,confirm:true}])assert.equal((await h.run(bad)).status,400);
  assert.deepEqual(h.calls,[]);
 });
 test(`${route}: stale or rejected database transaction is not returned as success`,async()=>{
  const h=await harness(route);h.error=Error('Stale regular context');const r=await h.run();assert.equal(r.status,409);assert.match((await r.json()).error,/Stale regular context/);
 });
}
test('advancement still requires the existing explicit user confirmation',async()=>{
 const h=await harness('regular-next-week');assert.equal((await h.run({season:2026,week:7,revision:2})).status,400);assert.deepEqual(h.calls,[]);
});
