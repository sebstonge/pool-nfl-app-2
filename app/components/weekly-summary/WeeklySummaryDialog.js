"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getQbHeadshot, pointsPresentation, ratingColor, teamLogoUrl } from "./presentation.mjs";
import styles from "./WeeklySummaryDialog.module.css";

function numberLabel(value, maximumFractionDigits = 3) {
  return value != null && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("fr-CA", { maximumFractionDigits })
    : "—";
}

function rankLabel(rank) {
  return Number.isInteger(Number(rank)) && Number(rank) > 0
    ? `${rank}${Number(rank) === 1 ? "er" : "e"}`
    : "—";
}

function TeamMark({ name, teams }) {
  const source = teamLogoUrl(name, teams);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return source && !failed
    ? <img className={styles.teamLogo} src={source} alt="" onError={() => setFailed(true)} />
    : <span className={styles.teamFallback} aria-hidden="true">{name?.slice(0, 2) || "—"}</span>;
}

function QbPortrait({ qb }) {
  const source = getQbHeadshot(qb);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return source && !failed
    ? <img className={styles.qbPortrait} src={source} alt="" onError={() => setFailed(true)} />
    : <span className={`${styles.qbPortrait} ${styles.qbFallback}`} aria-hidden="true">QB</span>;
}

function OverallMovement({ overall }) {
  const movement = overall?.movement;
  const hasMovement = typeof movement === "number" && Number.isFinite(movement);
  if (!hasMovement) return <span className={styles.movementNeutral}>Évolution non disponible</span>;
  if (movement === 0) return <span className={styles.movementNeutral}>→ Position inchangée</span>;
  return (
    <span className={movement > 0 ? styles.movementUp : styles.movementDown}>
      <span aria-label={`${Math.abs(movement)} ${Math.abs(movement) === 1 ? "place" : "places"} ${movement > 0 ? "gagnées" : "perdues"}`}>{movement > 0 ? "▲ +" : "▼ −"}{Math.abs(movement)}</span>
    </span>
  );
}

function GameRow({ game, teams }) {
  const points = pointsPresentation(game.points);
  const dot = { red: "🔴", yellow: "🟡", green: "🟢", neutral: "⚪" }[points.tone];
  return (
    <li className={styles.gameRow}>
      <div className={styles.matchup} aria-label="Score final">
        <div className={styles.teamLine}>
          <TeamMark name={game.away_team} teams={teams} />
          <span className={styles.teamName}>{game.away_team}</span>
        </div>
        <strong className={styles.teamScore}>{numberLabel(game.away_score, 0)}</strong>
        <span className={styles.at} aria-label="chez">@</span>
        <strong className={styles.teamScore}>{numberLabel(game.home_score, 0)}</strong>
        <div className={styles.teamLine}>
          <TeamMark name={game.home_team} teams={teams} />
          <span className={styles.teamName}>{game.home_team}</span>
        </div>
      </div>
      <div className={styles.pickResult}>
        <p className={styles.gamePick}><span className={styles.detailLabel}>Ton choix</span>{game.picked_team} par {numberLabel(game.predicted_spread, 0)}</p>
        <div className={styles.resultGroup}>
          <div className={styles.gameResult}>
            <span className={styles.detailLabel}>Résultat</span>{game.resultText || "Résultat non disponible"}
            {game.exceptionalNote && <p className={styles.exceptionalNote}>{game.exceptionalNote}</p>}
          </div>
          <span className={styles.points}>{points.label}</span>
          <span className={styles.resultDot} aria-hidden="true">{dot}</span>
        </div>
      </div>
    </li>
  );
}

/** Presentation only: all identity, result and ranking decisions belong to summary. */
export default function WeeklySummaryDialog({ summary, onClose, busy = false, error = "" }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const isOpen = Boolean(summary);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  if (!summary) return null;
  const { week, season, nextWeek, score = {}, qb = {}, overall = {}, games = [], teams = [] } = summary;
  const displayedQb = qb.actual || qb.selected;
  const requestClose = () => { if (!busy) onClose?.(); };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      aria-busy={busy || undefined}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
    >
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>SAISON {season}</p>
            <h2 id={titleId} className={styles.title}>Ta semaine {week}, en résumé</h2>
            <p id={descriptionId} className={styles.subtitle}>Les résultats officiels de tes choix.</p>
          </div>
          <button ref={closeRef} className={styles.closeButton} type="button" onClick={requestClose} disabled={busy} aria-label="Fermer le résumé de la semaine">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.tiles}>
            <section className={`${styles.tile} ${styles.scoreTile}`} aria-label="Ton score de la semaine">
              <div className={styles.scoreMain}>
                <svg className={styles.scoreIcon} viewBox="0 0 48 56" aria-hidden="true"><path fill="currentColor" d="M12 3h24v7h9v8c0 8-5 13-13 14-1 4-3 6-5 7v7h9v7H12v-7h9v-7c-3-1-5-4-6-7C7 31 2 26 2 18v-8h10V3Zm0 12H7v3c0 4 2 7 6 8l-1-11Zm24 0-1 11c4-1 5-4 5-8v-3h-4Z" /></svg>
                <div className={styles.scoreDetails}><p className={styles.tileLabel}>Ton score</p><div className={styles.scoreValue}>{numberLabel(score.points)} <span>pts</span></div></div>
              </div>
              <div className={styles.tileDivider} />
              <p className={styles.scoreRank}><strong>{rankLabel(score.rank)}</strong> cette semaine <span>· {numberLabel(score.participants, 0)} joueurs</span></p>
            </section>

            <section className={`${styles.tile} ${styles.qbTile}`} aria-label="Ton quart-arrière de la semaine">
              <p className={styles.tileLabel}>Ton QB</p>
              <div className={styles.qbIdentity}>
                <QbPortrait qb={displayedQb} />
                <div className={styles.qbDetails}>
                  <strong className={styles.qbName}>{displayedQb?.name || "QB non identifié"}</strong>
                  {displayedQb?.team && <span className={styles.qbTeam}><TeamMark name={displayedQb.team} teams={teams} />{displayedQb.team}</span>}
                </div>
              </div>
              {qb.replaced && <div className={styles.replacement}><span className={styles.replacementBadge}>🔄 Remplacement</span><span className={styles.selectedQb}>Choix initial : {qb.selected?.name || "QB non identifié"}</span></div>}
              <div className={styles.qbStats}>
                <div className={styles.qbRating}><span>Passer rating</span><strong style={qb.rating != null ? { color: ratingColor(qb.rating) } : undefined}>{numberLabel(qb.rating, 1)}</strong></div>
                <div className={styles.qbRank}><span><strong>{rankLabel(qb.rank)}</strong> sur {numberLabel(qb.count, 0)}</span><span>QB utilisés</span></div>
              </div>
            </section>

            <section className={`${styles.tile} ${styles.overallTile}`} aria-label="Ton classement général">
              <p className={styles.tileLabel}>Au classement général</p>
              <div className={styles.overallMain}>
                <svg className={styles.overallIcon} viewBox="0 0 44 48" aria-hidden="true"><rect x="1" y="24" width="11" height="24" rx="3" fill="#22c55e" /><rect x="16" y="3" width="11" height="45" rx="3" fill="#38bdf8" /><rect x="31" y="24" width="11" height="24" rx="3" fill="#f43f5e" /></svg>
                <div className={styles.overallRank}>{rankLabel(overall.rank)}</div>
                <OverallMovement overall={overall} />
              </div>
              <div className={styles.tileDivider} />
              <div className={styles.tileFoot}><span>Total de la saison</span><strong>{numberLabel(overall.total)} <span className={styles.rankCount}>pts</span></strong></div>
            </section>
          </div>

          <section className={styles.gamesSection} aria-labelledby={`${titleId}-games`}>
            <div className={styles.gamesHeading}><h3 id={`${titleId}-games`}>Tes choix de matchs</h3><span>{games.length} {games.length === 1 ? "match" : "matchs"}</span></div>
            {games.length > 0 ? <ul className={styles.gameList}>{games.map((game) => <GameRow key={game.id} game={game} teams={teams} />)}</ul> : <p className={styles.emptyGames}>Aucun choix de match pour cette semaine.</p>}
          </section>
        </div>

        <footer className={styles.footer}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.continueButton} type="button" onClick={requestClose} disabled={busy}>
            {busy ? "Enregistrement…" : `Continuer vers la semaine ${nextWeek}`}
            {!busy && <span aria-hidden="true">→</span>}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
