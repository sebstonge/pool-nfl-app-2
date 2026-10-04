// Pure Playoffs scoring. No I/O, regular-season tables or clock-dependent points.
import { competitionRanks, cumulativeComparison, validateSuperBowlTotal } from './rankings.mjs';
import { RoundError } from './rounds.mjs';
export const roundedScore = value => Number(value.toFixed(3));
const fail = message => { throw new RoundError(message); };
export function finalWinner(game) {
  if (game?.game_status !== 'post' || ![game.home_score,game.away_score].every(n=>Number.isInteger(n)&&n>=0) || game.home_score===game.away_score)
    return null;
  return game.home_score>game.away_score?game.home_team:game.away_team;
}
export function gamePoints(game,pick) {
  const winner=finalWinner(game);
  if (!winner) return null;
  if (!pick || ![game.home_team,game.away_team].includes(pick.picked_team) || !Number.isInteger(pick.predicted_spread) || pick.predicted_spread<0)
    fail('Choix de match incomplet ou invalide.');
  return pick.picked_team!==winner?0:pick.predicted_spread===Math.abs(game.home_score-game.away_score)?2:1;
}
export function pathContext({round,games,seeds,path,previous}) {
  if(!path?.team) fail('Prédiction Super Bowl absente.');
  const continued=!!previous && previous.path_alive;
  if(continued && previous.path_team!==path.team) fail('Le parcours survivant doit être conservé.');
  const played=continued?previous.path_games_played:0;
  const matches=games.filter(g=>[g.home_team,g.away_team].includes(path.team));
  if(matches.length>1) fail('Équipe de parcours présente dans plusieurs matchs.');
  if(!matches.length){
    if(round.round_key!=='wild_card' || !seeds.some(s=>s.team===path.team&&s.seed===1&&s.finalized_at)) fail('Parcours absent de la ronde et sans bye officielle.');
    return {game:null,multiplier:0,played,alive:true,continued};
  }
  if(played<0 || played>3) fail('Compteur du parcours invalide.');
  return {game:matches[0],multiplier:played+1,played:played+1,alive:finalWinner(matches[0])===path.team,continued};
}
export function adjustedPoints(games,picks,path) {
  let normal=0,base=0;
  const details=games.map(game=>{
    const pick=picks.find(p=>p.game_id===game.id),points=gamePoints(game,pick);
    if(points===null) fail('La ronde contient un match non FINAL.');
    const isPath=path.game?.id===game.id;
    if(isPath)base=points;else normal+=points;
    return {game_id:game.id,pick_id:pick.id,points,margin_error:Math.abs(pick.predicted_spread-Math.abs(game.home_score-game.away_score)),multiplier:isPath?path.multiplier:1,adjusted_points:points*(isPath?path.multiplier:1)};
  });
  return {normal_game_points:normal,path_base_points:base,path_adjusted_points:base*path.multiplier,subtotal:normal+base*path.multiplier,pick_results:details};
}
export function applyQBRating(subtotal,rating) {
  if(!Number.isFinite(rating)||rating<0||rating>158.3)fail('Passer Rating validé manquant ou invalide.');
  // Same storage/display precision as regular calculateScores; never replace zero by one.
  return {qb_multiplier:roundedScore(rating/100),final_score:roundedScore(subtotal*(rating/100))};
}
export function availableQBs(qbs,games,history) {
  const playing=new Set(games.flatMap(g=>[g.home_team,g.away_team]));
  const eligible=qbs.filter(q=>q.active!==false&&q.is_active_starter===true&&playing.has(q.team));
  const used=new Set(history.filter(r=>r.qb_consumed).map(r=>String(r.selected_qb_id)));
  const fresh=eligible.filter(q=>!used.has(String(q.id)));
  return fresh.length?fresh:eligible;
}
export function calculateRound({round,games,picks,qbPicks,paths,qbs,seeds,previousResults=[],qbResults}) {
  if(!['open','locked','scored'].includes(round.status))fail('Ronde non calculable ou déjà finalisée.');
  if(!games.length || games.some(g=>g.round_id!==round.id||!finalWinner(g)))fail('Tous les matchs doivent être FINAL.');
  if(new Set(games.map(g=>g.id)).size!==games.length||new Set(games.flatMap(g=>[g.home_team,g.away_team])).size!==games.length*2)fail('Matchs dupliqués.');
  const users=[...new Set([...picks,...qbPicks,...paths].map(r=>r.user_id))].sort();
  if(!users.length)fail('Aucune soumission à calculer.');
  const output=users.map(user_id=>{
    const own=picks.filter(p=>p.user_id===user_id);
    const qps=qbPicks.filter(p=>p.user_id===user_id),ps=paths.filter(p=>p.user_id===user_id);
    if(own.length!==games.length||new Set(own.map(p=>p.game_id)).size!==games.length||qps.length!==1||ps.length!==1)fail(`Soumission incomplète : ${user_id}.`);
    const history=previousResults.filter(r=>r.user_id===user_id).sort((a,b)=>a.round_order-b.round_order);
    const previous=history.at(-1);
    if(previous && previous.round_order!==round.round_order-1)fail('Historique de parcours discontinu.');
    const path=pathContext({round,games,seeds,path:ps[0],previous});
    if(path.game && own.find(p=>p.game_id===path.game.id)?.picked_team!==ps[0].team)fail('Le parcours doit être choisi gagnant de son match.');
    const selected=qbs.find(q=>String(q.id)===String(qps[0].qb_id));
    // Eligibility was locked at submission. Do not depend on a starter flag changed after kickoff.
    if(!selected || !games.some(g=>[g.home_team,g.away_team].includes(selected.team)))fail('QB sans match dans cette ronde.');
    const qb=qbResults[user_id];
    if(!qb || String(qb.selected_qb_id)!==String(selected.id))fail(`Résultat QB incomplet : ${user_id}.`);
    const points=adjustedPoints(games,own,path),score=applyQBRating(points.subtotal,qb.passer_rating);
    let total;
    try {total=validateSuperBowlTotal(round.round_key,qps[0].super_bowl_total);}catch(error){fail(error.message);}
    const marginError=points.pick_results.reduce((sum,p)=>sum+p.margin_error,0);
    return {round_margin_error:marginError,cumulative_margin_error:(previous?.cumulative_margin_error||0)+marginError,
      super_bowl_total_error:total==null?null:Math.abs(total-games[0].home_score-games[0].away_score),
      user_id,round_id:round.id,round_order:round.round_order,...points,...score,
      path_team:ps[0].team,path_multiplier:path.multiplier,path_games_played:path.played,path_alive:path.alive,
      selected_qb_id:selected.id,qb_consumed:qb.consumed,qb_result:qb,
      cumulative_score:roundedScore((previous?.cumulative_score||0)+score.final_score)};
  });
  const rankedRound=competitionRanks(output,(a,b)=>b.final_score-a.final_score,'round_rank');
  output.forEach(r=>r.round_rank=rankedRound.find(s=>s.user_id===r.user_id).round_rank);
  // Previous participants who skipped this round still retain a cumulative position.
  const absent=[...new Set(previousResults.map(r=>r.user_id))].filter(id=>!users.includes(id)).map(user_id=>{
    const prev=previousResults.filter(r=>r.user_id===user_id).sort((a,b)=>a.round_order-b.round_order).at(-1);
    return {user_id,cumulative_score:prev.cumulative_score,cumulative_margin_error:prev.cumulative_margin_error,super_bowl_total_error:prev.super_bowl_total_error};
  });
  const standings=competitionRanks([...output,...absent],cumulativeComparison,'cumulative_rank')
    .map(({user_id,cumulative_score,cumulative_margin_error,super_bowl_total_error,cumulative_rank})=>({user_id,cumulative_score,cumulative_margin_error,super_bowl_total_error,cumulative_rank}));
  output.forEach(r=>r.cumulative_rank=standings.find(s=>s.user_id===r.user_id).cumulative_rank);
  return {results:output,standings};
}
