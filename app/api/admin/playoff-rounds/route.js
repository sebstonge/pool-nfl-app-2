import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { manageRound } from '../../../../lib/playoffs/roundOperations.mjs';
import { ROUNDS, RoundError } from '../../../../lib/playoffs/rounds.mjs';

export async function POST(request) {
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return NextResponse.json({error:'Non autorisé'},{status:401});
  try {
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const options={auth:{persistSession:false,autoRefreshToken:false}};
    const auth=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
    const {data:{user},error}=await auth.auth.getUser(token);
    if(error||!user)return NextResponse.json({error:'Session invalide'},{status:401});
    const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
    const {data:profile,error:profileError}=await admin.from('users').select('is_admin').eq('id',user.id).maybeSingle();
    if(profileError)throw profileError;
    if(profile?.is_admin!==true)return NextResponse.json({error:'Accès administrateur requis'},{status:403});
    const {action,season,roundKey,confirmed}=await request.json();
    if(!Number.isInteger(season)||season<2000||season>9999||!['read','prepare','update','advance'].includes(action)||
      (action!=='read'&&!ROUNDS.some(r=>r.key===roundKey)))return NextResponse.json({error:'Action, saison ou ronde invalide'},{status:400});
    if(['prepare','advance'].includes(action)&&confirmed!==true)return NextResponse.json({error:'Confirmation requise'},{status:400});
    return NextResponse.json(await manageRound(admin,{action,season,roundKey}));
  } catch(error) {
    console.error('[Playoff rounds admin]',error.message);
    return NextResponse.json({error:error instanceof RoundError?error.message:'Données indisponibles. Réessaie ou consulte les journaux administrateur.'},{status:409});
  }
}
