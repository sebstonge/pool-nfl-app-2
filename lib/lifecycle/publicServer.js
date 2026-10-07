import 'server-only';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient} from '@supabase/supabase-js';
import {loadLifecycle} from './context.mjs';

// Server-only authority. No session/cookie rewrite and no cached phase.
export async function loadPublicContext(){
 noStore();
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options)=>fetch(url,{...options,cache:'no-store'})},
 });
 return loadLifecycle(client);
}
