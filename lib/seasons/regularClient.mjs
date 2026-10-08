import {loadLifecycle} from '../lifecycle/context.mjs';
const weekly=new Set(['qb_picks','qb_ratings','weekly_scores','qb_weekly_stats','qb_selection_weeks']);
// Restricted adapter for legacy regular screens. Pin season for the lifetime of
// the screen/request; an old tab must never silently write into a new season.
export function regularClient(base,{season,participants=true}={}){
 let context;
 const getSeason=()=>season!=null?Promise.resolve(season):(context??=loadLifecycle(base).then(c=>c.current_season));
 const all=async(query)=>{const {data,error}=await query;if(error)throw error;return data||[];};
 return {regularSeason:getSeason,auth:base.auth,rpc:(...args)=>base.rpc(...args),from(table){
  if(!weekly.has(table)&&!['games','picks','users','push_notification_events'].includes(table))return base.from(table);
  const steps=[];
  const execute=async()=>{
   const year=await getSeason(),method=steps[0]?.[0],writing=['insert','upsert','update','delete'].includes(method);
   let query=base.from(table),members;
   const userList=table==='users'&&participants&&!writing&&!steps.some(([m,a])=>m==='eq'&&a[0]==='id')&&!steps.some(([m,a])=>m==='select'&&String(a[0]).includes('must_change_password'));
   if(userList)members=await all(base.from('season_participants').select('user_id,initial_order').eq('season',year).eq('confirmed',true));
   for(const [m,original] of steps){
    const a=[...original];
    if(weekly.has(table)&&['insert','upsert'].includes(m)){
     const tag=row=>{if(row.season!=null&&row.season!==year)throw Error('Saison incohérente');return {...row,season:year};};a[0]=Array.isArray(a[0])?a[0].map(tag):tag(a[0]);
     if(m==='upsert'&&a[1]?.onConflict&&!a[1].onConflict.split(',').includes('season'))a[1]={...a[1],onConflict:'season,'+a[1].onConflict};
    }
    if(table==='push_notification_events'&&['insert','upsert'].includes(m)){
     const tag=row=>{if(row.season!=null&&row.season!==year)throw Error('Saison incohérente');return {...row,season:year,event_key:regularEventKey(year,row.event_key)};};a[0]=Array.isArray(a[0])?a[0].map(tag):tag(a[0]);
    }
    if(table==='push_notification_events'&&m==='eq'&&a[0]==='event_key'&&!String(a[1]).startsWith('season-'))a[1]=regularEventKey(year,a[1]);
    query=query[m](...a);
    if(m===method){
     if((weekly.has(table)||table==='games'||table==='push_notification_events')&&!['insert','upsert'].includes(method))query=query.eq('season',year);
     if(table==='picks'&&!['insert','upsert'].includes(method)){
      const games=await all(base.from('games').select('id').eq('season',year));query=query.in('game_id',games.map(g=>g.id));
     }
     if(userList)query=query.in('id',members.map(p=>p.user_id));
    }
   }
   const result=await query;
   if(userList&&Array.isArray(result.data))result.data=result.data.map(u=>({...u,initial_order:members.find(p=>p.user_id===u.id)?.initial_order}));
   return result;
  };
  const chain=new Proxy({}, {get(_,method){if(method==='then')return (resolve,reject)=>execute().then(resolve,reject);return (...args)=>{steps.push([method,args]);return chain;};}});
  return chain;
 }};
}
export function initialOrder(players){return [...players].sort((a,b)=>(a.initial_order??Infinity)-(b.initial_order??Infinity)||String(a.id).localeCompare(String(b.id)));}

// Preserve already-reserved 2026 keys (including sent events); new seasons use a namespace.
export function regularEventKey(season,key){
 if(!Number.isInteger(season)||season<2026||typeof key!=='string')throw Error('Identité de notification invalide');
 if(key.startsWith('season-')){if(!key.startsWith(`season-${season}-`))throw Error('Notification d’une autre saison');return key;}
 return season===2026?key:`season-${season}-${key}`;
}
