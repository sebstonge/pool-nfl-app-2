// Pure, read-only projection. A future backend supplies a frozen snapshot;
// current standings, array order and division ranks are never seed substitutes.
export function validatedSeeds(snapshot, season) {
  if (!snapshot?.frozen || snapshot.season !== season || snapshot.teams?.length !== 14) return [];
  const rows = snapshot.teams;
  if (new Set(rows.map(row => row.team)).size !== 14) return [];
  for (const conference of ['AFC', 'NFC']) {
    const seeds = rows.filter(row => row.conference === conference).map(row => row.seed).sort((a, b) => a - b);
    if (seeds.join(',') !== '1,2,3,4,5,6,7') return [];
  }
  return rows.every(row => row.team && Number.isInteger(row.seed)) ? rows : [];
}

export function finalWinner(game, live) {
  // Numeric scores alone do not prove FINAL. Official scored rounds may provide
  // an explicit final status in a future adapter; today ESPN is the final signal.
  if (live?.state !== 'post') return null;
  const official = game.away_score != null && game.home_score != null;
  const away = Number(official ? game.away_score : live.awayScore);
  const home = Number(official ? game.home_score : live.homeScore);
  if (!Number.isFinite(away) || !Number.isFinite(home) || away === home) return null;
  return away > home ? game.away_team : game.home_team;
}

export function projectProgression(rounds, liveGames, snapshot, season) {
  const seeds = validatedSeeds(snapshot, season);
  const byTeam = new Map(seeds.map(row => [row.team, row]));
  const result = rounds.map(round => ({ ...round, games: [...round.games], qualified: [] }));
  const winners = round => round.games.filter(game => !game.provisional).map(game => {
    const team = finalWinner(game, liveGames[game.id]);
    return team ? { team, ...byTeam.get(team) } : null;
  }).filter(Boolean);
  const pair = (key, conference, home, away) => ({
    id: `projection-${key}-${conference}-${home.team}`, provisional: true,
    home_team: home.team, away_team: away?.team || null,
    conference, home_seed: home.seed, away_seed: away?.seed,
  });
  for (let i = 1; i < result.length; i++) {
    const previous = rounds[i - 1];
    const current = result[i];
    // Real matchups always win, including partially imported rounds. Never fill
    // their remaining slots with guessed or overlapping projected games.
    if (current.games.length) continue;
    const qualified = winners(previous);
    if (i === 1) qualified.push(...seeds.filter(row => row.seed === 1).map(row => ({ ...row, bye: true })));
    current.qualified = [...new Map(qualified.map(row => [row.team, row])).values()];
    if (!seeds.length) continue;
    if (i < 3) {
      for (const conference of ['AFC', 'NFC']) {
        const sourceGames = previous.games.filter(game => byTeam.get(game.home_team)?.conference === conference && byTeam.get(game.away_team)?.conference === conference);
        const expected = i === 1 ? 3 : 2;
        const survivors = current.qualified.filter(row => row.conference === conference).sort((a, b) => a.seed - b.seed);
        const participants = sourceGames.flatMap(game => [game.home_team, game.away_team]);
        const complete = sourceGames.length === expected && new Set(participants).size === expected * 2 &&
          (i !== 1 || participants.every(team => byTeam.get(team)?.seed !== 1)) &&
          sourceGames.every(game => finalWinner(game, liveGames[game.id])) && survivors.length === (i === 1 ? 4 : 2);
        if (complete) {
          current.games.push(pair(current.key, conference, survivors[0], survivors.at(-1)));
          if (i === 1) current.games.push(pair(current.key, conference, survivors[1], survivors[2]));
        } else if (i === 1) {
          const bye = survivors.find(row => row.bye);
          if (bye) current.games.push(pair(current.key, conference, bye));
        }
      }
    } else {
      const champions = ['AFC', 'NFC'].map(conference => {
        const games = previous.games.filter(game => byTeam.get(game.home_team)?.conference === conference && byTeam.get(game.away_team)?.conference === conference);
        return games.length === 1 ? current.qualified.find(row => row.team === finalWinner(games[0], liveGames[games[0].id])) : null;
      });
      if (champions.some(Boolean)) current.games.push({ id: 'projection-super-bowl', provisional: true,
        away_team: champions[0]?.team || null, home_team: champions[1]?.team || null });
    }
  }
  return result;
}
