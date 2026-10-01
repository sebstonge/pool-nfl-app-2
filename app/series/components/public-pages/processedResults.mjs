import { assertPlayoffRounds } from '../../../../lib/playoffs/context.mjs';
import {ROUNDS} from '../playoff-tree/treeData.mjs';

export async function loadProcessedResults(client,rounds,season) {
  assertPlayoffRounds(rounds,season);
  const roundIds=rounds.map(round=>round.id);
  if(!roundIds.length)return {results:[],runs:[]};
  const {data,error}=await client.rpc('read_playoff_results',{p_round_ids:roundIds});
  if(error){
    if(['42883','PGRST202'].includes(error.code))return {results:[],runs:[]};
    throw new Error(`Résultats Playoffs indisponibles : ${error.message}`);
  }
  if (!data || !Array.isArray(data.results) || !Array.isArray(data.runs) ||
      [...data.results,...data.runs].some(row=>!roundIds.includes(row.round_id))) {
    throw new Error('Publication hors des rondes de la saison demandée.');
  }
  return data;
}
export function processedPlayoffResults(data={}) {
  const rounds=data.rounds||[],players=data.players||[];
  const runs=(data.processed?.runs||[]).filter(run=>run.processed_at&&rounds.some(r=>r.id===run.round_id))
    .sort((a,b)=>rounds.find(r=>r.id===a.round_id).round_order-rounds.find(r=>r.id===b.round_id).round_order);
  const results=(data.processed?.results||[]).filter(row=>runs.some(run=>run.round_id===row.round_id));
  const identity=id=>{const p=players.find(p=>p.id===id);return {userId:id,name:p?.display_name||p?.real_name||'Joueur',realName:p?.real_name||''};};
  const byQB=new Map(),progression=new Map();
  for(const row of results){
    const q=row.qb_result;
    if(!q||!Number.isFinite(q.passer_rating))continue;
    const key=q.actual_espn_athlete_id;
    if(!byQB.has(key))byQB.set(key,{qb:{id:key,espn_athlete_id:key,name:q.actual_qb_name,team:q.team},ratings:new Map()});
    const grouped=byQB.get(key);
    // Shared QB counts once per game, not once per selecting player.
    const ratingKey=`${row.round_id}:${q.game_id}`;
    const player=identity(row.user_id),round=rounds.find(r=>r.id===row.round_id);
    if(!grouped.ratings.has(ratingKey))grouped.ratings.set(ratingKey,{passer_rating:q.passer_rating,round_name:round.round_name||ROUNDS.find(r=>r.key===round.round_key)?.title,authors:[]});
    grouped.ratings.get(ratingKey).authors.push(player.name);
  }
  for(const run of runs){
    const round=rounds.find(r=>r.id===run.round_id);
    for(const s of run.standings){
      if(!progression.has(s.user_id))progression.set(s.user_id,{...identity(s.user_id),points:[]});
      progression.get(s.user_id).points.push({week:round.round_key,rank:s.cumulative_rank});
    }
  }
  const qbRows=[...byQB.values()].map(({qb,ratings})=>{
    const list=[...ratings.values()].map(r=>({...r,selected_by:[...new Set(r.authors)].join(', ')}));
    const ordered=[...list].sort((a,b)=>b.passer_rating-a.passer_rating);
    return {qb,best:ordered[0],worst:ordered.at(-1),average:list.reduce((s,r)=>s+r.passer_rating,0)/list.length};
  }).sort((a,b)=>b.average-a.average||String(a.qb.id).localeCompare(String(b.qb.id))).map((r,i)=>({...r,rank:i+1}));
  return {qbRows,progression:{weeks:ROUNDS.map(r=>r.key),rows:[...progression.values()]},
    roundRows:roundId=>results.filter(r=>r.round_id===roundId).sort((a,b)=>a.round_rank-b.round_rank).map(r=>({...identity(r.user_id),rank:r.round_rank,score:r.final_score})),
    cumulativeRows:(runs.at(-1)?.standings||[]).map(s=>({...identity(s.user_id),rank:s.cumulative_rank,score:s.cumulative_score}))};
}
