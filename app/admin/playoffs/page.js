'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { snapshotState, confirmationRequest, requestSnapshot } from './snapshotAdmin.mjs';
import styles from './playoffs.module.css';
const season = 2026;
function date(value) {
  return value ? new Date(value).toLocaleString('fr-CA',{dateStyle:'long',timeStyle:'short'}) : '—';
}
function Logo({ team }) {
  const [failed,setFailed]=useState(false);
  const src=team?.espn_abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png` : team?.logo;
  return src && !failed ? <img src={src} alt="" onError={()=>setFailed(true)} /> : <span aria-hidden="true">🏈</span>;
}
function ConfirmDialog({ pending, busy, error, onCancel, onConfirm }) {
  const ref=useRef(null);
  const [ack,setAck]=useState(false);
  useEffect(()=>{const trigger=document.activeElement;ref.current.showModal();return ()=>trigger?.isConnected && trigger.focus();},[]);
  const final=pending.action==='finalize';
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="confirmation-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
    <h2 id="confirmation-title">{final?'Finaliser les seeds':'Actualiser depuis ESPN'}</h2>
    {final ? <><p>Cette action est irréversible : elle fige les 14 seeds et bloque toute future synchronisation ESPN.</p><p>Capture examinée : {date(pending.state.capturedAt)}.</p>
      <label className={styles.ack}><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)} />Je confirme que la saison régulière NFL {season} est terminée et que j’ai vérifié les 14 seeds.</label></>
      : <p>Les standings ESPN peuvent encore être provisoires. Le snapshot existant sera remplacé et sa date de capture changera. Cette action ne finalise pas les playoffs.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>Annuler</button>
      <button type="button" className="button" disabled={busy || (final && !ack)} onClick={()=>onConfirm(final ? ack : true)}>{busy?'En cours…':final?'Confirmer la finalisation':'Confirmer l’actualisation'}</button></div>
  </dialog>;
}
// Injectable transport for local visual tests; production always uses the protected API.
export function PlayoffsAdminView({ request, teams=[] }) {
  const [rows,setRows]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
  const inFlight=useRef(false);
  useEffect(()=>{let active=true;request({action:'read',season}).then(next=>{if(active)setRows(next);}).catch(e=>{if(active)setError(e.message);});return ()=>{active=false;};},[request]);
  const state=snapshotState(rows || [],season);
  async function execute(body) {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setMessage('');
    try {const next=await request(body);setRows(next);setPending(null);setMessage(body.action==='sync'?'Snapshot provisoire actualisé depuis ESPN.':body.action==='finalize'?'Seeds finalisés et figés.':'Snapshot rechargé.');}
    catch(e){setError(`${e.message} Le snapshot affiché est conservé. Relis le snapshot avant une nouvelle tentative de finalisation.`);}
    finally {inFlight.current=false;setBusy(false);}
  }
  function open(action){setError('');setMessage('');setPending({action,state});}
  return <main className={`page ${styles.page}`}>
    <header className="header-card"><h1>Séries NFL</h1><p>Saison {season}</p><a href="/admin">← Retour à l’Admin</a></header>
    {error && !pending && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {rows===null ? <section className="card"><p>{error?'Le snapshot n’a pas pu être chargé.':'Chargement du snapshot…'}</p>{error && <button className="button-secondary" disabled={busy} onClick={()=>execute({action:'read',season})}>Réessayer</button>}</section> : <>
      <section className="card"><span className={`${styles.badge} ${state.finalized?styles.final:styles.draft}`}>{state.finalized?'FINALISÉ':state.locked?'ÉTAT INCOHÉRENT':'PROVISOIRE'}</span>
        <dl className={styles.meta}><div><dt>Capturé le</dt><dd>{date(state.capturedAt)}</dd></div>{state.finalized && <div><dt>Finalisé le</dt><dd>{date(state.finalizedAt)}</dd></div>}<div><dt>Équipes</dt><dd>{rows.length} au total · {state.conferences.map(c=>`${c.rows.length} ${c.name}`).join(' · ')}</dd></div></dl>
        {!rows.length && <p>Aucun snapshot enregistré.</p>}
        <div className={styles.actions}><button className="button" disabled={busy||state.locked} onClick={()=>open('sync')}>Actualiser depuis ESPN</button><button className="button-secondary" disabled={busy} onClick={()=>execute({action:'read',season})}>Relire le snapshot</button></div>
      </section>
      <div className={styles.conferences}>{state.conferences.map(conference=><section className="card" key={conference.name}><h2>{conference.name}</h2>{Array.from({length:7},(_,i)=>{const row=conference.rows.find(r=>r.seed===i+1);return <div className={styles.seed} key={i}><strong>#{i+1}</strong><Logo team={teams.find(t=>t.name===row?.team)} /><div><strong>{row?.team || 'À déterminer'}</strong>{i===0 && <small>BYE Wild Card{!state.finalized?' · indicatif':''}</small>}</div></div>;})}</section>)}</div>
      <section className="card"><h2>Finaliser les seeds</h2>{state.finalized ? <p>Les seeds sont désormais figés. Aucune modification ni synchronisation ESPN n’est possible.</p> : <><p>La finalisation fige les 14 seeds comme référence officielle des playoffs et empêche les futures synchronisations ESPN. Le système pourra alors utiliser ces seeds et les byes #1.</p><p>À effectuer uniquement après la fin de la saison régulière. Un snapshot provisoire n’active aucun bye dans l’arbre public.</p><button className="button-secondary" disabled={busy||!state.canFinalize} onClick={()=>open('finalize')}>Finaliser les seeds</button>{!state.canFinalize && <p>Un snapshot complet, cohérent et non finalisé est requis.</p>}</>}</section>
    </>}
    {pending && <ConfirmDialog pending={pending} busy={busy} error={error} onCancel={()=>{setPending(null);setError('');}} onConfirm={confirmed=>execute(confirmationRequest(pending.action,season,pending.state,confirmed))} />}
  </main>;
}
const request=body=>requestSnapshot(supabase,body);
export default function PlayoffsAdminPage(){
  const [teams,setTeams]=useState([]);
  useEffect(()=>{let active=true;supabase.from('teams').select('name,espn_abbr,logo').then(({data,error})=>{if(error)console.error('Logos équipes',error.message);else if(active)setTeams(data || []);});return ()=>{active=false;};},[]);
  return <PlayoffsAdminView request={request} teams={teams}/>;
}
