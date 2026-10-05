'use client';
import {useEffect,useState} from 'react';
import {supabase} from '../../../lib/supabase';
import {STATE_LABELS,torontoDate} from '../../../lib/notifications/adminLog.mjs';
import styles from './NotificationLog.module.css';
export default function NotificationLog({scope='regular'}){
 const [filter,setFilter]=useState('all'),[refresh,setRefresh]=useState(0),[data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
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
  <p className={styles.note}>50 événements récents maximum · Heure de Toronto. Les acceptations concernent les appareils, pas la lecture des messages.</p>
  {scope==='playoffs'&&data&&!data.playoffRemindersEnabled&&<p className={styles.notice}>Les rappels Séries sont désactivés.</p>}
  {data&&!data.telemetryAvailable&&<p className={styles.notice}>Historique disponible. La nouvelle télémétrie n’est pas encore installée ; les nombres d’envois historiques restent inconnus.</p>}
  <label className={styles.filter}>Afficher <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Toutes</option><option value="sent">Envoyées / acceptées</option><option value="failed">Échecs</option></select></label>
  {error?<p role="alert">{error}</p>:!data?<p role="status">Chargement du journal…</p>:!data.rows.length?<p>Aucune notification à afficher.</p>:<div className={styles.rows}>{data.rows.map(row=><details key={row.id} className={styles.row}>
   <summary><span><strong>{row.type}</strong><span className={styles.note}>{torontoDate(row.date)} · {row.recipientCount??'—'} destinataire</span></span><span><span className={styles.state}>{STATE_LABELS[row.state]}</span><span className={styles.note}>{row.accepted??'—'} acceptée(s) · {row.failed??'—'} échec(s)</span></span></summary>
   <div className={styles.detail}><p>Destinataire : {row.recipient}</p>{row.recordedAt&&<p>Début du traitement : {torontoDate(row.recordedAt)}</p>}<p>Enregistrée / mise en file : {row.queuedAt?torontoDate(row.queuedAt):'Heure indisponible'}</p><p>Envoi prévu : {row.scheduledAt?torontoDate(row.scheduledAt):'—'}</p><p>Tentative : {row.attemptedAt?torontoDate(row.attemptedAt):'Non documentée'}</p><p>Acceptation : {row.acceptedAt?torontoDate(row.acceptedAt):'Non documentée'}</p>{row.title&&<p><strong>{row.title}</strong><br/>{row.body}</p>}{row.reason&&<p>{row.reason}</p>}<p className={styles.note}>« — » signifie inconnu. Une réponse positive du fournisseur ne prouve ni la réception ni la lecture sur l’appareil.</p></div>
  </details>)}</div>}
 </section>;
}
