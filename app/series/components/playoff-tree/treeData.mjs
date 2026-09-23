export const ROUNDS = [
  { key: 'wild_card', title: 'Wild Card', short: 'WC' },
  { key: 'divisional', title: 'Divisional', short: 'DIV' },
  { key: 'conference', title: 'Finales de conférence', heading: 'Conférence', short: 'CONF' },
  { key: 'super_bowl', title: 'Super Bowl', short: 'SB' },
];

export function hasCompleteSubmission({ roundId, games, picks, paths, qbPicks, userId }) {
  const currentGames = games.filter(game => game.round_id === roundId);
  return Boolean(userId && roundId && currentGames.length &&
    qbPicks.some(row => row.user_id === userId && row.round_id === roundId && row.qb_id) &&
    paths.some(row => row.user_id === userId && row.round_id === roundId && row.team) &&
    currentGames.every(game => picks.some(pick =>
      pick.user_id === userId && pick.game_id === game.id &&
      [game.away_team, game.home_team].includes(pick.picked_team) &&
      pick.predicted_spread !== null && pick.predicted_spread !== undefined
    )));
}

export function buildRounds({ rounds, games, picks, paths }) {
  return ROUNDS.map(definition => {
    const round = rounds.find(row => row.round_key === definition.key);
    return {
      ...definition,
      id: round?.id,
      games: round ? games.filter(game => game.round_id === round.id).map(game => ({
        ...game,
        pick: picks.find(pick => pick.game_id === game.id) || null,
      })) : [],
      path: round ? paths.find(path => path.round_id === round.id) || null : null,
    };
  });
}

// Read-only loader. Games (including TEST-*) are never sent to ESPN.
export async function loadPersonalTree(client, { season, roundId, userId }) {
  async function read(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  const rounds = await read(client.from('playoff_rounds').select('*').eq('season', season).order('round_order'));
  const roundIds = rounds.map(round => round.id);
  if (!roundIds.length) return { rounds: buildRounds({ rounds: [], games: [], picks: [], paths: [] }), complete: false };
  const [games, paths, qbPicks] = await Promise.all([
    read(client.from('playoff_games').select('*').in('round_id', roundIds).order('game_date')),
    read(client.from('playoff_team_paths').select('*').eq('user_id', userId).in('round_id', roundIds)),
    read(client.from('playoff_qb_picks').select('user_id, round_id, qb_id').eq('user_id', userId).eq('round_id', roundId)),
  ]);
  const picks = games.length ? await read(client.from('playoff_picks').select('*').eq('user_id', userId).in('game_id', games.map(game => game.id))) : [];
  return {
    complete: hasCompleteSubmission({ roundId, userId, games, picks, paths, qbPicks }),
    rounds: buildRounds({ rounds, games, picks, paths }),
  };
}
