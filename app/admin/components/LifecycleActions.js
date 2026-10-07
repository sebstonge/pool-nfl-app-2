'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../../lib/supabase';
import {loadLifecycle,regularIsOpen} from '../../../lib/lifecycle/context.mjs';
import {requestLifecycleAction} from '../../../lib/lifecycle/adminActions.mjs';
import styles from '../playoffs/playoffs.module.css';

function Confirmation({action,busy,onCancel,onConfirm}){
 const dialog=useRef(null),[ack,setAck]=useState(false);
 useEffect(()=>{const trigger=document.activeElement;dialog.current.showModal();return()=>trigger?.isConnected&&trigger.focus();},[]);
 const transition=action==='transition';
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby="lifecycle-confirm-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
  <h2 id="lifecycle-confirm-title">{transition?'Passer en Séries':'Publier les résultats finaux'}</h2>
  <p>{transition?'Cette action termine définitivement la saison régulière et ouvre les Séries. Elle ne peut pas être annulée.':'Cette action vérifie et publie les résultats définitifs de toute la saison régulière. Elle sera refusée si la saison est incomplète. Elle n’ouvre pas les Séries.'}</p>
  <label className={styles.ack}><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/><span>Je confirme cette action pour la saison affichée.</span></label>
  <div className={styles.actions}>
   <button className="button-secondary" disabled={busy} onClick={onCancel}>Annuler</button>
   <button className="button" disabled={busy||!ack} onClick={()=>onConfirm(ack)}>{busy?'Vérification en cours…':'Confirmer'}</button>
  </div>
 </dialog>;
}
export default function LifecycleActions(){
 const [context,setContext]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(null),[busy,setBusy]=useState(false);
 const inFlight=useRef(false);
 async function refresh(){try{setContext(await loadLifecycle(supabase));setError('');}catch(e){setError(e.message);}}
 useEffect(()=>{refresh();},[]);
 async function execute(confirmed){
  if(inFlight.current||confirmed!==true)return;
  inFlight.current=true;setBusy(true);setError('');setMessage('');
  try{
   await requestLifecycleAction(supabase,{action:pending,context,confirmed});
   if(pending==='transition'){window.location.assign('/admin/playoffs');return;}
   setMessage('Résultats finaux publiés. Leur validité sera vérifiée de nouveau au moment du passage en Séries.');
   await refresh();
  }catch(e){setError(e.message);}
  finally{inFlight.current=false;setBusy(false);setPending(null);}
 }
 return <section className="card" aria-labelledby="lifecycle-actions-title">
  <h2 id="lifecycle-actions-title">Fin de saison régulière</h2>
  <p>Saison {context?.current_season||'…'}. Une fois tous les matchs terminés, publie les résultats finaux avant de passer en Séries.</p>
  <p>La mise à jour complète habituelle reste disponible et ne publie jamais automatiquement la saison.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <div className={styles.actions}>
   <button className="button-secondary" disabled={busy||!context||!regularIsOpen(context)} onClick={()=>setPending('publish')}>Publier les résultats finaux</button>
   <button className="button" disabled={busy||!context||!regularIsOpen(context)} onClick={()=>setPending('transition')}>PASSER EN SÉRIES</button>
   <button className="button-secondary" disabled={busy} onClick={refresh}>Actualiser le contexte</button>
  </div>
  {pending&&<Confirmation action={pending} busy={busy} onCancel={()=>setPending(null)} onConfirm={execute}/>}
 </section>;
}
