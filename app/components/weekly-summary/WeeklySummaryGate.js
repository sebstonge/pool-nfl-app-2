"use client";
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {supabase} from '../../../lib/supabase';
import WeeklySummaryDialog from './WeeklySummaryDialog';

const paths=new Set(['/','/matchs','/tous-les-choix','/qb-ratings','/analytics','/classements']);

export default function WeeklySummaryGate(){
  const pathname=usePathname();
  const [summary,setSummary]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [sessionVersion,setSessionVersion]=useState(0),owner=useRef(null),closing=useRef(false),generation=useRef(0);
  useEffect(()=>{const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{
    generation.current++;owner.current=null;setSummary(null);setError('');setSessionVersion(v=>v+1);
  });return()=>subscription.unsubscribe();},[]);
  useEffect(()=>{
    if(!paths.has(pathname)){setSummary(null);return;}
    const controller=new AbortController();let fetching=false;
    async function refresh(){
      if(fetching||closing.current||document.visibilityState==='hidden')return;
      fetching=true;const started=generation.current;
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(controller.signal.aborted)return;
        owner.current=session?.user.id||null;
        if(!session){setSummary(null);return;}
        const response=await fetch('/api/weekly-summary',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal});
        const result=await response.json();
        if(!controller.signal.aborted&&generation.current===started&&owner.current===session.user.id&&response.ok)setSummary(result.summary);
      }catch{/* Optional recap never blocks login or the active week. */}
      finally{fetching=false;}
    }
    refresh();
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[pathname,sessionVersion]);
  async function close(){
    if(closing.current||!summary)return;
    closing.current=true;generation.current++;setBusy(true);setError('');
    const closingOwner=owner.current;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session||session.user.id!==owner.current)throw Error('Session expirée. Recharge la page.');
      const response=await fetch('/api/weekly-summary',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({season:summary.season,week:summary.week})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Impossible d’enregistrer la fermeture. Réessaie.');
      if(owner.current===closingOwner)setSummary(null);
    }catch(e){if(owner.current===closingOwner)setError(e.message);}
    finally{closing.current=false;setBusy(false);}
  }
  return <WeeklySummaryDialog summary={summary} onClose={close} busy={busy} error={error}/>;
}
