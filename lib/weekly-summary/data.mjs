import {ensure} from '../regular-publication/espn.mjs';
import {regularQbResult, ratingForPick} from '../seasons/qbSnapshot.mjs';
import {rankWeeklyScores, rankSeasonScores} from '../seasons/rankings.mjs';
import {officialResultText} from '../../app/components/weekly-summary/presentation.mjs';
import {regularGameResult,REGULAR_TIE_NOTE} from '../seasons/regularResults.mjs';

// Compare only history that contributes to the recap. Current-week choices and
// the mutable QB catalog must not invalidate a historical selection snapshot.
export function summarySource(state) {
  const week=state.settings.current_week-1;
  const games=state.games.filter(g=>g.week<=week);
  const ids=new Set(games.map(g=>g.id));
  return JSON.stringify({settings:state.settings,teams:state.teams,users:state.users,games,
    picks:state.picks.filter(p=>ids.has(p.game_id)),
    qb_picks:state.qb_picks.filter(q=>q.week<=week),
    qb_ratings:state.qb_ratings.filter(q=>q.week<=week),
    weekly_scores:state.weekly_scores.filter(s=>s.week<=week)});
}

export function buildWeeklySummary(state,userId,pointsByPick,verifiedGames=[]) {
  const {current_season:season,current_week:nextWeek}=state.settings,week=nextWeek-1;
  const scores=state.weekly_scores.filter(s=>s.season===season&&s.week<=week);
  const weekly=rankWeeklyScores(scores,week),score=weekly.find(s=>s.userId===userId);
  ensure(score,'Aucun score personnel complet.');
  const overall=rankSeasonScores(scores),rank=overall.findIndex(s=>s.userId===userId)+1;
  const before=rankSeasonScores(scores.filter(s=>s.week<week));
  const previousRank=before.findIndex(s=>s.userId===userId)+1;
  const choices=state.qb_picks.filter(p=>p.season===season&&p.week===week);
  const selected=choices.find(p=>p.user_id===userId);
  ensure(selected,'Choix QB personnel absent.');
  const qb=regularQbResult(selected,ratingForPick(selected,state.qb_ratings));
  ensure(qb.selected&&qb.actual&&qb.replacementKnown&&qb.rating!==null,'Résultat QB historique incomplet.');
  const used=new Map();
  for(const choice of choices){
    const result=regularQbResult(choice,ratingForPick(choice,state.qb_ratings));
    ensure(result.actual?.espn_athlete_id&&result.rating!==null,'Comparaison QB incomplète.');
    const id=result.actual.espn_athlete_id;
    ensure(!used.has(id)||used.get(id)===result.rating,'Performances du même QB incohérentes.');
    used.set(id,result.rating);
  }
  // Same ordinal ranking contract as the existing standings, including ties.
  const qbRanks=rankWeeklyScores([...used].map(([user_id,final_score])=>({user_id,week,final_score})),week);
  const games=state.games.filter(g=>g.week===week&&g.is_pool_eligible===true)
    .sort((a,b)=>String(a.game_date||'').localeCompare(String(b.game_date||''))||String(a.id).localeCompare(String(b.id)))
    .map(game=>{
      const picks=state.picks.filter(p=>p.game_id===game.id&&p.user_id===userId);
      ensure(picks.length===1&&[0,1,2].includes(pointsByPick[picks[0].id]),'Choix personnel incomplet.');
      const pick=picks[0];
      const verified=verifiedGames.find(row=>row.id===game.id);
      if(verified)ensure(['home_team','away_team','home_score','away_score'].every(field=>verified[field]===game[field]),'Résultat vérifié incompatible avec le match personnel.');
      const finalGame=verified||game,result=regularGameResult(finalGame);
      ensure(result.status!=='pending','Résultat personnel final non confirmé.');
      return {id:game.id,away_team:game.away_team,home_team:game.home_team,
        away_score:game.away_score,home_score:game.home_score,
        picked_team:pick.picked_team,predicted_spread:pick.predicted_spread,
        points:pointsByPick[pick.id],resultText:officialResultText(finalGame),
        ...(result.status==='tie'?{exceptionalNote:REGULAR_TIE_NOTE}:{})};
    });
  ensure(games.length>0,'Aucun match admissible.');
  return {season,week,nextWeek,score:{points:score.score,rank:score.rank,participants:weekly.length},
    qb:{...qb,rank:qbRanks.find(q=>q.userId===qb.actual.espn_athlete_id).rank,count:used.size},
    overall:{rank,previousRank:previousRank||null,movement:previousRank?previousRank-rank:null,
      total:overall.find(s=>s.userId===userId).total},games,teams:state.teams};
}
