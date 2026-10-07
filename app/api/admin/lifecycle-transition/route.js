import {createClient} from '@supabase/supabase-js';
import {transitionToPlayoffs} from '../../../../lib/lifecycle-transition/operations.mjs';
import {RoundError} from '../../../../lib/playoffs/rounds.mjs';
import {TransitionError} from '../../../../lib/lifecycle-transition/prepare.mjs';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request){
 const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)return respond({error:'Non autorisé'},401);
 try{
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return respond({error:'Session invalide'},401);
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
  const {data:profile,error:profileError}=await admin.from('users').select('is_admin').eq('id',user.id).maybeSingle();if(profileError)throw profileError;
  if(profile?.is_admin!==true)return respond({error:'Administrateur requis'},403);
  const body=await request.json();
  if(body.confirm!==true||!Number.isInteger(body.season)||body.season<2000||body.season>9999||!Number.isSafeInteger(body.revision)||body.revision<0)return respond({error:'Confirmation, saison et révision valides requises.'},400);
  return respond(await transitionToPlayoffs(admin,{season:body.season,revision:body.revision,actor:user.id}));
 }catch(error){return respond({error:(error instanceof TransitionError||error instanceof RoundError)?error.message:'Transition refusée ou source indisponible. Aucune transition partielle.'},409);}
}
