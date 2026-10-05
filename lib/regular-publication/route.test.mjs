import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('actual publication route: server admin only, explicit action, no browser proof forwarded',async()=>{
 const source=(await readFile(new URL('../../app/api/admin/regular-final-publication/route.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export const /g,'const ').replace('export async function POST','async function POST');
 let isAdmin=true,hasUser=true,calls=[];
 const client={auth:{getUser:async()=>({data:{user:hasUser?{id:'admin'}:null}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_admin:isAdmin}})};}};
 const handler=new Function('createClient','publishFinalRegular',source+';return POST;')(()=>client,async(_,input)=>{calls.push(input);return {ok:true};});
 const request=(body,token='Bearer local')=>({headers:{get:()=>token},json:async()=>body});
 const body={confirm:true,season:2026,revision:0,proof:{forged:true}};
 assert.equal((await handler(request(body,null))).status,401);hasUser=false;assert.equal((await handler(request(body))).status,401);hasUser=true;isAdmin=false;assert.equal((await handler(request(body))).status,403);isAdmin=true;
 assert.equal((await handler(request({...body,confirm:false}))).status,400);assert.equal(calls.length,0);
 assert.equal((await handler(request(body))).status,200);assert.deepEqual(calls,[{season:2026,revision:0,actor:'admin'}]);
});
