// Presentation only. Availability/consumption rules remain in Mes choix.
export function qbHistory(picks, ratings, qbs) {
  return [...picks].sort((a, b) => Number(a.week) - Number(b.week)).map(pick => {
    const qb = qbs.find(q => q.id === pick.qb_id) || pick.qbs;
    if (!qb) return null;
    const result = ratings.find(r => r.qb_id === pick.qb_id && Number(r.week) === Number(pick.week));
    const selectedId = pick.qbs?.espn_athlete_id || qb.espn_athlete_id;
    const actualId = result?.actual_espn_athlete_id;
    const replaced = !!(selectedId && actualId && String(selectedId) !== String(actualId));
    const value = result?.passer_rating;
    const rating = value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
    const details = [`Semaine ${pick.week}`];
    if (replaced) {
      details.push(`Sélection : ${qb.name}`, `Remplacement : ${result.actual_qb_name || "QB remplaçant non identifié"}`);
      details.push("Remplacement automatique : aucun des deux QB n’est consommé.");
    } else if (result?.actual_qb_name && !selectedId) {
      details.push(`QB enregistré : ${result.actual_qb_name}`);
    }
    details.push(rating === null ? "Passer Rating final en attente" : `Passer Rating final : ${rating.toFixed(1)}`);
    return {...qb, historyKey: `${pick.week}-${pick.qb_id}`, week: Number(pick.week), replaced, rating, details};
  }).filter(Boolean);
}
