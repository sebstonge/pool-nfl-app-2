'use client';
import {useEffect,useState} from 'react';
import {supabase} from '../../../lib/supabase';
import {STATE_LABELS,torontoDate} from '../../../lib/notifications/adminLog.mjs';
import styles from './NotificationLog.module.css';
export const DISPLAY_STATES={accepted:'Envoyée',legacy_sent:'Envoyée',partial:'Envoi partiel',failed:'Échec',interrupted:'Échec',not_sent:'Non envoyée',legacy_not_sent:'Non envoyée',cancelled:'Annulée',preparing:'En attente',queued:'En attente',recorded:'Statut inconnu',unknown:'Statut inconnu'};
export default function NotificationLog({scope='regular'}){
 const [filter,setFilter]=useState('all'),[refresh,setRefresh]=useState(0),[data,setData]=useState(null),[error,setError]=useState('');
 const [visible,setVisible]=useState(5);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');setVisible(5);
  (async()=>{
   try{
    const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Session expirée.');
    const response=await fetch(`/api/admin/notification-log?scope=${scope}&filter=${filter}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Journal indisponible.');
    if(!controller.signal.aborted)setData(result);
   }catch(e){if(!controller.signal.aborted)setError(e.message);}
  })();return ()=>controller.abort();
 },[scope,filter,refresh]);
 return <section className={`card ${styles.log}`}>
  <div className={styles.heading}><h2>🔔 Journal des notifications</h2><button type="button" className="button-secondary" onClick={()=>setRefresh(v=>v+1)}>Actualiser</button></div>
  <p className={styles.note}>Heure de Toronto</p>
  {scope==='playoffs'&&data&&!data.playoffRemindersEnabled&&<p className={styles.notice}>Les rappels Séries sont désactivés.</p>}
  {data&&!data.telemetryAvailable&&<p className={styles.notice}>Historique disponible. La nouvelle télémétrie n’est pas encore installée ; les nombres d’envois historiques restent inconnus.</p>}
  <label className={styles.filter}>Afficher <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Toutes</option><option value="sent">Envoyées / acceptées</option><option value="failed">Échecs</option></select></label>
  {error?<p role="alert">{error}</p>:!data?<p role="status">Chargement du journal…</p>:!data.rows.length?<p>Aucune notification à afficher.</p>:<div className={styles.rows}>{data.rows.slice(0,visible).map(row=><details key={row.id} className={styles.row}>
   <summary><span><strong>{row.recipient} — {row.type}</strong><span className={styles.note}>{torontoDate(row.date)} · <span className={`${styles.state} ${['failed','partial','interrupted'].includes(row.state)?styles.failure:''}`}>{DISPLAY_STATES[row.state]||'Statut inconnu'}</span></span></span></summary>
   <div className={styles.detail}>
    <p>{STATE_LABELS[row.state]}</p>
    {row.reason&&<p className={styles.failure}>{row.reason}</p>}
    {[[row.recordedAt,'Début du traitement'],[row.queuedAt,'Mise en file'],[row.scheduledAt,'Envoi prévu'],[row.attemptedAt,'Tentative'],[row.acceptedAt,'Acceptation']].filter(([value])=>value).map(([value,label])=><p key={label}>{label} : {torontoDate(value)}</p>)}
    {(row.title||row.body)&&<p>{row.title&&<strong>{row.title}</strong>}{row.title&&row.body&&<br/>}{row.body}</p>}
   </div>
  </details>)}{visible<data.rows.length&&<button type="button" className="button-secondary" onClick={()=>setVisible(n=>n+5)}>Voir plus</button>}</div>}
 </section>;
}
