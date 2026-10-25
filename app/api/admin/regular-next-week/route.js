import {createClient} from '@supabase/supabase-js';
import {advanceRegularWeek} from '../../../../lib/regular-admin/operations.mjs';
export const runtime='nodejs';

export async function POST(request) {
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return Response.json({error:'Non autorisé'},{status:401});
  try {
    const options={auth:{persistSession:false,autoRefreshToken:false}};
    const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
    const {data:{user},error}=await auth.auth.getUser(token);
    if(error||!user)return Response.json({error:'Session invalide'},{status:401});
    const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
    const profile=await admin.from('users').select('is_admin').eq('id',user.id).maybeSingle();
    if(profile.error)throw profile.error;
    if(profile.data?.is_admin!==true)return Response.json({error:'Administrateur requis'},{status:403});
    const body=await request.json();
    if(body.confirm!==true||!Number.isInteger(body.season)||!Number.isInteger(body.week)||body.week<1||!Number.isSafeInteger(body.revision)||body.revision<0)return Response.json({error:'Confirmation et contexte régulier requis.'},{status:400});
    return Response.json(await advanceRegularWeek(admin,{season:body.season,week:body.week,revision:body.revision,actor:user.id}));
  } catch(error) {
    console.error('[Regular next week]',error.message);
    return Response.json({error:'Passage refusé : '+(error?.message||'contexte indisponible.')},{status:409});
  }
}
