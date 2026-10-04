import { RoundError } from './rounds.mjs';
import { finalWinner } from './scoring.mjs';

// Controlled copy of app/admin/page.js:updateQBRatingsFromEspn. The regular
// implementation stays unchanged: same passing category, labels and Number()
// conversion, same selected-id/name match, otherwise first numeric passer.
export function summaryQuarterbacks(summary,teamName) {
  let passingAthletes=[];
  for(const teamBox of summary?.boxscore?.players||[]){
    const name=teamBox.team?.shortDisplayName||teamBox.team?.displayName||teamBox.team?.name||'';
    if(!name.toLowerCase().includes(teamName.toLowerCase()))continue;
    const category=teamBox.statistics?.find(c=>c.name==='passing'||c.displayName==='Passing');
    if(!category)continue;
    const ratingIndex=(category.labels||[]).findIndex(label=>['RTG','RAT','RATE'].includes(String(label).toUpperCase()));
    if(ratingIndex===-1)continue;
    passingAthletes=category.athletes.map(row=>({id:row.athlete?.id,name:row.athlete?.displayName,rating:Number(row.stats?.[ratingIndex])})).filter(row=>!Number.isNaN(row.rating));
  }
  return passingAthletes;
}
export function selectRegularPasser(selected,players) {
  const passers=players.map(p=>({...p,rating:Number(p.rating)})).filter(p=>!Number.isNaN(p.rating));
  if(!passers.length)throw new RoundError('Aucun rating de passeur disponible.');
  const chosen=selected.espn_athlete_id
    ?passers.find(p=>String(p.id)===String(selected.espn_athlete_id))
    :passers.find(p=>p.name?.toLowerCase().includes(selected.name.toLowerCase()));
  return {actual:chosen||passers[0],fallback:!chosen};
}
export function resolveQB(selected,players,game) {
  if(!finalWinner(game))throw new RoundError('Rating réservé aux matchs FINAL.');
  const {actual,fallback}=selectRegularPasser(selected,players);
  if(!Number.isFinite(actual.rating)||actual.rating<0||actual.rating>158.3)throw new RoundError('Rating QB incomplet.');
  return {selected_qb_id:selected.id,actual_espn_athlete_id:String(actual.id),actual_qb_name:actual.name,team:selected.team,
    passer_rating:actual.rating,consumed:!fallback,dnp:fallback,game_id:game.id,participation:fallback?'regular_passing_fallback':'regular_selected_passer'};
}
