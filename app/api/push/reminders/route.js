import {createClient} from '@supabase/supabase-js';
import {sendPushToUser} from '../../../../lib/pushNotifications';
import {processReminders} from '../../../../lib/notifications/reminderWorker.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:'Non autorisé'},{status:401});
 if(process.env.POOL_REMINDERS_ENABLED!=='true')return Response.json({enabled:false});
 try {
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  return Response.json({results:await processReminders(client,sendPushToUser)});
 }catch(error){console.error('[Pool reminders]',error.message);return Response.json({error:'Traitement des rappels indisponible.'},{status:500});}
}
