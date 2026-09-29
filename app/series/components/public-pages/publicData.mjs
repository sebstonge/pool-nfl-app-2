import { initialRound, playerName } from '../playoff-tree/collectiveData.mjs';
import { ROUNDS, hasCompleteSubmission } from '../playoff-tree/treeData.mjs';
import { winner } from '../../../../lib/playoffs/rounds.mjs';

export function selectedRound(data, key) {
  const chosen=key || initialRound(data.rounds,data.games);
  const definition=ROUNDS.find(r=>r.key===chosen) || ROUNDS[0];
  return {...definition,...data.rounds.find(r=>r.round_key===definition.key)};
}
export function roundData(data, round) {
  const games=round.id ? data.games.filter(g=>g.round_id===round.id) : [];
  const ids=new Set(games.map(g=>g.id));
  return {games,picks:data.picks.filter(p=>ids.has(p.game_id)),
    qbPicks:data.qbPicks.filter(p=>round.id&&p.round_id===round.id),paths:data.paths.filter(p=>round.id&&p.round_id===round.id)};
}
export function homeSummary(data,now=Date.now()) {
  const round=selectedRound(data);
  const scoped=roundData(data,round);
  const own=scoped.picks.filter(p=>p.user_id===data.userId);
  const complete=hasCompleteSubmission({...scoped,userId:data.userId,roundId:round.id});
  const touched=own.length || scoped.qbPicks.some(p=>p.user_id===data.userId) || scoped.paths.some(p=>p.user_id===data.userId);
  const upcoming=scoped.games.filter(g=>g.game_status!=='post'&&Date.parse(g.game_date)>now).sort((a,b)=>Date.parse(a.game_date)-Date.parse(b.game_date));
  return {round,...scoped,complete,submission:complete?'Soumis':touched?'Incomplet':'Non soumis',
    path:scoped.paths.find(p=>p.user_id===data.userId),qb:scoped.qbPicks.find(p=>p.user_id===data.userId),next:upcoming[0]};
}
export function qbGroups(data,round) {
  const groups=new Map();
  for(const pick of data.qbPicks.filter(p=>p.round_id===round.id)) {
    if(!groups.has(pick.qb_id))groups.set(pick.qb_id,{id:pick.qb_id,qb:pick.qbs,users:new Set()});
    groups.get(pick.qb_id).users.add(pick.user_id);
  }
  return [...groups.values()].map(g=>({...g,players:[...g.users].map(id=>playerName(data.players.find(p=>p.id===id))).sort((a,b)=>a.localeCompare(b,'fr'))}))
    .sort((a,b)=>(a.qb?.name || '').localeCompare(b.qb?.name || '','fr'));
}
// Descriptive outcomes only. No pool points, QB consumption or multiplier formula.
export function pickStatistics(games,picks) {
  const byId=new Map(games.map(g=>[g.id,g]));let evaluated=0,correct=0,exact=0;
  for(const p of picks) {
    const game=byId.get(p.game_id);
    if(!game || ![game.home_team,game.away_team].includes(p.picked_team))continue;
    let winning;try{winning=winner(game);}catch{continue;}
    evaluated++;
    if(p.picked_team===winning){correct++;if(Number.isInteger(p.predicted_spread)&&p.predicted_spread===Math.abs(game.home_score-game.away_score))exact++;}
  }
  return {evaluated,correct,exact,accuracy:evaluated?Math.round(correct/evaluated*100):null};
}

// Navigation follows the regular page: stop at the active round.
export function rankingRounds(data) {
  const active=selectedRound(data).key;
  return ROUNDS.slice(0,ROUNDS.findIndex(r=>r.key===active)+1);
}
export function seriesQBGroups(data) {
  const ids=new Set(data.rounds.map(r=>r.id));
  return qbGroups({...data,qbPicks:data.qbPicks.filter(p=>ids.has(p.round_id)).map(p=>({...p,round_id:'series'}))},{id:'series'});
}
