import {createClient} from '@supabase/supabase-js';
import {loadLifecycle,regularIsOpen} from '../../../../lib/lifecycle/context.mjs';
import {deliverRankingEvents} from '../../../../lib/notifications/rankingDelivery.mjs';
import {sendRegularPushToUser} from '../../../../lib/pushNotifications';
export const runtime='nodejs';
export const dynamic='force-dynamic';

// Delivery/recovery only. Publishing is atomic with weekly_scores in the Admin RPC.
export async function POST(request) {
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return Response.json({error:'Non autorisé'},{status:401});
 try {
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await client.auth.getUser(token);
  if(auth.error||!auth.data?.user)return Response.json({error:'Session invalide'},{status:401});
  const profile=await client.from('users').select('is_admin').eq('id',auth.data.user.id).maybeSingle();
  if(profile.error)throw profile.error;
  if(profile.data?.is_admin!==true)return Response.json({error:'Administrateur requis'},{status:403});
  const context=await loadLifecycle(client);
  if(!regularIsOpen(context))return Response.json({skipped:'regular_closed'});
  const body=await request.json();
  if(!Number.isInteger(body.week)||body.week!==context.current_week||body.season!=null&&body.season!==context.current_season)return Response.json({error:'Contexte régulier périmé.'},{status:409});
  const result=await deliverRankingEvents(client,sendRegularPushToUser,{season:context.current_season,week:body.week});
  return Response.json({success:result.failed===0,...result});
 }catch(error){console.error('[Ranking delivery]',error.message);return Response.json({error:'Envoi des classements indisponible.'},{status:500});}
}
