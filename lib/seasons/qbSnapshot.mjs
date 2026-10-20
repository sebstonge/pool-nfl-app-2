// Regular-season identity belongs to a selection, never to today's QB catalog.
const text = value => value == null ? '' : String(value).trim();
export function selectionSnapshot(pick) {
  if (!pick || !text(pick.selected_qb_name) || !text(pick.selected_espn_athlete_id) || !text(pick.selected_team)) return null;
  return {id:pick.qb_id,name:pick.selected_qb_name,espn_athlete_id:String(pick.selected_espn_athlete_id),team:pick.selected_team};
}
export function ratingForPick(pick, ratings) {
  return ratings.find(r => r.qb_id === pick.qb_id && Number(r.week) === Number(pick.week) &&
    (r.season == null || pick.season == null || Number(r.season) === Number(pick.season)));
}
export function regularQbResult(pick, result) {
  const selected = selectionSnapshot(pick);
  const matches = result && (!result.qb_id || result.qb_id === pick?.qb_id) &&
    (result.week == null || Number(result.week) === Number(pick?.week)) &&
    (result.season == null || pick?.season == null || Number(result.season) === Number(pick.season));
  const value = matches ? result.passer_rating : null;
  const rating = value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const actualId = matches ? text(result.actual_espn_athlete_id) : '';
  const replacementKnown = !!(selected && rating !== null && actualId);
  const replaced = replacementKnown && String(selected.espn_athlete_id) !== actualId;
  const actual = rating === null ? null : {
    name:text(result.actual_qb_name) || (actualId && selected && actualId !== selected.espn_athlete_id ? 'QB utilisé non identifié' : selected?.name) || 'QB historique non identifié',
    espn_athlete_id:actualId || null,
    team:selected?.team || '',
  };
  return {selected,actual,replaced,replacementKnown,rating};
}
export function isQbConsumed(qb, picks, ratings) {
  return picks.some(pick => {
    const outcome = regularQbResult(pick, ratingForPick(pick, ratings));
    if (outcome.replaced) return false; // Existing DNP rule: neither selected nor automatic substitute is consumed.
    if (!outcome.selected) return pick.qb_id === qb.id; // Unknown legacy selection: keep conservative availability until reviewed.
    return text(qb.espn_athlete_id) === outcome.selected.espn_athlete_id;
  });
}
