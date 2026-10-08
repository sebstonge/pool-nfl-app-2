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
 return <section className="card" aria-label="Ton temps moyen de sélection" style={{padding:'14px 18px',minWidth:0}}>
  <div style={{color:'#94a3b8',fontSize:14}}>⏱️ Ton temps moyen de sélection</div>
  <div role="status" style={{marginTop:6,fontSize:18,fontWeight:800,color:'#f8fafc'}}>
   {error?'Temps indisponible pour le moment':!result?'Chargement…':result.average===null?'Pas encore de sélection chronométrée':formatDuration(result.average).replace(/(h \d+)$/,'$1 min')}
  </div>
 </section>;
}
