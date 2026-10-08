'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../../lib/supabase';
export default function SeasonLifecycle({finish=false}){
 const [data,setData]=useState(null),[selection,setSelection]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const inFlight=useRef(false);
 async function call(body){const {data:s,error}=await supabase.auth.getSession();if(error||!s.session)throw Error('Connexion requise.');const r=await fetch('/api/admin/season-lifecycle',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.session.access_token}`},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
 async function refresh(){const d=await call({action:'read'});setData(d);setSelection(d.participants.filter(p=>p.season===d.context.current_season+1).sort((a,b)=>a.initial_order-b.initial_order).map(p=>p.user_id));}
 useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
 async function run(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{
  await call({action:pending,season:data.context.current_season+(pending==='finish'?0:1),revision:data.context.revision,confirm:true,participants:selection.map((user_id,i)=>({user_id,initial_order:i+1}))});
  if(pending==='start'||pending==='finish'){window.location.assign('/admin');return;}await refresh();
 }catch(e){setError(e.message);}finally{inFlight.current=false;setBusy(false);setPending(null);}}
 const next=data?.context.current_season+1,prepared=data?.seasons.find(s=>s.season===next),confirmed=!!prepared?.participants_confirmed_at;
 return <section className="card"><h2>{finish?'Fin des Séries':'Préparer la prochaine saison'}</h2>
 {error&&<p role="alert">{error}</p>}
 {!data?<p>Chargement…</p>:finish?<button className="button" disabled={busy} onClick={()=>setPending('finish')}>METTRE FIN AUX SÉRIES</button>:<>
 <p>La saison {data.context.current_season} est terminée. La préparation ne rend pas {next} publique.</p>
 <button className="button" disabled={busy||!!prepared} onClick={()=>setPending('prepare')}>PRÉPARER LA SAISON {next}</button>
 {prepared&&<><h3>Participants {next}</h3><p>Sélectionne les participants puis ajuste leur ordre de semaine 1.</p>
 <button className="button-secondary" disabled={busy} onClick={()=>setSelection(data.participants.filter(p=>p.season===data.context.current_season&&p.confirmed).sort((a,b)=>(a.initial_order??Infinity)-(b.initial_order??Infinity)).map(p=>p.user_id))}>Reprendre la liste précédente à confirmer</button>
 {data.users.map(u=><label key={u.id} style={{display:'block',margin:'10px 0'}}><input type="checkbox" disabled={busy} checked={selection.includes(u.id)} onChange={e=>{setSelection(ids=>e.target.checked?[...ids,u.id]:ids.filter(id=>id!==u.id));}}/> {u.display_name||u.real_name||u.id}</label>)}
 <ol>{selection.map((id,i)=><li key={id}>{data.users.find(u=>u.id===id)?.display_name||data.users.find(u=>u.id===id)?.real_name||id} <button disabled={busy||i===0} onClick={()=>setSelection(ids=>{const a=[...ids];[a[i-1],a[i]]=[a[i],a[i-1]];return a;})}>↑</button> <button disabled={busy||i===selection.length-1} onClick={()=>setSelection(ids=>{const a=[...ids];[a[i+1],a[i]]=[a[i],a[i+1]];return a;})}>↓</button></li>)}</ol>
 <button className="button-secondary" disabled={busy} onClick={()=>setPending('participants')}>CONFIRMER LES PARTICIPANTS ET L’ORDRE</button>
 <button className="button" disabled={busy||!confirmed||!data.canStart||JSON.stringify(selection)!==JSON.stringify(data.participants.filter(p=>p.season===next).sort((a,b)=>a.initial_order-b.initial_order).map(p=>p.user_id))} onClick={()=>setPending('start')}>DÉMARRER LA SAISON RÉGULIÈRE</button></>}
 </>}
 {pending&&<div role="alertdialog" aria-label="Confirmation"><p>Confirmer {pending==='finish'?'la clôture définitive des Séries':pending==='start'?`le démarrage de ${next}`:pending==='prepare'?`la préparation du calendrier ${next}`:'la liste des participants et leur ordre'} ?</p><button className="button" disabled={busy} onClick={run}>Confirmer</button><button className="button-secondary" disabled={busy} onClick={()=>setPending(null)}>Annuler</button></div>}
 </section>;
}
