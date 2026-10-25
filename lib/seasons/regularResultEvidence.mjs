import {finalEvent,json,mapBounded} from '../regular-publication/espn.mjs';
import {regularGameResult} from './regularResults.mjs';

const SITE='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const score=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0;

// Read-only compatibility for stored scores whose legacy rows lack FINAL proof.
// Each load rechecks ESPN; this never repairs, publishes or persists any source.
export async function confirmLegacyRegularResults(games,teams,{season,fetcher=fetch}={}) {
  if(!Number.isInteger(season)||season<2026||!Array.isArray(teams)||teams.length===0)return games;
  const groups=new Map(),confirmed=new Map();
  for(const game of games){
    if(game?.season!==season||game.season_type!=='regular'||regularGameResult(game).status!=='pending'||
      !Number.isInteger(game.week)||game.week<1||game.week>18||!/^\d+$/.test(String(game.external_game_id??''))||
      !score(game.home_score)||!score(game.away_score))continue;
    if(!groups.has(game.week))groups.set(game.week,[]);
    groups.get(game.week).push(game);
  }
  await mapBounded([...groups],async([week,localGames])=>{
    try{
      if(new Set(localGames.map(game=>String(game.external_game_id))).size!==localGames.length)return;
      const board=await json(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`,fetcher);
      if(board.season?.year!==season||board.season?.type!==2||board.week?.number!==week||!Array.isArray(board.events))return;
      const ids=board.events.map(event=>String(event?.id??''));
      if(ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length||
        localGames.some(game=>!ids.includes(String(game.external_game_id))))return;
      const events=new Map(board.events.map(event=>[String(event.id),event]));
      for(const game of localGames){
        try{
          const official=finalEvent(events.get(String(game.external_game_id)),season,week,teams);
          if(official.home_team!==game.home_team||official.away_team!==game.away_team||
            official.home_score!==Number(game.home_score)||official.away_score!==Number(game.away_score))continue;
          confirmed.set(game,{...game,result_status:'final'});
        }catch{/* A live, changed or unproven event remains readable and pending. */}
      }
    }catch{/* Provider failure never hides the saved scores or choices. */}
  },4);
  return games.map(game=>confirmed.get(game)||game);
}
