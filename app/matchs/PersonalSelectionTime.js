'use client';
import {useEffect,useState} from 'react';
import {loadSelectionStats,formatDuration} from '../../lib/seasons/selectionTime.mjs';

export default function PersonalSelectionTime({client,userId,week,submissionId}){
 const [result,setResult]=useState(null),[error,setError]=useState(false);
 useEffect(()=>{
  let active=true;
  setResult(null);setError(false);
  if(userId&&week)loadSelectionStats(client,week).then(rows=>{
   if(active)setResult(rows.find(row=>row.userId===userId)||{average:null});
  }).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[client,userId,week,submissionId]);
 if(!userId)return null;
 return <section className="card" aria-label="Ton temps moyen de sélection" style={{padding:'18px 20px',minWidth:0,width:'fit-content',maxWidth:'100%',boxSizing:'border-box',display:'flex',alignItems:'center',gap:14,background:'linear-gradient(120deg,rgba(30,58,95,.35),#0b1227)',border:'1px solid rgba(148,163,184,.18)',borderRadius:18}}>
  <span aria-hidden="true" style={{fontSize:28,flexShrink:0}}>⏱️</span>
  <div style={{minWidth:0}}><div style={{color:'#94a3b8',fontSize:11,fontWeight:800,letterSpacing:'.06em',lineHeight:1.5,textTransform:'uppercase'}}>Ton temps moyen de sélection</div>
  <div role="status" style={{marginTop:6,fontSize:24,fontWeight:800,color:'#f8fafc'}}>
   {error?'Temps indisponible pour le moment':!result?'Chargement…':result.average===null?'Pas encore de sélection chronométrée':formatDuration(result.average)}
  </div></div>
 </section>;
}
