'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import PlayoffTree from './PlayoffTree';
import { collectiveRounds, consensus, fetchLiveGame, initialRound, loadCollectiveData, playerName, teamPathGroups, espnSummaryUrl } from './collectiveData.mjs';
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

function DetailDialog({ detail, players, onClose }) {
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
      {detail.groups.map(group => <section key={group.team}>
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
  return <p className={styles.score}>{official ? `${game.away_score} – ${game.home_score} · Score officiel`
    : `${live.awayScore} – ${live.homeScore} · ${live.state === 'in' ? 'En direct' : 'Terminé ESPN'} (provisoire)`}
    {!official && live?.detail ? ` · ${live.detail}` : ''}</p>;
}

// Data is supplied separately so the visual collective view can be verified without
// accessing production. All submitted selections are displayed, with no reveal gate.
export function CollectiveView({ data, selected, onRoundChange, onSeasonChange, onRefresh, liveGames = {}, liveError = false }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => { setDetail(null); }, [data, selected]);
  const rounds = collectiveRounds(data.rounds, data.games);
  const current = rounds.find(round => round.key === selected) || rounds[0];
  const paths = teamPathGroups(data.paths, current.id);
  const qbs = current.id ? data.qbPicks.filter(pick => pick.round_id === current.id) : [];
  const players = Object.fromEntries(data.players.map(player => [player.id, player]));
  return <main className={styles.page}>
    <header className={styles.header}>
      <h1>Tous les choix</h1><p>Séries NFL{data.season != null ? ` · ${data.season}` : ''} · {current.title}</p>
      <div className={styles.toolbar}>
        {data.seasons.length > 1 && <label>Saison<select value={data.season} onChange={event => onSeasonChange(Number(event.target.value))}>
          {data.seasons.map(season => <option key={season}>{season}</option>)}
        </select></label>}
        <label>Ronde consultée<select value={current.key} onChange={event => onRoundChange(event.target.value)}>
          {rounds.map(round => <option value={round.key} key={round.key}>{round.title}</option>)}
        </select></label>
        <button type="button" className={styles.button} onClick={onRefresh}>Actualiser</button>
      </div>
    </header>
    {!data.rounds.length && <p className={styles.muted}>Aucune ronde de séries disponible pour le moment.</p>}
    <section className={styles.section} aria-labelledby="collective-qbs">
      <h2 id="collective-qbs">QB de la ronde · {current.title}</h2>
      {!qbs.length ? <p className={styles.muted}>Aucun QB soumis pour cette ronde.</p> : <div className={styles.grid}>
        {qbs.map(pick => {
          const qb = pick.qbs;
          return <article className={styles.qbCard} key={pick.id}>
            <Photo qb name={qb?.name} src={qb?.espn_athlete_id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png` : null} />
            <div className={styles.qbInfo}><strong>{qb?.name || 'QB indisponible'}</strong><small className={styles.muted}>{qb?.team}</small>
              <PlayerIdentity player={players[pick.user_id]} /></div>
          </article>;
        })}
      </div>}
    </section>
    {liveError && <p role="status" className={styles.muted}>Le suivi ESPN est temporairement indisponible. Les scores officiels restent affichés.</p>}
    <PlayoffTree rounds={rounds} teams={data.teams} currentRoundKey={selected} selectedRoundKey={selected} onRoundChange={onRoundChange}
      renderGameSummary={game => {
        const summary = consensus(game, data.picks);
        return <div className={styles.consensus}>
          <Score game={game} live={liveGames[game.id]} />
          {summary.total ? <>
            <div className={styles.countRow}><span>{game.away_team}</span><strong>{summary.away.length}</strong><span>{summary.awayPercent} %</span></div>
            <div className={styles.countRow}><span>{game.home_team}</span><strong>{summary.home.length}</strong><span>{summary.homePercent} %</span></div>
            <span className={styles.muted}>{summary.total} choix soumis</span>
          </> : <p className={styles.muted}>Aucun choix soumis.</p>}
          <button type="button" className={`${styles.button} ${styles.detailButton}`} aria-label={`Voir les choix : ${game.away_team} @ ${game.home_team}`}
            onClick={() => setDetail({ kind: 'game', title: `${game.away_team} @ ${game.home_team}`, groups: [
              { team: game.home_team, rows: summary.home }, { team: game.away_team, rows: summary.away },
            ] })}>Voir les choix</button>
        </div>;
      }}
      renderRoundSummary={round => <p className={styles.roundNote}>{round.id ? `${round.games.length} match${round.games.length !== 1 ? 's' : ''} enregistré${round.games.length !== 1 ? 's' : ''}` : 'Ronde à venir'}</p>}
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
    {detail && <DetailDialog detail={detail} players={data.players} onClose={() => setDetail(null)} />}
  </main>;
}

export default function CollectivePlayoffTree() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('wild_card');
  const [season, setSeason] = useState();
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [liveGames, setLiveGames] = useState({});
  const [liveError, setLiveError] = useState(false);
  const previousSeason = useRef(null);
  useEffect(() => {
    const { data: auth } = supabase.auth.onAuthStateChange(() => {
      setData(null);
      setReload(value => value + 1);
    });
    return () => auth.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(false); setLiveGames({});
    loadCollectiveData(supabase, season).then(next => {
      if (cancelled) return;
      const sameSeason = previousSeason.current === next.season;
      setSelected(old => sameSeason ? old : initialRound(next.rounds, next.games));
      previousSeason.current = next.season;
      setData(next);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [season, reload]);
  useEffect(() => {
    const controller = new AbortController();
    let timeout;
    setLiveGames({}); setLiveError(false);
    if (!data) return () => controller.abort();
    const games = data.games.filter(game => espnSummaryUrl(game) && (game.away_score == null || game.home_score == null));
    if (!games.length) return () => controller.abort();
    async function refresh() {
      const results = await Promise.allSettled(games.map(game => fetchLiveGame(game, fetch, controller.signal)));
      if (controller.signal.aborted) return;
      const next = {};
      results.forEach((result, index) => { if (result.status === 'fulfilled' && result.value) next[games[index].id] = result.value; });
      setLiveGames(next);
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
  return <CollectiveView data={data} selected={selected} onRoundChange={setSelected} onSeasonChange={setSeason}
    onRefresh={() => setReload(value => value + 1)} liveGames={liveGames} liveError={liveError} />;
}
