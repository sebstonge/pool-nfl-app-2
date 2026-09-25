'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { ROUNDS, roundSummary } from '../../../lib/playoffs/rounds.mjs';
import styles from './playoffs.module.css';

export async function requestRound(body) {
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session)throw new Error('Connecte-toi avec un compte administrateur.');
  const response=await fetch('/api/admin/playoff-rounds',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error || 'Opération refusée.');
  return result;
}
function RoundConfirmation({ action, name, busy, onCancel, onConfirm }) {
  const dialog=useRef(null);
  useEffect(()=>{const trigger=document.activeElement;dialog.current.showModal();return()=>{if(trigger?.isConnected)trigger.focus();};},[]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="round-confirm-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
    <h2 id="round-confirm-title">{action==='advance'?'Passer à la ronde suivante':'Préparer / ouvrir le Wild Card'}</h2>
    <p>{action==='advance'?'La ronde actuelle sera clôturée sans calcul de points. Cette transition est irréversible. ':''}
      {name} sera ouverte seulement si tous ses affrontements et horaires officiels ESPN sont disponibles et valides. En cas d’échec, la ronde et les matchs existants seront conservés.</p>
    <div className={styles.actions}><button className="button-secondary" disabled={busy} onClick={onCancel}>Annuler</button><button className="button" disabled={busy} onClick={onConfirm}>{busy?'Vérification ESPN…':'Confirmer'}</button></div>
  </dialog>;
}
export default function RoundAdmin({season=2026,request=requestRound}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[warnings,setWarnings]=useState([]);
  const inFlight=useRef(false);
  useEffect(()=>{let active=true;request({action:'read',season}).then(r=>{if(active)setData(r.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,season]);
  let view,invalid='';
  try {if(data)view=roundSummary(data);}catch(e){invalid=e.message;}
  async function run(action,roundKey) {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setMessage('');setWarnings([]);
    try {
      const result=await request({action,season,roundKey,confirmed:['prepare','advance'].includes(action)});
      setData(result.data);setMessage(result.message || 'Ronde rechargée.');setWarnings(result.warnings || []);
    } catch(e) {setError(`${e.message} Les données affichées sont conservées; relis la ronde avant de réessayer.`);}
    finally {inFlight.current=false;setBusy(false);setPending(null);}
  }
  const index=view?ROUNDS.findIndex(r=>r.key===view.current.round_key):-1;
  const active=view&&['open','locked'].includes(view.current.status);
  const initial=view&&index===0&&view.current.status==='draft'&&view.officialCount===0;
  return <section aria-label="Gestion des rondes">
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {invalid&&<p role="alert" className={styles.error}>{invalid}</p>}
    {message&&<p role="status" className={styles.success}>{message}</p>}
    {warnings.length>0&&<div role="alert"><p>Mise à jour partielle : certains résultats n’ont pas été actualisés.</p><ul>{warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
    {!data&&!error&&<p>Chargement de la ronde…</p>}
    {view&&<>
      <div className={active?styles.operations:undefined}>
        {active&&<section className={`card ${styles.operationCard}`} aria-labelledby="round-update-title">
          <h2 id="round-update-title">🔄 Mise à jour complète</h2>
          <p>Actualise les scores ESPN et les états LIVE / FINAL des matchs officiels de cette ronde.</p>
          <p>Cette action ne change pas de ronde et ne calcule aucun point.</p>
          <div className={styles.operationAction}><button className="button" disabled={busy||!view.canUpdate} onClick={()=>run('update',view.current.round_key)}>{busy?'En cours…':'Mettre à jour la ronde'}</button></div>
        </section>}
        <section className={`card ${styles.operationCard}`} aria-labelledby="round-title">
          <h2 id="round-title">🏆 Ronde active</h2>
          <h3>{view.definition.name}</h3>
          <span className={`${styles.badge} ${styles.draft}`}>{view.current.status}</span>
          <dl className={styles.roundMeta}>
            <div><dt>Matchs officiels</dt><dd>{view.officialCount} / {view.definition.count}</dd></div>
            <div><dt>FINAL</dt><dd>{view.finalCount} / {view.definition.count}</dd></div>
            <div><dt>Choix de matchs complets</dt><dd>{data.completeMatchParticipants} participant(s)</dd></div>
            <div><dt>Premier coup d’envoi</dt><dd>{view.firstKickoff?new Date(view.firstKickoff).toLocaleString('fr-CA',{dateStyle:'long',timeStyle:'short'}):'À déterminer'}</dd></div>
          </dl>
          {view.blocked&&<p>{view.blocked}</p>}
          {initial&&<div className={styles.operationAction}><button className="button" disabled={busy||!view.canPrepare} onClick={()=>setPending({action:'prepare',roundKey:'wild_card',name:view.definition.name})}>Préparer / ouvrir le Wild Card</button></div>}
          {active&&index<3&&!view.canAdvance&&<p>Tous les matchs officiels doivent être FINAL avant de poursuivre.</p>}
          {active&&index<3&&<div className={styles.operationAction}><button className="button-secondary" disabled={busy||!view.canAdvance} onClick={()=>setPending({action:'advance',roundKey:view.current.round_key,name:ROUNDS[index+1].name})}>Passer à la ronde suivante</button></div>}
          {index===3&&<p>Le Super Bowl est la dernière ronde.</p>}
          {view.current.status==='draft'&&!initial&&<p>Cette ronde doit être ouverte par le passage depuis la ronde précédente. Aucune initialisation séparée n’est disponible.</p>}
        </section>
      </div>
      {view.games.length>0&&<section className="card"><h3>Matchs de la ronde</h3><ul className={styles.roundGames}>{view.games.map(g=><li key={g.id}><span>{g.away_team} @ {g.home_team}</span><strong>{g.external_game_id?.startsWith('TEST-')?'TEST':({pre:'À venir',in:'LIVE',post:'FINAL'})[g.game_status] || 'Non vérifié'}</strong>{g.game_status!=='pre'&&g.home_score!=null&&g.away_score!=null&&<span>{g.away_score} – {g.home_score}</span>}</li>)}</ul></section>}
    </>}
    <div className={styles.roundReload}><button className="button-secondary" disabled={busy} onClick={()=>run('read')}>Relire la ronde</button></div>
    {pending&&<RoundConfirmation {...pending} busy={busy} onCancel={()=>setPending(null)} onConfirm={()=>run(pending.action,pending.roundKey)}/>}
  </section>;
}
