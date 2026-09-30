'use client';
import { loadProcessedResults } from './processedResults.mjs';
import { useEffect, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { loadCollectiveData, fetchLiveGame, espnSummaryUrl } from '../playoff-tree/collectiveData.mjs';

export function usePlayoffData(){
  const [data,setData]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
  useEffect(()=>{const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setData(null);setVersion(v=>v+1);});return()=>subscription.unsubscribe();},[]);
  useEffect(()=>{let active=true;setError('');loadCollectiveData(supabase,undefined,{includeGameStatus:true})
    .then(async result=>{if(!result.requiresSignIn)result.processed=await loadProcessedResults(supabase,result.rounds.map(r=>r.id));if(active)setData(result);}).catch(()=>{if(active)setError('Impossible de charger les données des séries. Réessaie.');});return()=>{active=false;};},[version]);
  return {data,error,retry:()=>{setData(null);setVersion(v=>v+1);}};
}
export function useLiveGames(games){
  const [live,setLive]=useState({});
  const key=games.map(g=>`${g.id}:${g.external_game_id}`).join('|');
  useEffect(()=>{
    const abort=new AbortController();let running=false;
    setLive({});
    async function update(){
      if(running)return;running=true;
      const rows=await Promise.all(games.filter(g=>espnSummaryUrl(g)).map(async g=>{
        try{return [g.id,await fetchLiveGame(g,fetch,abort.signal)];}catch{return [g.id,null];}
      }));
      if(!abort.signal.aborted)setLive(Object.fromEntries(rows.filter(([,value])=>value)));
      running=false;
    }
    update();const timer=setInterval(update,30000);
    return()=>{abort.abort();clearInterval(timer);};
  },[key]);
  return live;
}
