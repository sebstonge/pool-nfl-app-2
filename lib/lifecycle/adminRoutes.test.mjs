import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requireActiveSeason} from './context.mjs';
// Execute the real handlers with local auth/database dependencies; no network.
for(const name of ['playoff-seeds','playoff-rounds'])test(`${name}: real admin accepted, ordinary user rejected, browser season rejected`,async()=>{
 const source=(await readFile(new URL(`../../app/api/admin/${name}/route.js`,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export async function POST','async function POST');
 let isAdmin=true,calls=0;
 const client={auth:{getUser:async()=>({data:{user:{id:'real-user'}}})},from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_admin:isAdmin}}),single:async()=>({data:{id:1,current_season:2026,current_week:5,phase:'regular',revision:0,regular_finalized_at:null,playoff_reminders_enabled:false}})};}};
 class RoundError extends Error {}
 const handler=new Function('NextResponse','createClient','requireActiveSeason','readPlayoffSeeds','syncPlayoffSeedsFromEspn','finalizePlayoffSeeds','manageRound','ROUNDS','RoundError',source+';return POST;')(
  {json:(body,options)=>({body,status:options?.status||200})},()=>client,requireActiveSeason,async()=>{calls++;return [];},()=>{throw Error('Unexpected mutation');},()=>{throw Error('Unexpected mutation');},async()=>{calls++;return {};},[],RoundError);
 const request=season=>({headers:{get:()=> 'Bearer local-test'},json:async()=>({action:'read',season})});
 assert.equal((await handler(request(2026))).status,200);assert.equal(calls,1);
 isAdmin=false;assert.equal((await handler(request(2026))).status,403);assert.equal(calls,1);
 isAdmin=true;assert.equal((await handler(request(2099))).status,409);assert.equal(calls,1);
});
