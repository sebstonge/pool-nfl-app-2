import {loadLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
import {selectionSnapshot} from '../seasons/qbSnapshot.mjs';
import {regularGameResult,regularPickResult} from '../seasons/regularResults.mjs';
import {regularEventKey} from '../seasons/regularClient.mjs';
import {deliverRankingEvents,rankingDeliveryTime} from '../notifications/rankingDelivery.mjs';
import {prepareEspnWeek,prepareEspnStandings,selectedQbGames} from './espnWeek.mjs';

export function calculateRegularWeek(state,{teams} = {}) {
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
      const qbGames = teams ? selectedQbGames(selected,state.games,teams).map(({game}) => game)
        : state.games.filter(g => [g.home_team,g.away_team].some(t => String(t).toLowerCase().includes(selected.team.toLowerCase())));
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

function sameWeek(context, {season,week,revision}) {
  return regularIsOpen(context) && context.current_season === season && context.current_week === week && context.revision === revision;
}

function completeRating(rating) {
  return rating?.passer_rating != null && String(rating.passer_rating).trim() !== ''
    && Number(rating.passer_rating) >= 0 && Number(rating.passer_rating) <= 158.3
    && String(rating.actual_qb_name ?? '').trim() !== ''
    && /^[0-9]{1,18}$/.test(String(rating.actual_espn_athlete_id ?? ''));
}

function prospectiveWeek(source, {games,ratings}, mode) {
  const gamePatches = new Map(games.map(game => [game.id,game]));
  const ratingsBySlot = new Map(source.qb_ratings.map(rating => [rating.qb_id,rating]));
  for (const rating of ratings) {
    if (mode !== 'automatic' || !completeRating(ratingsBySlot.get(rating.qb_id))) {
      ratingsBySlot.set(rating.qb_id,rating);
    }
  }
  return {...source,
    games:source.games.map(game => mode === 'automatic' && game.result_status === 'final' && regularGameResult(game).status !== 'pending'
      ? game : {...game,...gamePatches.get(game.id)}),
    qb_ratings:[...ratingsBySlot.values()],
  };
}

async function commitWeek(client,request,mode,{fetcher=fetch,now=()=>new Date(),prepare=prepareEspnWeek,standings=prepareEspnStandings,context}={}) {
  const {season,week,revision,actor=null} = request;
  if (!sameWeek(context ?? await loadLifecycle(client),request)) throw Error('Contexte régulier périmé ou fermé.');
  const source = await client.rpc('regular_week_ranking_state',{p_season:season,p_week:week});
  if (source.error) throw source.error;
  if (!sameWeek(source.data.settings,request)) throw Error('Contexte régulier périmé ou fermé.');

  const teams = await client.from('teams').select('id,name,espn_abbr');
  if (teams.error) throw teams.error;
  const availableTeams = teams.data ?? [];
  const qbNotificationsDue = new Set();
  if ((mode === 'qb-only' || mode === 'automatic') && source.data.qb_picks.length) {
    // The old worker could commit a rating and fail before reserving its push.
    // Recheck only matches with no existing reservation. The SQL deduplication
    // remains authoritative if another worker reserves the key in the meantime.
    const keys = new Map(source.data.qb_picks.map(pick => [
      regularEventKey(season,`qb-final-week-${week}-user-${pick.user_id}`),pick.qb_id,
    ]));
    const previous = await client.from('push_notification_events').select('event_key').in('event_key',[...keys.keys()]);
    if (previous.error) throw previous.error;
    for (const {event_key} of previous.data ?? []) keys.delete(event_key);
    for (const qbId of keys.values()) qbNotificationsDue.add(qbId);
  }
  const providerDeadline = AbortSignal.timeout(35_000);
  const boundedFetch = (url,options={}) => fetcher(url,{...options,
    signal:options.signal ? AbortSignal.any([providerDeadline,options.signal]) : providerDeadline,
  });
  const plan = await prepare(source.data,{mode,teams:availableTeams,fetcher:boundedFetch,qbNotificationsDue});
  const warnings = [...plan.warnings];
  if ((mode === 'automatic' || mode === 'qb-only') && !plan.games.length && !plan.ratings.length) {
    const status = warnings.length ? 'waiting_for_data' : plan.pending > 0 ? 'waiting_for_final' : 'no_change';
    return {week,status,warnings,pending:plan.pending};
  }
  let teamPatches = [];
  if (mode === 'manual' || (mode === 'automatic' && (plan.games.length || plan.ratings.length))) {
    try {
      const report = await standings(availableTeams,{fetcher:boundedFetch,season});
      teamPatches = report.teams;
      warnings.push(...report.warnings);
    } catch (error) {
      warnings.push('Équipes NFL : '+(error?.message || 'classements ESPN indisponibles'));
    }
  }
  const results = mode === 'qb-only' ? [] : calculateRegularWeek(prospectiveWeek(source.data,plan,mode),{teams:availableTeams});
  const committed = await client.rpc('commit_regular_week_results',{
    p_season:season,p_week:week,p_revision:revision,p_actor:actor,p_mode:mode,p_expected:source.data,
    p_games:plan.games,p_ratings:plan.ratings,p_results:results,p_scheduled_for:rankingDeliveryTime(now()),
    p_qb_stats:plan.qbStats,p_teams:teamPatches,
  });
  if (committed.error) throw committed.error;
  return {week,status:'committed',updated:committed.data.updated,publication:committed.data,warnings,pending:plan.pending,
    completed:{scores:committed.data.games_updated,teams:committed.data.teams_updated,
      qb:committed.data.ratings_updated,rankings:committed.data.updated},
    qbStats:committed.data.qb_stats_updated};
}

async function deliverRankings(client,{season,week},send,now) {
  try { return await deliverRankingEvents(client,send,{season,week,now}); }
  catch {return {sent:0,failed:1,scheduled:0,noSubscription:0};}
}

export async function publishRegularWeek(client,request,send,options={}) {
  const report = await commitWeek(client,request,'manual',options);
  report.notifications = await deliverRankings(client,request,send,options.now);
  return report;
}

export async function advanceRegularWeek(client,request,options={}) {
  const report = await commitWeek(client,request,'close',options);
  return report.publication.advance;
}

export async function syncScheduledRegularWeek(client,{automatic=false},send,options={}) {
  const context = await loadLifecycle(client);
  if (!regularIsOpen(context)) return {skipped:'regular_closed'};
  const request = {season:context.current_season,week:context.current_week,revision:context.revision};
  let report;
  try {
    report = await commitWeek(client,request,automatic ? 'automatic' : 'qb-only',{...options,context});
  } finally {
    // A prior transaction may have published and exited before delivery.
    const notifications = automatic ? await deliverRankings(client,request,send,options.now) : undefined;
    if (report && notifications) report.notifications = notifications;
  }
  return report;
}
