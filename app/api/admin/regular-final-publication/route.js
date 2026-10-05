import {createClient} from '@supabase/supabase-js';
import {publishFinalRegular} from '../../../../lib/regular-publication/operations.mjs';
export const runtime='nodejs';
export const maxDuration=60;
// Separate explicit action; ordinary/live Admin updates are unchanged.
export async function POST(request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return Response.json({error:'Non autorisé'},{status:401});
 try{
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return Response.json({error:'Session invalide'},{status:401});
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
  const {data:profile,error:profileError}=await admin.from('users').select('is_admin').eq('id',user.id).maybeSingle();if(profileError)throw profileError;
  if(profile?.is_admin!==true)return Response.json({error:'Administrateur requis'},{status:403});
  const body=await request.json();
  if(body.confirm!==true||!Number.isInteger(body.season)||!Number.isSafeInteger(body.revision)||body.revision<0)return Response.json({error:'Confirmation, saison et révision requises.'},{status:400});
  return Response.json(await publishFinalRegular(admin,{season:body.season,revision:body.revision,actor:user.id}));
 }catch(error){console.error('[Regular final publication]',error.message);return Response.json({error:'Publication finale refusée ou source indisponible. Consulte les journaux administrateur.'},{status:409});}
}
