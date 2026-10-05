export const NOTIFICATION_TYPES={qb_turn:'Tour du joueur',qb_final:'Passer Rating final',rankings_updated:'Classements mis à jour',rankings_update:'Classements mis à jour',regular_five_hour:'Rappel du tour du joueur',playoff_open:'Ouverture de ronde',playoff_h24:'Rappel H−24',playoff_morning:'Rappel à 08:30',test:'Notification de test'};
export const isPlayoffs=type=>String(type).startsWith('playoff_');
export function torontoDate(value){
 if(!value||!Number.isFinite(Date.parse(value)))return 'Date indisponible';
 return new Intl.DateTimeFormat('fr-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value));
}
function safeFailureReason(value){
 const codes=String(value||'').match(/^Échec transport push \(statut ([0-9, inconu]+)\)/)?.[1]?.split(', ')||[];
 if(codes.some(c=>c==='404'||c==='410'))return 'Au moins un abonnement a expiré ou a été retiré. Certaines tentatives n’ont pas été acceptées.';
 return 'Une ou plusieurs tentatives ont échoué ou leur acceptation n’a pas été confirmée.';
}
const count=n=>Number.isInteger(n)&&n>=0?n:null;
// Explicit projections only: never spread DB records, subscriptions or provider errors.
export function logRows(events,deliveries,users,scope,filter='all'){
 const names=new Map(users.map(u=>[u.id,u.display_name||u.real_name||'Joueur']));
 const recipient=id=>id?(names.get(id)||'Joueur indisponible'): 'Destinataire inconnu';
 const relevant=type=>(scope==='playoffs')===isPlayoffs(type);
 const queuedEvents=new Map(events.filter(e=>relevant(e.notification_type)).map(e=>[`${e.event_key}:${e.user_id}`,e]));
 const observed=new Set(deliveries.map(d=>`${d.event_key}:${d.user_id}`));
 const rows=deliveries.filter(d=>relevant(d.notification_type)).map(d=>{
  const event=d.event_key?queuedEvents.get(`${d.event_key}:${d.user_id}`):null;
  const accepted=count(d.accepted_count),failed=count(d.failed_count),attempts=count(d.attempted_count);
  const complete=!!d.completed_at&&accepted!==null&&failed!==null&&attempts===accepted+failed;
  const state=!complete?(d.failure_reason?'interrupted':d.attempted_at?'unknown':'preparing'):accepted&&failed?'partial':failed?'failed':accepted?'accepted':'not_sent';
  return {id:`delivery:${d.id}`,type:NOTIFICATION_TYPES[d.notification_type]||'Autre notification',
   date:d.created_at,state,recipient:recipient(d.user_id),recipientCount:d.user_id?1:null,
   accepted:complete?accepted:null,failed:complete?failed:null,attempts:complete?attempts:null,
   title:d.title||null,body:d.body||null,recordedAt:d.created_at||null,queuedAt:null,scheduledAt:event?.scheduled_for||null,attemptedAt:d.attempted_at||null,acceptedAt:d.accepted_at||null,
   reason:state==='interrupted'?'Traitement interrompu ; résultat global non confirmé.':failed?safeFailureReason(d.failure_reason):null};
 });
 for(const e of events){
  if(!relevant(e.notification_type)||observed.has(`${e.event_key}:${e.user_id}`))continue;
  // Legacy "sent" means at least one acceptance, never an exact device/user count.
  const state=e.reminder_cancelled_at?'cancelled':e.sent_at||e.status==='sent'?'legacy_sent':e.status==='no_subscription'?'legacy_not_sent':e.reminder_attempted_at?'unknown':e.scheduled_for?'queued':'recorded';
  rows.push({id:`event:${e.event_key}`,type:NOTIFICATION_TYPES[e.notification_type]||'Autre notification',date:e.sent_at||e.reminder_attempted_at||e.scheduled_for||null,state,
   recipient:recipient(e.user_id),recipientCount:e.user_id?1:null,accepted:null,failed:null,attempts:null,title:null,body:null,
   queuedAt:e.created_at||null,scheduledAt:e.scheduled_for||null,attemptedAt:e.reminder_attempted_at||null,acceptedAt:e.sent_at||null,reason:null});
 }
 return rows.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).filter(r=>filter==='all'||filter==='sent'&&['accepted','partial','legacy_sent'].includes(r.state)||filter==='failed'&&['failed','partial','interrupted'].includes(r.state)).slice(0,50);
}
export const STATE_LABELS={accepted:'Acceptée par le fournisseur',partial:'Partiellement acceptée',failed:'Échec / acceptation non confirmée',not_sent:'Non envoyée · aucune tentative',preparing:'Préparation · issue inconnue',unknown:'Tentative / issue inconnue',interrupted:'Traitement interrompu',legacy_sent:'Envoyée · détail historique indisponible',legacy_not_sent:'Non envoyée · détail indisponible',queued:'Mise en file',recorded:'Événement enregistré · issue inconnue',cancelled:'Annulée'};
