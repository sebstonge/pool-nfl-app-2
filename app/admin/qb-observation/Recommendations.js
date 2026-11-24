import { useEffect, useState } from 'react';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import { buildQbRecommendations } from '../../../lib/qb-observation/recommendations.mjs';
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
  if (recommendation.action === 'reviewExclusion') {
    return 'Un retrait masquerait l’équipe pour les nouveaux choix. Les choix déjà soumis sont conservés.';
  }
  if (recommendation.action === 'reviewReplacement' || recommendation.action === 'reviewReturn') {
    return 'Une affectation confirmée changerait l’offre pour les nouveaux choix de cette équipe. Les choix déjà soumis sont conservés.';
  }
  return 'L’offre reste en place pendant la vérification.';
}

function Recommendation({ recommendation }) {
  const { team, teamName, match, currentQb, currentStatus, candidates, recommendedQb } = recommendation;
  const [draft, setDraft] = useState({ recommended: false, other: '', prepared: false });
  const choice = draft.recommended ? recommendedQb?.name : draft.other.trim();
  const absent = currentStatus === 'unavailable';
  const alternatives = candidates.filter(candidate => candidate.id !== recommendedQb?.id);

  return (
    <article className={styles.recommendation}>
      <header className={styles.recommendationHeader}>
        <h3>{teamName ?? team}{match?.opponent && ` c. ${match.opponent}`}</h3>
      </header>
      <div className={styles.currentQb}>
        <strong>{currentQb?.name ?? 'QB non identifié'}</strong>
        <span className={`${styles.certainty} ${absent ? styles.contradictory : styles.uncertain}`}
          title={absent ? 'Absence signalée par la source' : undefined}>{absent ? 'Absent' : 'Incertain'}</span>
      </div>
      <form className={styles.draft} onSubmit={event => {
        event.preventDefault();
        if (choice) setDraft({ ...draft, prepared: true });
      }}>
        {recommendedQb ? (
          <button type="button" className={styles.suggestion} aria-pressed={draft.recommended}
            onClick={() => setDraft({ recommended: true, other: '', prepared: false })}>
            <span className={styles.note}>Remplaçant recommandé</span>
            <strong>{recommendedQb.name}</strong>
          </button>
        ) : <span className={styles.note}>Aucun remplaçant recommandé</span>}
        <div className={styles.otherRow}>
          <input type="text" className={styles.otherInput} placeholder="Autre QB"
            aria-label={`Autre QB pour ${teamName ?? team}`} value={draft.other} maxLength={120}
            onChange={event => setDraft({ recommended: false, other: event.target.value, prepared: false })} />
          <button type="submit" className={styles.draftSubmit} disabled={!choice || draft.prepared}>OK</button>
        </div>
      </form>
      {draft.prepared && <p className={styles.note} role="status">Préparé : {choice} · sans effet sur le menu.</p>}

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

export default function Recommendations({ journal, menu, limited }) {
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
        {menu && <span className={styles.observation}>Lecture seule</span>}
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
              <Recommendation key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        )}
        {limited && <p className={styles.note}>Les recommandations sont établies à partir des 100 derniers signaux renvoyés par le journal.</p>}
      </>}
    </section>
  );
}
