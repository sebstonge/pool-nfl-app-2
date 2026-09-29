import {pickStatistics} from '../public-pages/publicData.mjs';
import {consensus,playerName} from '../playoff-tree/collectiveData.mjs';
import {ROUNDS} from '../playoff-tree/treeData.mjs';
import {winner} from '../../../../lib/playoffs/rounds.mjs';

// Descriptive statistics only; never reads regular results or calculates pool points.
export function buildAnalytics(data) {
  const rounds=new Map(data.rounds.map(r=>[r.id,r]));
  const games=data.games.filter(g=>rounds.has(g.round_id));
  const ids=new Set(games.map(g=>g.id));
  const picks=data.picks.filter(p=>ids.has(p.game_id));
  const totals=pickStatistics(games,picks);
  const users=[...new Set(picks.map(p=>p.user_id))].map(userId=>{
    const profile=data.players.find(p=>p.id===userId);
    const stats=pickStatistics(games,picks.filter(p=>p.user_id===userId));
    return {userId,name:playerName(profile),realName:profile?.real_name || '',...stats};
  }).filter(u=>u.evaluated>0);
  const topExact=[...users].sort((a,b)=>b.exact-a.exact).map(u=>({...u,value:u.exact,detail:`${u.exact} / ${u.evaluated} choix`}));
  const topCorrect=[...users].sort((a,b)=>b.correct-a.correct).map(u=>({...u,value:u.correct,detail:`${u.accuracy} % de bons gagnants`}));
  const byRound=new Map();
  let consensusWins=0,consensusLosses=0;
  for(const game of games){
    let winning;try{winning=winner(game);}catch{continue;}
    const counts=consensus(game,picks);
    // An equal vote has no majority; do not manufacture a consensus winner.
    if(counts.away.length===counts.home.length)continue;
    const choice=counts.away.length>counts.home.length?game.away_team:game.home_team;
    const round=rounds.get(game.round_id);
    if(!byRound.has(round.id))byRound.set(round.id,{round:ROUNDS.find(r=>r.key===round.round_key)?.title || round.round_name,wins:0,losses:0,order:round.round_order});
    const row=byRound.get(round.id);
    if(choice===winning){consensusWins++;row.wins++;}else{consensusLosses++;row.losses++;}
  }
  const consensusRounds=[...byRound.values()].sort((a,b)=>a.order-b.order).map(r=>({...r,pct:100*r.wins/(r.wins+r.losses)}));
  const myQbPicks=data.qbPicks.filter(p=>p.user_id===data.userId&&rounds.has(p.round_id)).sort((a,b)=>rounds.get(a.round_id).round_order-rounds.get(b.round_id).round_order).map(p=>({
    round:ROUNDS.find(r=>r.key===rounds.get(p.round_id).round_key)?.title || rounds.get(p.round_id).round_name,
    qbName:p.qbs?.name || 'QB enregistré',team:p.qbs?.team || '',rating:null,actualQbName:null,
  }));
  return {
    totalPicks:totals.evaluated,totalCorrect:totals.correct,totalExact:totals.exact,topExact,topCorrect,
    consensusWins,consensusLosses,consensusPct:consensusWins+consensusLosses?100*consensusWins/(consensusWins+consensusLosses):null,
    bestConsensusRound:[...consensusRounds].sort((a,b)=>b.pct-a.pct)[0] || null,
    worstConsensusRound:[...consensusRounds].sort((a,b)=>a.pct-b.pct)[0] || null,
    // No official Playoffs score/rating source exists yet. Null is not a zero score.
    bestRound:null,worstRound:null,bestQb:null,worstQb:null,
    myRoundRows:[],myTotalScore:null,myBestRound:null,myWorstRound:null,myQbPicks,
  };
}
