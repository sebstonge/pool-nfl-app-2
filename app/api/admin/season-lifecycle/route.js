import {createClient} from '@supabase/supabase-js';
import {loadLifecycle} from '../../../../lib/lifecycle/context.mjs';
import {prepareCalendar} from '../../../../lib/seasons/calendar.mjs';
export async function POST(request){
 try{
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return Response.json({error:'Connexion requise.'},{status:401});
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return Response.json({error:'Session invalide.'},{status:401});
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
  const profile=await admin.from('users').select('is_admin').eq('id',user.id).single();if(profile.error||profile.data?.is_admin!==true)return Response.json({error:'Administrateur requis.'},{status:403});
  const c=await loadLifecycle(admin),body=await request.json();
  if(body.action==='read'){
   const [seasons,members,users,games]=await Promise.all([admin.from('seasons').select('*').in('season',[c.current_season,c.current_season+1]),admin.from('season_participants').select('*').in('season',[c.current_season,c.current_season+1]),admin.from('users').select('id,display_name,real_name').order('real_name'),admin.from('games').select('week,game_date,home_score,away_score,is_pool_eligible').eq('season',c.current_season+1)]);
   for(const r of [seasons,members,users,games])if(r.error)throw r.error;
   const next=seasons.data.find(s=>s.season===c.current_season+1);
   const participants=members.data.filter(p=>p.season===c.current_season+1&&p.confirmed).sort((a,b)=>a.initial_order-b.initial_order);
   const canStart=c.phase==='offseason'&&!!next?.prepared_at&&!!next?.participants_confirmed_at&&!next.started_at&&participants.length>0&&participants.every((p,i)=>p.initial_order===i+1)&&games.data.some(g=>g.week===1&&g.is_pool_eligible)&&games.data.every(g=>Date.parse(g.game_date)>Date.now()&&g.home_score==null&&g.away_score==null);
   return Response.json({context:c,seasons:seasons.data,participants:members.data,users:users.data,canStart});
  }
  if(!['finish','prepare','participants','start'].includes(body.action)||body.confirm!==true||body.revision!==c.revision||body.season!==(body.action==='finish'?c.current_season:c.current_season+1))throw Error('Action ou contexte périmé.');
  let payload={};
  if(body.action==='prepare'){
   if(c.phase!=='offseason')throw Error('Préparation réservée à l’intersaison.');
   const teams=await admin.from('teams').select('name,espn_abbr');if(teams.error)throw teams.error;
   payload=await prepareCalendar(body.season,teams.data);
  }
  if(body.action==='participants')payload={participants:body.participants};
  const result=await admin.rpc('manage_season_lifecycle',{p_action:body.action,p_season:body.season,p_revision:body.revision,p_actor:user.id,p_payload:payload});
  if(result.error)throw result.error;
  return Response.json(result.data);
 }catch(e){return Response.json({error:e.message||'Opération refusée.'},{status:409});}
}
