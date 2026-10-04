import {playerName} from '../playoff-tree/collectiveData.mjs';
import {ROUNDS} from '../playoff-tree/treeData.mjs';
import {publishedPlayoffResults} from '../public-pages/processedResults.mjs';

// Adapt published snapshots to the existing regular-page presentation contract.
// Never derive historical outcomes from current game scores, LIVE ESPN or selections alone.
export function buildAnalytics(data) {
  const {rounds,results}=publishedPlayoffResults(data);
  const byRound=new Map(rounds.map(r=>[r.id,r]));
  const roundName=id=>{
    const r=byRound.get(id);
    return ROUNDS.find(d=>d.key===r?.round_key)?.title || r?.round_name;
  };
  const identity=userId=>{
    const p=(data.players||[]).find(p=>p.id===userId);
    return {userId,name:playerName(p),realName:p?.real_name || ''};
  };
  const users=new Map(),games=new Map();
  for(const row of results) {
    const stats=users.get(row.user_id) || {...identity(row.user_id),evaluated:0,correct:0,exact:0};
    for(const detail of row.pick_results || []) {
      if(![0,1,2].includes(detail.points))continue;
      stats.evaluated++;stats.correct+=Number(detail.points>0);stats.exact+=Number(detail.points===2);
      const key=`${row.round_id}:${detail.game_id}`;
      if(!games.has(key))games.set(key,{roundId:row.round_id,votes:[],complete:true});
      const game=games.get(key);
      const pick=(data.picks||[]).find(p=>p.id===detail.pick_id&&p.user_id===row.user_id&&p.game_id===detail.game_id);
      // Missing descriptive choices must not create a partial, misleading majority.
      if(!pick?.picked_team)game.complete=false;
      else game.votes.push({team:pick.picked_team,correct:detail.points>0});
    }
    users.set(row.user_id,stats);
  }
  const userRows=[...users.values()].filter(u=>u.evaluated>0);
  const totalPicks=userRows.reduce((s,u)=>s+u.evaluated,0);
  const totalCorrect=userRows.reduce((s,u)=>s+u.correct,0);
  const totalExact=userRows.reduce((s,u)=>s+u.exact,0);
  const topExact=[...userRows].sort((a,b)=>b.exact-a.exact).map(u=>({...u,value:u.exact,detail:`${u.exact} / ${u.evaluated} choix`}));
  const topCorrect=[...userRows].sort((a,b)=>b.correct-a.correct).map(u=>({...u,value:u.correct,detail:`${Math.round(u.correct/u.evaluated*100)} % de bons gagnants`}));
  const consensusByRound=new Map();
  let consensusWins=0,consensusLosses=0;
  for(const {roundId,votes,complete} of games.values()) {
    if(!complete||!votes.length)continue;
    const counts=new Map();
    for(const vote of votes){if(!counts.has(vote.team))counts.set(vote.team,[]);counts.get(vote.team).push(vote.correct);}
    const sorted=[...counts.values()].sort((a,b)=>b.length-a.length);
    if(sorted.length>2 || sorted[0].length===sorted[1]?.length)continue;
    const majority=sorted[0];
    if(majority.some(correct=>correct!==majority[0]))continue;
    const win=majority[0];
    if(!consensusByRound.has(roundId))consensusByRound.set(roundId,{round:roundName(roundId),wins:0,losses:0,order:byRound.get(roundId).round_order});
    const row=consensusByRound.get(roundId);
    if(win){consensusWins++;row.wins++;}else{consensusLosses++;row.losses++;}
  }
  const consensusRounds=[...consensusByRound.values()].sort((a,b)=>a.order-b.order).map(r=>({...r,pct:100*r.wins/(r.wins+r.losses)}));
  const roundRows=results.filter(r=>Number.isFinite(r.final_score)).map(r=>({...r,...identity(r.user_id),round:roundName(r.round_id),score:r.final_score}));
  const myRoundRows=roundRows.filter(r=>r.user_id===data.userId).sort((a,b)=>a.round_order-b.round_order);
  const high=rows=>[...rows].sort((a,b)=>b.score-a.score)[0] || null;
  const low=rows=>[...rows].sort((a,b)=>a.score-b.score)[0] || null;

  // Shared QBs represent a single performance per actual QB/game/round.
  const performances=new Map();
  for(const row of results) {
    const q=row.qb_result;
    if(!Number.isFinite(q?.passer_rating))continue;
    const selected=(data.qbPicks||[]).find(p=>p.user_id===row.user_id&&p.round_id===row.round_id&&p.qb_id===row.selected_qb_id)?.qbs;
    const key=`${row.round_id}:${q.game_id}:${q.actual_espn_athlete_id || row.selected_qb_id}`;
    if(!performances.has(key))performances.set(key,{
      name:q.actual_qb_name || selected?.name || 'QB enregistré',team:q.team || selected?.team || '',
      espn_athlete_id:q.actual_espn_athlete_id || selected?.espn_athlete_id || null,
      rating:q.passer_rating,round:roundName(row.round_id),authors:new Map(),
    });
    performances.get(key).authors.set(row.user_id,identity(row.user_id));
  }
  const qbRecords=[...performances.values()].map(({authors,...q})=>({...q,
    selectedBy:[...authors.values()].map(p=>p.name).join(', '),
    selectedByRealName:authors.size===1?[...authors.values()][0].realName:'',
  })).sort((a,b)=>b.rating-a.rating);
  const myQbPicks=(data.qbPicks||[]).filter(p=>p.user_id===data.userId&&byRound.has(p.round_id))
    .sort((a,b)=>byRound.get(a.round_id).round_order-byRound.get(b.round_id).round_order).map(p=>{
      const q=results.find(r=>r.user_id===data.userId&&r.round_id===p.round_id&&r.selected_qb_id===p.qb_id)?.qb_result;
      return {round:roundName(p.round_id),qbName:p.qbs?.name || 'QB enregistré',team:p.qbs?.team || '',
        rating:Number.isFinite(q?.passer_rating)?q.passer_rating:null,actualQbName:q?.actual_qb_name || null};
    });
  return {
    totalPicks,totalCorrect,totalExact,topExact,topCorrect,
    consensusWins,consensusLosses,consensusPct:consensusWins+consensusLosses?100*consensusWins/(consensusWins+consensusLosses):null,
    bestConsensusRound:[...consensusRounds].sort((a,b)=>b.pct-a.pct)[0] || null,
    worstConsensusRound:[...consensusRounds].sort((a,b)=>a.pct-b.pct)[0] || null,
    bestRound:high(roundRows),worstRound:low(roundRows),bestQb:qbRecords[0] || null,worstQb:qbRecords.at(-1) || null,
    myRoundRows,myTotalScore:myRoundRows.length?myRoundRows.reduce((s,r)=>s+r.score,0):null,
    myBestRound:high(myRoundRows),myWorstRound:low(myRoundRows),myQbPicks,
  };
}
