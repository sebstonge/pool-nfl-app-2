import test from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewAdmin } from './previewAdmin.mjs';
function client({user={id:'admin-id'},authError=null,profile={is_admin:true},profileError=null}={}) {
  return {auth:{getUser:async()=>({data:{user},error:authError})},from(table){
    assert.equal(table,'users');const q={select(fields){assert.equal(fields,'is_admin');return q;},eq(field,id){assert.equal(field,'id');assert.equal(id,user.id);return q;},async maybeSingle(){return {data:profile,error:profileError};}};return q;
  }};
}
test('preview return requires authenticated user and explicit Admin profile',async()=>{
 assert.equal(await isPreviewAdmin(client()),true);
 for(const options of [{user:null},{authError:new Error('expired')},{profile:null},{profile:{is_admin:false}},{profile:{is_admin:'true'}},{profileError:new Error('denied')}])
  assert.equal(await isPreviewAdmin(client(options)),false);
});
test('preview check fails closed on network failure and never writes',async()=>{
 assert.equal(await isPreviewAdmin({auth:{getUser:async()=>{throw new Error('offline');}}}),false);
});
