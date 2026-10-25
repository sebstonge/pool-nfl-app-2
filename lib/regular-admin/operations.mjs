import {loadLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
import {selectionSnapshot} from '../seasons/qbSnapshot.mjs';
import {regularGameResult,regularPickResult} from '../seasons/regularResults.mjs';
import {deliverRankingEvents,rankingDeliveryTime} from '../notifications/rankingDelivery.mjs';

export function calculateRegularWeek(state) {
  const games = new Map(state.games.map(g => [g.id,g]));
  const members = new Set(state.participants.filter(p => p.confirmed).map(p => p.user_id));
  const totals = new Map();
  for (const pick of state.picks) {
    const game = games.get(pick.game_id);
    if (!game || !game.is_pool_eligible) continue;
    if (!members.has(pick.user_id)) throw Error('Participant de saison absent.');
    const result = regularPickResult(game,pick);
    if (result.points === null) continue;
    totals.set(pick.user_id,(totals.get(pick.user_id) || 0) + result.points);
  }
  return [...totals].map(([user_id,base_points]) => {
    const choice = state.qb_picks.find(q => q.user_id === user_id);
    if (!choice) throw Error('Choix QB nécessaire absent.');
    const rating = state.qb_ratings.find(r => r.qb_id === choice.qb_id);
    if (rating?.passer_rating == null) {
      const selected = selectionSnapshot(choice);
      if (!selected) throw Error('Identité QB historique à confirmer.');
      const qbGames = state.games.filter(g => [g.home_team,g.away_team].some(t => String(t).toLowerCase().includes(selected.team.toLowerCase())));
      if (qbGames.length !== 1) throw Error('Match du QB absent ou ambigu.');
      if (regularGameResult(qbGames[0]).status !== 'pending') throw Error('Rating QB final attendu mais indisponible.');
    }
    const passerRating = rating?.passer_rating == null ? 0 : Number(rating.passer_rating);
    if (!Number.isFinite(passerRating) || passerRating < 0 || passerRating > 158.3) throw Error('Rating QB invalide.');
    const multiplier = passerRating > 0 ? passerRating / 100 : 1;
    return {user_id,week:state.settings.current_week,base_points,
      multiplier:Number(multiplier.toFixed(3)),final_score:Number((base_points*multiplier).toFixed(3))};
  }).sort((a,b) => a.user_id.localeCompare(b.user_id));
}

export async function publishRegularWeek(client,{season,week,revision,actor},send,{now = () => new Date()} = {}) {
  const context = await loadLifecycle(client);
  if (!regularIsOpen(context) || context.current_season !== season || context.current_week !== week || context.revision !== revision) throw Error('Contexte régulier périmé ou fermé.');
  const source = await client.rpc('regular_week_ranking_state',{p_season:season,p_week:week});
  if (source.error) throw source.error;
  const results = calculateRegularWeek(source.data);
  const committed = await client.rpc('publish_regular_week',{p_season:season,p_week:week,p_revision:revision,p_actor:actor,
    p_expected:source.data,p_results:results,p_scheduled_for:rankingDeliveryTime(now())});
  if (committed.error) throw committed.error;
  const report = {updated:committed.data.updated,publication:committed.data,warnings:[]};
  try { report.notifications = await deliverRankingEvents(client,send,{season,week,now}); }
  catch {report.notifications = {sent:0,failed:1,scheduled:0,noSubscription:0};report.warnings.push('Classement enregistré; notifications en attente de reprise.');}
  return report;
}

export async function advanceRegularWeek(client,{season,week,revision,actor}) {
  const result = await client.rpc('advance_regular_week',{p_season:season,p_week:week,p_revision:revision,p_actor:actor});
  if (result.error) throw result.error;
  return result.data;
}
