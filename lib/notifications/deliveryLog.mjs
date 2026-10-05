// Observability only: never retry, block or change the existing transport outcome.
export async function observeDelivery(client,options,send,{now=()=>new Date().toISOString()}={}) {
 const meta=options.notificationLog;
 if(!meta)return send(async()=>{});
 let id=null,attempted=false;
 const safely=async operation=>{try{const result=await operation();if(result?.error)throw result.error;return result;}catch{console.error('[Notification log] Télémétrie indisponible.');return null;}};
 const created=await safely(()=>client.from('push_notification_deliveries').insert({
  event_key:meta.eventKey||null,user_id:options.userId,
  scope:meta.type.startsWith('playoff_')?'playoffs':'regular',notification_type:meta.type,
  title:options.title||'Pool NFL 🏈',body:options.body||'Nouvelle notification',
 }).select('id').single());
 id=created?.data?.id;
 const update=values=>id?safely(()=>client.from('push_notification_deliveries').update(values).eq('id',id)):null;
 const onAttempt=async()=>{if(attempted)return;attempted=true;await update({attempted_at:now()});};
 try {
  const result=await send(onAttempt);
  const accepted=result.results.filter(r=>r.success===true).length;
  const failed=result.results.filter(r=>r.success===false).length;
  const codes=[...new Set(result.results.filter(r=>!r.success).map(r=>Number.isInteger(r.statusCode)?String(r.statusCode):'inconnu'))];
  await update({...(result.results.length?{}:{attempted_at:null}),completed_at:now(),accepted_at:accepted?now():null,attempted_count:result.results.length,accepted_count:accepted,failed_count:failed,
   failure_reason:failed?`Échec transport push (statut ${codes.join(', ')}). Résultat fournisseur non confirmé pour ces appareils.`:null});
  return result;
 }catch(error){
  await update({completed_at:now(),failure_reason:'Traitement interrompu ; résultat global non confirmé.'});
  throw error;
 }
}
