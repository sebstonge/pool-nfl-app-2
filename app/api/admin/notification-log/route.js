import {createClient} from '@supabase/supabase-js';
import {readAdminLog} from '../../../../lib/notifications/readAdminLog.mjs';
export const dynamic='force-dynamic';
export async function GET(request){
 const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return respond({error:'Non autorisé'},401);
 try {
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return respond({error:'Session invalide'},401);
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
  const {data:profile,error:profileError}=await admin.from('users').select('is_admin').eq('id',user.id).maybeSingle();
  if(profileError)throw profileError;if(profile?.is_admin!==true)return respond({error:'Administrateur requis'},403);
  const params=new URL(request.url).searchParams,scope=params.get('scope')||'regular',filter=params.get('filter')||'all';
  if(!['regular','playoffs'].includes(scope)||!['all','sent','failed'].includes(filter))return respond({error:'Filtre invalide'},400);
  return respond(await readAdminLog(admin,scope,filter,{remindersFlag:process.env.POOL_REMINDERS_ENABLED==='true'}));
 }catch{ return respond({error:'Journal indisponible. Réessaie plus tard.'},503); }
}
