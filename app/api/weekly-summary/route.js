import {createClient} from '@supabase/supabase-js';
import {loadWeeklySummary,acknowledgeWeeklySummary} from '../../../lib/weekly-summary/operations.mjs';
import {PublicationError} from '../../../lib/regular-publication/espn.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
const respond=(body,status=200)=>Response.json(body,{status,headers});

async function identity(request){
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return null;
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return null;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
  const profile=await client.from('users').select('display_name,real_name,must_change_password').eq('id',user.id).maybeSingle();
  if(profile.error)throw profile.error;
  if(!profile.data?.display_name?.trim()||!profile.data?.real_name?.trim()||profile.data.must_change_password===true)return null;
  return {client,userId:user.id};
}
export async function GET(request){
  try{
    const current=await identity(request);
    if(!current)return respond({summary:null});
    const deadline=AbortSignal.timeout(45000);
    const fetcher=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([deadline,...(options.signal?[options.signal]:[])])});
    return respond({summary:await loadWeeklySummary(current.client,current.userId,{fetcher})});
  }catch(error){
    console.error('[Weekly summary]',error.message);
    return respond({summary:null,error:'Résumé temporairement indisponible.'},503);
  }
}
export async function POST(request){
  try{
    const current=await identity(request);
    if(!current)return respond({error:'Connexion requise.'},401);
    const body=await request.json();
    if(!Number.isInteger(body.season)||!Number.isInteger(body.week))return respond({error:'Saison et semaine requises.'},400);
    await acknowledgeWeeklySummary(current.client,current.userId,body);
    return respond({seen:true});
  }catch(error){
    return respond({error:error instanceof PublicationError?error.message:'Impossible d’enregistrer la fermeture. Réessaie.'},409);
  }
}
