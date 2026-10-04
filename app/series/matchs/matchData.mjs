import {hasCompleteSubmission} from '../components/playoff-tree/treeData.mjs';
import {processedPlayoffResults} from '../components/public-pages/processedResults.mjs';

export function pendingPlayoffPlayers(players, submission) {
  return players.filter(player=>!hasCompleteSubmission({...submission,userId:player.id}))
    .sort((a,b)=>(a.real_name||a.display_name||'').localeCompare(b.real_name||b.display_name||'','fr'));
}
export async function loadRoundSubmissions(client,roundId,games) {
  async function read(query){const {data,error}=await query;if(error)throw error;return data||[];}
  const gameIds=games.filter(g=>g.round_id===roundId).map(g=>g.id);
  const [picks,qbPicks,paths]=await Promise.all([
    gameIds.length?read(client.from('playoff_picks').select('user_id,game_id,picked_team,predicted_spread').in('game_id',gameIds)):[],
    read(client.from('playoff_qb_picks').select('user_id,round_id,qb_id').eq('round_id',roundId)),
    read(client.from('playoff_team_paths').select('user_id,round_id,team').eq('round_id',roundId)),
  ]);
  return {roundId,games,picks,qbPicks,paths};
}
export function playoffQbAverages(data) {
  return Object.fromEntries(processedPlayoffResults(data).qbRows
    .filter(row=>row.qb.espn_athlete_id!=null)
    .map(row=>[String(row.qb.espn_athlete_id),row.average]));
}
