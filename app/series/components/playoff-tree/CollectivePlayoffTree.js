'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import PlayoffTree from './PlayoffTree';
import { collectiveRounds, consensus, fetchLiveGame, initialRound, loadCollectiveData, playerName, teamPathGroups, espnSummaryUrl, submissionOrder } from './collectiveData.mjs';
import { projectProgression } from './collectiveProgression.mjs';
import styles from './CollectivePlayoffTree.module.css';

function PlayerIdentity({ player }) {
  return <span className={styles.identity}><strong>{playerName(player)}</strong>
    {player?.display_name && player?.real_name && player.display_name !== player.real_name && <small>{player.real_name}</small>}
  </span>;
}

function Photo({ src, name, qb = false }) {
  const [failed, setFailed] = useState(null);
  if (!src || src === failed) return <span className={qb ? styles.qbFallback : styles.logo} aria-hidden="true">{qb ? 'QB' : name?.slice(0, 2)}</span>;
  return <img className={qb ? undefined : styles.logo} src={src} alt="" onError={() => setFailed(src)} />;
}

function logo(teamName, teams) {
  const team = teams.find(team => team.name?.trim().toLowerCase() === teamName?.trim().toLowerCase());
  return team?.espn_abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png` : team?.logo;
}

function DetailDialog({ detail, players, teams, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const byUser = Object.fromEntries(players.map(player => [player.id, player]));
  const sortRows = rows => [...rows].sort((a, b) => playerName(byUser[a.user_id]).localeCompare(playerName(byUser[b.user_id]), 'fr'));
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{detail.title}</h2>
      <button className={styles.button} type="button" onClick={onClose} autoFocus>Fermer ×</button></header>
    <div className={styles.dialogBody}>
      {detail.kind === 'game' ? <div>
        {!detail.rows.length && <p className={styles.muted}>Aucun choix soumis.</p>}
        {submissionOrder(detail.rows).map(row => <div className={styles.playerRow} key={row.id}>
          <PlayerIdentity player={byUser[row.user_id]} />
          <div className={styles.pickChoice}><Photo name={row.picked_team} src={logo(row.picked_team, teams)} />
            <strong>{row.picked_team} par {row.predicted_spread ?? '—'}</strong>
            {/* No validated playoff pick points are supplied by the loader. */}
            <span className={styles.pointsBadge} title="Points non validés" aria-label="Points du match non validés">⚪</span>
          </div>
        </div>)}
      </div> : detail.groups.map(group => <section key={group.team}>
        <h3>{group.team} — {group.rows.length} choix</h3>
        {!group.rows.length && <p className={styles.muted}>Aucun choix soumis.</p>}
        {sortRows(group.rows).map(row => <div className={styles.playerRow} key={row.id || row.user_id}>
          <PlayerIdentity player={byUser[row.user_id]} />
          <span>{detail.kind === 'game' ? `${row.picked_team} par ${row.predicted_spread ?? '—'}`
            : row.multiplier != null ? `×${row.multiplier}` : ''}</span>
        </div>)}
      </section>)}
    </div>
  </dialog>;
}

function Score({ game, live }) {
  const official = game.away_score != null && game.home_score != null;
  if (!official && !live) return null;
  return <p className={styles.score}>{official ? `${game.away_score} – ${game.home_score} · Score officiel${live?.state === 'post' ? ' · FINAL' : live?.state === 'in' ? ' · LIVE' : ''}`
    : `${live.awayScore} – ${live.homeScore} · ${live.state === 'in' ? 'LIVE' : 'FINAL'} (provisoire)`}
    {!official && live?.detail ? ` · ${live.detail}` : ''}</p>;
}

// Data is supplied separately so the visual collective view can be verified without
// accessing production. All submitted selections are displayed, with no reveal gate.
export function CollectiveView({ data, liveGames = {}, liveError = false, seedSnapshot }) {
  const [detail, setDetail] = useState(null);
  const activeKey = initialRound(data.rounds, data.games);
  const [qbKey, setQbKey] = useState(activeKey);
  useEffect(() => { setQbKey(activeKey); }, [data.season, activeKey]);
  useEffect(() => { setDetail(null); }, [data]);
  const rounds = projectProgression(collectiveRounds(data.rounds, data.games), liveGames, seedSnapshot, data.season);
  const current = rounds.find(round => round.key === activeKey) || rounds[0];
  const qbIndex = Math.max(0, rounds.findIndex(round => round.key === qbKey));
  const qbRound = rounds[qbIndex];
  const paths = teamPathGroups(data.paths, current.id);
  const qbs = qbRound.id ? data.qbPicks.filter(pick => pick.round_id === qbRound.id) : [];
  const players = Object.fromEntries(data.players.map(player => [player.id, player]));
  return <main className={styles.page}>
    <header className={styles.header}>
      <h1>Tous les choix</h1><p>Séries NFL{data.season != null ? ` · ${data.season}` : ''}</p>

    </header>
      <nav className={styles.qbNavigation} aria-label="Ronde des QB">
        <button className={styles.roundArrow} aria-label="QB — ronde précédente" disabled={qbIndex === 0} onClick={() => setQbKey(rounds[qbIndex - 1].key)}>‹</button>
        <div aria-live="polite"><strong>{qbRound.title}</strong><small>{qbRound.key === activeKey ? 'Ronde active' : 'QB de cette ronde'}</small></div>
        <button className={styles.roundArrow} aria-label="QB — ronde suivante" disabled={qbIndex === rounds.length - 1} onClick={() => setQbKey(rounds[qbIndex + 1].key)}>›</button>
      </nav>
    {!data.rounds.length && <p className={styles.muted}>Aucune ronde de séries disponible pour le moment.</p>}
    <section className={styles.section} aria-labelledby="collective-qbs">
      <div className={styles.qbSectionHeader}><h2 id="collective-qbs">🏈 QB de la ronde</h2>
        <p>{qbs.length} sélection{qbs.length !== 1 ? 's' : ''} soumise{qbs.length !== 1 ? 's' : ''}</p></div>

      {!qbs.length ? <p className={styles.muted}>Aucun QB soumis pour cette ronde.</p> : <div className={styles.grid}>
        {qbs.map(pick => {
          const qb = pick.qbs;
          return <article className={styles.qbCard} key={pick.id}>
            <PlayerIdentity player={players[pick.user_id]} />
            <div className={styles.qbBody}>
              <Photo qb name={qb?.name} src={qb?.espn_athlete_id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png` : null} />
              <div className={styles.qbInfo}>
                <div className={styles.qbName}><Photo name={qb?.team} src={logo(qb?.team, data.teams)} /><strong>{qb?.name || 'QB indisponible'}</strong></div>
                <div className={styles.qbStats} title="Statistiques QB non disponibles pour cette ronde">
                  <div>Rating <strong>—</strong></div><div>Moyenne <strong>—</strong></div>
                </div>
              </div>
            </div>
          </article>;
        })}
      </div>}
    </section>
    {liveError && <p role="status" className={styles.muted}>Le suivi ESPN est temporairement indisponible. Les scores officiels restent affichés.</p>}
    <PlayoffTree rounds={rounds} teams={data.teams} currentRoundKey={activeKey}
      renderGameSummary={game => {
        if (game.provisional) return <p className={styles.roundNote}>Qualification provisoire · {game.conference || 'Super Bowl'}<br />{game.away_team && game.home_team ? 'Affrontement projeté' : 'Adversaire à déterminer'}</p>;
        const summary = consensus(game, data.picks);
        return <div className={styles.consensus}>
          <Score game={game} live={liveGames[game.id]} />
          {summary.total ? <>
            <div className={styles.countRow}><span>{game.away_team}</span><strong>{summary.away.length}</strong></div>
            <div className={styles.countRow}><span>{game.home_team}</span><strong>{summary.home.length}</strong></div>
          </> : <p className={styles.muted}>Aucun choix soumis.</p>}
          <button type="button" className={`${styles.button} ${styles.detailButton}`} aria-label={`Voir les choix : ${game.away_team} @ ${game.home_team}`}
            onClick={() => setDetail({ kind: 'game', title: `${game.away_team} @ ${game.home_team}`, rows: data.picks.filter(pick => pick.game_id === game.id) })}>Voir les choix</button>
        </div>;
      }}
      renderRoundSummary={round => <div className={styles.roundNote}>
        {round.qualified.map(row => <p key={row.team}><Photo name={row.team} src={logo(row.team, data.teams)} /> {row.team}{row.seed ? ` · #${row.seed} ${row.conference}` : ''} — {row.bye ? 'Bye · qualifié' : 'Qualifié provisoirement'}</p>)}
        {round.qualified.length > 0 && !round.games.some(game => game.away_team && game.home_team) && <p>Adversaires à déterminer</p>}
        {!round.qualified.length && (round.id ? `${round.games.length} match(s) enregistré(s)` : 'Ronde à venir')}
      </div>}
    />
    <section className={styles.section} aria-labelledby="collective-paths">
      <h2 id="collective-paths">Prédictions Super Bowl 🏆</h2><p className={styles.muted}>{current.title}</p>
      {!paths.length ? <p className={styles.muted}>Aucune prédiction soumise pour cette ronde.</p> : <div className={styles.predictions}>
        {paths.map(group => <button type="button" className={`${styles.button} ${styles.teamButton}`} key={group.team}
          onClick={() => setDetail({ kind: 'path', title: `${group.team} — Prédictions Super Bowl`, groups: [group] })}>
          <Photo name={group.team} src={logo(group.team, data.teams)} /><span>{group.team}</span><strong>{group.rows.length}</strong>
        </button>)}
      </div>}
    </section>
    {detail && <DetailDialog detail={detail} players={data.players} teams={data.teams} onClose={() => setDetail(null)} />}
  </main>;
}

export default function CollectivePlayoffTree() {
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [liveGames, setLiveGames] = useState({});
  const [liveError, setLiveError] = useState(false);
  useEffect(() => {
    const { data: auth } = supabase.auth.onAuthStateChange(() => {
      setData(null); setLiveGames({});
      setReload(value => value + 1);
    });
    return () => auth.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    loadCollectiveData(supabase).then(next => {
      if (cancelled) return;
      setData(next);
    }).catch(error => { console.error('[Collective playoffs] Chargement', error.message); if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => setReload(value => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timeout;
    setLiveError(false);
    if (!data || data.requiresSignIn) return () => controller.abort();
    const games = data.games.filter(game => espnSummaryUrl(game));
    if (!games.length) return () => controller.abort();
    async function refresh() {
      const results = await Promise.allSettled(games.map(game => fetchLiveGame(game, fetch, controller.signal)));
      if (controller.signal.aborted) return;
      const next = {};
      results.forEach((result, index) => { if (result.status === 'fulfilled' && result.value) next[games[index].id] = result.value; });
      setLiveGames(previous => ({ ...previous, ...next }));
      setLiveError(results.some(result => result.status === 'rejected'));
      timeout = setTimeout(refresh, 30000);
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [data]);
  if (error) return <main className={styles.page}><section className={styles.section} role="alert">
    <h1>Tous les choix — Séries</h1><p>Impossible de charger les choix des séries. Vérifie ta connexion et ta session.</p>
    <button className={styles.button} type="button" onClick={() => setReload(value => value + 1)}>Réessayer</button>
  </section></main>;
  if (!data) return <main className={styles.page}><p role="status">Chargement des choix des séries…</p></main>;
  if (data.requiresSignIn) return <main className={styles.page}><section className={styles.section}>
    <h1>Tous les choix — Séries</h1><p>Connecte-toi pour consulter les choix des participants.</p><a className={styles.button} href="/">Connexion</a>
  </section></main>;
  return <CollectiveView data={data} liveGames={liveGames} liveError={liveError} />;
}
