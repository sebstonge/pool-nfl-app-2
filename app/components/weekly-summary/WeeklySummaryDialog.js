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
      {movement > 0 ? "↑" : "↓"} {Math.abs(movement)} {Math.abs(movement) === 1 ? "place" : "places"}
      {overall.previousRank != null && <span className={styles.previousRank}> · auparavant {rankLabel(overall.previousRank)}</span>}
    </span>
  );
}

function GameRow({ game, teams }) {
  const points = pointsPresentation(game.points);
  return (
    <li className={styles.gameRow}>
      <div className={styles.matchup} aria-label="Score final">
        {["away", "home"].map((side) => (
          <div className={styles.teamLine} key={side}>
            {side === "home" && <span className={styles.at} aria-label="chez">@</span>}
            <TeamMark name={game[`${side}_team`]} teams={teams} />
            <span className={styles.teamName}>{game[`${side}_team`]}</span>
            <strong className={styles.teamScore}>{numberLabel(game[`${side}_score`], 0)}</strong>
          </div>
        ))}
      </div>
      <div className={styles.pickResult}>
        <p className={styles.gamePick}><span className={styles.mobileLabel}>Ton choix</span>{game.picked_team} par {numberLabel(game.predicted_spread, 0)}</p>
        <p className={styles.gameResult}><span className={styles.mobileLabel}>Résultat</span>{game.resultText || "Résultat non disponible"}</p>
        {game.exceptionalNote && <p className={styles.exceptionalNote}>{game.exceptionalNote}</p>}
      </div>
      <span className={`${styles.points} ${styles[points.tone]}`}>{points.label}</span>
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
              <p className={styles.tileLabel}>Ton score</p>
              <div className={styles.scoreValue}>{numberLabel(score.points)} <span>points</span></div>
              <div className={styles.tileDivider} />
              <div className={styles.tileFoot}><span>Cette semaine</span><strong>{rankLabel(score.rank)} <span className={styles.rankCount}>· {numberLabel(score.participants, 0)} joueurs</span></strong></div>
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
                <span>Passer rating <strong style={qb.rating != null ? { color: ratingColor(qb.rating) } : undefined}>{numberLabel(qb.rating, 1)}</strong></span>
                <span>QB utilisés <strong>{rankLabel(qb.rank)} <span className={styles.rankCount}>sur {numberLabel(qb.count, 0)}</span></strong></span>
              </div>
            </section>

            <section className={`${styles.tile} ${styles.overallTile}`} aria-label="Ton classement général">
              <p className={styles.tileLabel}>Au classement général</p>
              <div className={styles.overallRank}>{rankLabel(overall.rank)}</div>
              <OverallMovement overall={overall} />
              <div className={styles.tileDivider} />
              <div className={styles.tileFoot}><span>Total de la saison</span><strong>{numberLabel(overall.total)} <span className={styles.rankCount}>pts</span></strong></div>
            </section>
          </div>

          <section className={styles.gamesSection} aria-labelledby={`${titleId}-games`}>
            <div className={styles.gamesHeading}><h3 id={`${titleId}-games`}>Tes choix de matchs</h3><span>{games.length} {games.length === 1 ? "match" : "matchs"}</span></div>
            {games.length > 0 ? <><div className={styles.listHead} aria-hidden="true"><span>Match · score final</span><span>Ton choix / résultat</span><span>Points</span></div><ul className={styles.gameList}>{games.map((game) => <GameRow key={game.id} game={game} teams={teams} />)}</ul></> : <p className={styles.emptyGames}>Aucun choix de match pour cette semaine.</p>}
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
