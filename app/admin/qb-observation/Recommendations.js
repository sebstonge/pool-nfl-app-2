import { useEffect, useState } from 'react';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import { buildQbRecommendations } from '../../../lib/qb-observation/recommendations.mjs';
import RecommendationDecision from './RecommendationDecision';
import styles from './journal.module.css';

const CONFIDENCE = {
  confirmed: 'Confirmé',
  probable: 'Probable',
  uncertain: 'Incertain',
  contradictory: 'Contradictoire',
};

function Source({ source }) {
  let href;
  try {
    const url = new URL(source.url);
    if (url.protocol === 'https:' && !url.username && !url.password) href = url.href;
  } catch {
    // The observation may not include a usable link.
  }
  return (
    <li>
      {href ? <a className={styles.source} href={href} target="_blank" rel="noreferrer">{source.label}</a> : source.label}
      {source.note && <span className={styles.note}>{source.note}</span>}
      {source.observedAt && <span className={styles.note}>Relevé du {torontoDate(source.observedAt)}</span>}
    </li>
  );
}

function menuImpact(recommendation) {
  if (recommendation.reservation === true) {
    return 'L’équipe est réservée ou son état ne peut pas être confirmé. L’affectation ne libère pas l’équipe et les choix soumis sont conservés.';
  }
  if (recommendation.teamInMenu === false || recommendation.reservation == null) {
    return 'L’effet sur le menu et la réservation doit être vérifié avant toute correction.';
  }
  return 'Un changement de titulaire s’applique aux nouveaux choix. Les choix déjà soumis sont conservés.';
}

function Recommendation({ recommendation, menu, now, onRequest, onRefresh }) {
  const { team, teamName, match, candidates, potentialQb } = recommendation;
  const alternatives = candidates.filter(candidate => candidate.id !== potentialQb?.id);
  return (
    <article className={styles.recommendation}>
      <header className={styles.recommendationHeader}>
        <h3>{teamName ?? team}{match?.opponent && ` c. ${match.opponent}`}</h3>
      </header>
      <RecommendationDecision recommendation={recommendation} menu={menu} now={now}
        onRequest={onRequest} onRefresh={onRefresh} />

      <details className={styles.review}>
        <summary>Sources et effets</summary>
        <p><strong>{CONFIDENCE[recommendation.confidence] ?? CONFIDENCE.uncertain}</strong> · {recommendation.justification}</p>
        {match?.kickoffAt && <p className={styles.note}>Match le {torontoDate(match.kickoffAt)}</p>}
        {alternatives.length > 0 && <ul className={styles.reviewList} aria-label="Autres pistes">
          {alternatives.map(candidate => <li key={candidate.id}>{candidate.name} · ESPN {candidate.id}</li>)}
        </ul>}
        {recommendation.sources.length > 0 ? <ul className={styles.reviewList}>
          {recommendation.sources.map(source => <Source key={`${source.label}:${source.url}`} source={source} />)}
        </ul> : <p>Aucune source exploitable.</p>}
        {recommendation.observedAt && <p className={styles.note}>Observation du {torontoDate(recommendation.observedAt)}</p>}
        <p>{menuImpact(recommendation)}</p>
      </details>
    </article>
  );
}

export default function Recommendations({ journal, menu, limited, onRequest, onRefresh }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const recommendations = menu ? buildQbRecommendations(journal, { menu, now }) : [];
  const kickoff = Date.parse(menu?.firstKickoffAt);
  const frozen = Number.isFinite(kickoff) && kickoff <= now;

  return (
    <section className={`card ${styles.recommendations}`} aria-labelledby="qb-recommendations">
      <header className={styles.recommendationsHeader}>
        <div>
          <h2 id="qb-recommendations">Recommandations</h2>
          {menu?.week != null && <p className={styles.note}>Saison {menu.season} · Semaine {menu.week}</p>}
        </div>
        {menu && <span className={styles.observation}>{menu.manualOpen ? 'Confirmation Admin' : 'Lecture seule'}</span>}
      </header>
      {!menu ? <p>Contexte du menu indisponible. Actualise la page pour vérifier les recommandations.</p> : <>
        {Number.isFinite(kickoff) && (
          <p className={styles.note}>{frozen ? 'Menu gelé depuis le' : 'Gel hebdomadaire le'} {torontoDate(menu.firstKickoffAt)}</p>
        )}
        {frozen ? <p>Le journal conserve les observations. Les corrections de cette semaine sont fermées.</p>
          : recommendations.length === 0 && <p>Aucune recommandation actuelle pour cette semaine.</p>}
        {!frozen && recommendations.length > 0 && (
          <div className={styles.recommendationGrid}>
            {recommendations.map(recommendation => (
              <Recommendation key={`${recommendation.entryId}:${recommendation.runId}`} recommendation={recommendation}
                menu={menu} now={now} onRequest={onRequest} onRefresh={onRefresh} />
            ))}
          </div>
        )}
        {limited && <p className={styles.note}>Les recommandations sont établies à partir des 100 derniers signaux renvoyés par le journal.</p>}
      </>}
    </section>
  );
}
