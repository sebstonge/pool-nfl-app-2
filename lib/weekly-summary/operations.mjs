import {loadLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
import {PublicationError,ensure} from '../regular-publication/espn.mjs';
import {verifyCompletedHistory} from './proof.mjs';
import {buildWeeklySummary,summarySource} from './data.mjs';

export const VIEWS_TABLE='regular_week_summary_views';
const missingTable=error=>['42P01','PGRST205'].includes(error?.code);

async function seen(client,userId,season,week){
  const result=await client.from(VIEWS_TABLE).select('week').eq('user_id',userId).eq('season',season).eq('week',week).maybeSingle();
  if(missingTable(result.error))return true; // Safe until the manual migration is installed.
  if(result.error)throw result.error;
  return !!result.data;
}
async function readState(client,season){
  const result=await client.rpc('regular_publication_state',{p_season:season});
  if(result.error)throw result.error;
  ensure(result.data?.settings,'Historique indisponible.');
  // Preserve the existing standings query order for ordinal ties. The season
  // publication reader orders by id, which is not the standings' order.
  const ordered=await client.from('weekly_scores').select('*').eq('season',season).order('week',{ascending:true});
  if(ordered.error)throw ordered.error;
  const normalize=rows=>JSON.stringify(rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))
    .sort((a,b)=>String(a.id).localeCompare(String(b.id))));
  ensure(Array.isArray(ordered.data)&&normalize(ordered.data)===normalize(result.data.weekly_scores),'Classement modifié pendant sa lecture.');
  return {...result.data,weekly_scores:ordered.data};
}
export async function loadWeeklySummary(client,userId,{fetcher=fetch,verify=verifyCompletedHistory}={}){
  const context=await loadLifecycle(client),season=context.current_season,week=context.current_week-1;
  if(!regularIsOpen(context)||week<1)return null;
  if(await seen(client,userId,season,week))return null;
  try{
    const state=await readState(client,season);
    if(!state.users?.includes(userId)||!state.qb_picks?.some(p=>p.user_id===userId&&p.week===week))return null;
    if(state.settings.current_week!==context.current_week||state.settings.phase!=='regular')return null;
    const proof=await verify(state,{fetcher});
    const summary=buildWeeklySummary(state,userId,proof.pointsByPick,proof.verifiedGames);
    const current=await readState(client,season);
    if(summarySource(current)!==summarySource(state))return null;
    if(await seen(client,userId,season,week))return null;
    return summary;
  }catch(error){
    if(error instanceof PublicationError)return null;
    throw error;
  }
}
export async function acknowledgeWeeklySummary(client,userId,{season,week}){
  const context=await loadLifecycle(client);
  ensure(Number.isInteger(season)&&Number.isInteger(week)&&week>=1&&week<=18&&
    (season<context.current_season||(season===context.current_season&&week<context.current_week)),
    'La semaine n’est pas encore terminée.');
  const member=await client.from('season_participants').select('user_id').eq('user_id',userId).eq('season',season).eq('confirmed',true).maybeSingle();
  if(member.error)throw member.error;
  ensure(member.data,'Participation absente.');
  const result=await client.from(VIEWS_TABLE).insert({user_id:userId,season,week});
  if(result.error&&result.error.code!=='23505')throw result.error;
}
