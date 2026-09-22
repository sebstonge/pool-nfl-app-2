'use client';

import { useEffect, useId, useState } from 'react';
import styles from './PlayoffTree.module.css';

function TeamLogo({ name, teams }) {
  const team = teams.find(row => row.name?.trim().toLowerCase() === name?.trim().toLowerCase());
  const src = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo;
  const [failedSrc, setFailedSrc] = useState(null);
  return src && failedSrc !== src
    ? <img className={styles.logo} src={src} alt="" onError={() => setFailedSrc(src)} />
    : <span className={styles.logoFallback} aria-hidden="true">{name?.slice(0, 2) || '—'}</span>;
}

function gameDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('fr-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PersonalPickSummary({ game }) {
  return <div className={styles.pick}>
    <span className={styles.label}>Mon choix</span>
    <strong>{game.pick
      ? `${game.pick.picked_team} par ${game.pick.predicted_spread ?? '—'}`
      : 'Aucun choix enregistré'}</strong>
  </div>;
}

function PersonalTeamPath({ round, teams }) {
  return <div className={`${styles.path} ${round.path ? styles.savedPath : ''}`}>
    <span className={styles.label}>Mon parcours</span>
    {round.path ? <div className={styles.pathTeam}>
      <TeamLogo name={round.path.team} teams={teams} />
      <div className={styles.pathIdentity}><strong>{round.path.team}</strong>
        {round.path.multiplier != null && <span className={styles.multiplier}>×{round.path.multiplier}</span>}
      </div>
    </div> : <p className={styles.muted}>Parcours à venir</p>}
  </div>;
}

// Layout is independent of personal data loading. Future collective summaries can
// supply these two render slots without duplicating rounds, games or navigation.
export default function PlayoffTree({ rounds, teams = [], currentRoundKey,
  renderGameSummary = game => <PersonalPickSummary game={game} />,
  renderRoundSummary = round => <PersonalTeamPath round={round} teams={teams} />,
}) {
  const [selected, setSelected] = useState(currentRoundKey || 'wild_card');
  const id = useId();
  useEffect(() => { setSelected(currentRoundKey || 'wild_card'); }, [currentRoundKey]);
  const index = Math.max(0, rounds.findIndex(round => round.key === selected));
  return <section className={styles.tree} aria-labelledby={`${id}-title`}>
    <header className={styles.intro}>
      <div><span className={styles.eyebrow}>LE PARCOURS VERS LE TITRE</span>
        <h2 id={`${id}-title`}>Arbre des séries 🏆</h2></div>
      <p>Les affrontements s’ajoutent au fil des rondes. Les flèches indiquent uniquement leur succession.</p>
    </header>
    <nav className={styles.mobileNav} aria-label="Rondes des séries">
      {rounds.map((round, i) => <div className={styles.step} key={round.key}>
        {i > 0 && <span aria-hidden="true" className={styles.stepArrow}>→</span>}
        <button type="button" aria-label={round.title} aria-current={i === index ? 'step' : undefined}
          aria-controls={`${id}-${round.key}`} onClick={() => setSelected(round.key)}>{round.short}</button>
      </div>)}
    </nav>
    <div className={styles.scroller} tabIndex={0} role="region" aria-label="Les quatre rondes des séries">
      <div className={styles.columns}>
        {rounds.map((round, i) => <section key={round.key} id={`${id}-${round.key}`}
          className={`${styles.round} ${i === index ? styles.selected : ''}`}
          aria-labelledby={`${id}-${round.key}-title`}>
          <header className={styles.roundHeader}>
            <span className={styles.roundNumber}>0{i + 1}</span>
            <h3 id={`${id}-${round.key}-title`}><span className={styles.desktopTitle}>{round.title}</span>
              <span className={styles.mobileTitle}>{round.title} · {i + 1}/4</span></h3>
            {i < rounds.length - 1 && <span className={styles.roundArrow} aria-hidden="true">→</span>}
          </header>
          <div className={styles.games}>
            {round.games.length ? round.games.map(game => {
              const date = gameDate(game.game_date);
              return <article className={styles.game} key={game.id}>
                {date && <time className={styles.date} dateTime={game.game_date}>{date}</time>}
                <div className={styles.matchup}>
                  <div><TeamLogo name={game.away_team} teams={teams} /><strong>{game.away_team || 'À déterminer'}</strong></div>
                  <span className={styles.at}>@</span>
                  <div><TeamLogo name={game.home_team} teams={teams} /><strong>{game.home_team || 'À déterminer'}</strong></div>
                </div>
                {renderGameSummary(game)}
              </article>;
            }) : <div className={styles.future}><span aria-hidden="true">◇</span><p>Affrontements à déterminer</p></div>}
          </div>
          {renderRoundSummary(round)}
        </section>)}
      </div>
    </div>
    <nav className={styles.paging} aria-label="Changer de ronde">
      <button type="button" disabled={index === 0} onClick={() => setSelected(rounds[index - 1].key)}>← Précédente</button>
      <button type="button" disabled={index === rounds.length - 1} onClick={() => setSelected(rounds[index + 1].key)}>Suivante →</button>
    </nav>
  </section>;
}
