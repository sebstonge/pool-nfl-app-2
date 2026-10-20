import {regularQbResult,ratingForPick} from './qbSnapshot.mjs';
// Presentation only. Current catalog rows are deliberately ignored.
export function qbHistory(picks, ratings) {
  return [...picks].sort((a, b) => Number(a.week) - Number(b.week)).map(pick => {
    const outcome = regularQbResult(pick, ratingForPick(pick, ratings));
    const qb = outcome.selected || outcome.actual || {id:pick.qb_id,name:'QB historique non identifié',team:'',espn_athlete_id:null};
    const details = [`Semaine ${pick.week}`];
    if (outcome.replaced) {
      details.push(`Sélection : ${outcome.selected.name}`, `Remplacement : ${outcome.actual.name}`);
      details.push('Remplacement automatique : aucun des deux QB n’est consommé.');
    } else if (!outcome.selected) {
      details.push('Identité sélectionnée à confirmer.');
    }
    details.push(outcome.rating === null ? 'Passer Rating final en attente' : `Passer Rating final : ${outcome.rating.toFixed(1)}`);
    return {...qb,id:pick.qb_id,historyKey:`${pick.week}-${pick.qb_id}`,week:Number(pick.week),replaced:outcome.replaced,rating:outcome.rating,details};
  });
}
