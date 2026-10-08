import {regularEventKey} from '../seasons/regularClient.mjs';
import {regularOrder} from './regularOrder.mjs';
export const TIME_ZONE='America/Toronto';
export const REMINDER_TYPES=['regular_five_hour','playoff_open','playoff_h24','playoff_morning'];
export function localParts(time){
 return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
export function localTime(parts){
 const target=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,0);
 let candidate=target;
 // Resolve wall clock with IANA offsets on the target day (DST included).
 for(let i=0;i<3;i++){const p=localParts(candidate);candidate+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
 return candidate;
}
export function morning(time){return localTime({...localParts(time),hour:8,minute:30});}
export function regularDue(activatedAt){
 const due=Date.parse(activatedAt)+5*3600000,p=localParts(due);
 if(p.hour>=22){const tomorrow=new Date(Date.UTC(p.year,p.month-1,p.day+1));return localTime({year:tomorrow.getUTCFullYear(),month:tomorrow.getUTCMonth()+1,day:tomorrow.getUTCDate(),hour:8,minute:30});}
 return p.hour<8||p.hour===8&&p.minute<30?morning(due):due;
}
export function quietNow(now){const p=localParts(now);return p.hour>=22||p.hour<8||p.hour===8&&p.minute<30;}
function completeGames(games,picks,userId){return games.length>0&&games.every(g=>picks.some(p=>p.user_id===userId&&p.game_id===g.id&&[g.home_team,g.away_team].includes(p.picked_team)&&Number.isInteger(p.predicted_spread)&&p.predicted_spread>=0));}
export function regularCandidate(data){
 const {week,players,games,picks,qbPicks,previousScores,startedAt}=data;
 const order=regularOrder(players,week,previousScores),index=order.findIndex(p=>!qbPicks.some(q=>q.user_id===p.id));
 if(index<0||!games.length)return null;
 const preceding=order.slice(0,index);
 if(preceding.some(p=>!completeGames(games,picks,p.id)))return null;
 // Latest preceding completion: no timestamp based on the cron execution itself.
 const stamps=[startedAt,...preceding.flatMap(p=>[
   qbPicks.find(q=>q.user_id===p.id)?.created_at,
   ...picks.filter(x=>x.user_id===p.id&&games.some(g=>g.id===x.game_id)).map(x=>x.updated_at||x.created_at),
 ])];
 if(stamps.some(s=>!Number.isFinite(Date.parse(s))))return null;
 return {userId:order[index].id,activatedAt:new Date(Math.max(...stamps.map(Date.parse))).toISOString()};
}
export function firstKickoff(games){
 const real=games.filter(g=>/^\d+$/.test(String(g.external_game_id||'')));
 if(!real.length||real.some(g=>!Number.isFinite(Date.parse(g.game_date))))return null;
 return Math.min(...real.map(g=>Date.parse(g.game_date)));
}
export function playoffComplete(data,round,userId){
 const games=data.playoffGames.filter(g=>g.round_id===round.id);
 const qb=data.playoffQB.find(p=>p.round_id===round.id&&p.user_id===userId);
 return !!qb&&!!data.paths.find(p=>p.round_id===round.id&&p.user_id===userId)&&completeGames(games,data.playoffPicks,userId)&&
   (round.round_key!=='super_bowl'||Number.isInteger(qb.super_bowl_total)&&qb.super_bowl_total>=0);
}
export function plannedReminders(data){
 const planned=[],regular=regularCandidate(data.regular);
 if(regular){
  const cycle=data.regular.startedAt;
  planned.push({event_key:regularEventKey(data.regular.season,`regular-5h-${data.regular.week}-${regular.userId}`),user_id:regular.userId,season:data.regular.season,week:data.regular.week,notification_type:'regular_five_hour',scheduled_for:new Date(regularDue(regular.activatedAt)).toISOString(),reminder_context:{scope:'regular',cycle,activated_at:regular.activatedAt}});
 }
 for(const round of data.rounds.filter(r=>r.status==='open'&&r.reminder_opened_at)){
  const kickoff=firstKickoff(data.playoffGames.filter(g=>g.round_id===round.id));if(kickoff===null)continue;
  for(const [type,due] of [['playoff_h24',kickoff-24*3600000],['playoff_morning',morning(kickoff)]]){
   if(due<Date.parse(round.reminder_opened_at)||due>=kickoff)continue;
   for(const player of data.regular.players)planned.push({event_key:`${type}-${round.id}-${player.id}`,user_id:player.id,week:null,notification_type:type,scheduled_for:new Date(due).toISOString(),reminder_context:{scope:'playoffs',round_id:round.id,kickoff:new Date(kickoff).toISOString()}});
  }
 }
 return planned;
}
export function reminderEligible(event,data,now){
 if(event.reminder_attempted_at||event.reminder_cancelled_at||event.sent_at||Date.parse(event.scheduled_for)>now)return false;
 if(!data.regular.players.some(p=>p.id===event.user_id))return false;
 if(event.notification_type==='regular_five_hour'){
  const c=regularCandidate(data.regular);
  return event.season===data.regular.season&&!quietNow(now)&&event.week===data.regular.week&&event.reminder_context.cycle===data.regular.startedAt&&c?.userId===event.user_id&&
    regularDue(c.activatedAt)<=now&&data.regular.games.every(g=>Date.parse(g.game_date)>now);
 }
 const round=data.rounds.find(r=>r.id===event.reminder_context.round_id);
 if(!round||round.status!=='open')return false;
 const games=data.playoffGames.filter(g=>g.round_id===round.id),kickoff=firstKickoff(games);
 if(kickoff===null||kickoff<=now||games.some(g=>['in','post'].includes(g.game_status)))return false;
 if(event.notification_type==='playoff_open')return true;
 const due=event.notification_type==='playoff_h24'?kickoff-24*3600000:morning(kickoff);
 return due<=now&&due>=Date.parse(round.reminder_opened_at)&&!playoffComplete(data,round,event.user_id);
}
export function reminderMessage(event){
 if(event.notification_type==='regular_five_hour')return {title:'⏰ Rappel : c’est à ton tour',body:`Tes choix de la semaine ${event.week} sont toujours attendus.`,url:'/matchs'};
 return {title:event.notification_type==='playoff_open'?'🏈 Les choix des séries sont ouverts':'⏰ Rappel : tes choix des séries',body:event.notification_type==='playoff_open'?'La ronde est ouverte. Soumets ton QB, ton parcours et tes choix.':event.notification_type==='playoff_h24'?'Le premier match de la ronde approche. Pense à soumettre tes choix.':'Dernier rappel : soumets tes choix avant le premier match de la ronde aujourd’hui.',url:'/series/matchs'};
}
