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

const CURRENT_STATUS = {
  unavailable: 'Absence signalée',
  reported: 'Disponibilité à vérifier',
  unknown: 'Statut à vérifier',
};

const SLEEPER_STATUS = {
  ACTIVE: 'actif',
  OUT: 'absent',
  IR: 'liste des blessés',
  PUP: 'liste d’inaptitude physique',
  SUSPENDED: 'suspendu',
  DOUBTFUL: 'retour peu probable',
  QUESTIONABLE: 'présence incertaine',
};

const ACTIONS = {
  reviewReplacement: {
    label: 'Vérifier le remplaçant',
    instruction: 'Confirmer le titulaire pour ce match auprès du club avant de l’affecter.',
  },
  reviewExclusion: {
    label: 'Examiner le retrait de l’équipe',
    instruction: 'Vérifier l’absence pour ce match. Si elle est établie et qu’aucun remplaçant n’est confirmé, la commande Admin retire l’offre de cette équipe.',
  },
  reviewReturn: {
    label: 'Vérifier la réintégration',
    instruction: 'Confirmer le retour comme titulaire pour ce match avant de réintégrer ce QB.',
  },
  verifySources: {
    label: 'Vérifier les sources',
    instruction: 'Résoudre les divergences ou confirmer l’identité et le rôle du QB avant d’intervenir.',
  },
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

function Recommendation({ recommendation, menu }) {
  const { team, teamName, match, currentQb, currentStatus, candidates, recommendedQb } = recommendation;
  const action = ACTIONS[recommendation.action] ?? ACTIONS.verifySources;
  const possibleQb = recommendedQb ?? (candidates.length === 1 ? candidates[0] : null);
  const sleeperStatus = SLEEPER_STATUS[recommendation.reportedStatus?.toUpperCase()];

  return (
    <article className={styles.recommendation}>
      <header className={styles.recommendationHeader}>
        <div>
          <h3>{teamName ?? team}{match?.opponent && ` c. ${match.opponent}`}</h3>
          {match?.kickoffAt && <span className={styles.note}>{torontoDate(match.kickoffAt)}</span>}
        </div>
        <span className={`${styles.certainty} ${styles[recommendation.confidence] ?? ''}`}>
          {CONFIDENCE[recommendation.confidence] ?? CONFIDENCE.uncertain}
        </span>
      </header>
      <div className={styles.qbComparison}>
        <div>
          <span className={styles.note}>{recommendation.currentQbVerified ? 'QB associé à l’équipe' : 'QB relevé lors de la collecte'}</span>
          <strong>{currentQb?.name ?? 'QB non identifié'}</strong>
          {recommendation.noCurrentOffer && <span className={styles.note}>Aucun QB proposé actuellement</span>}
          <span className={styles.note}>{CURRENT_STATUS[currentStatus] ?? CURRENT_STATUS.unknown}</span>
          {sleeperStatus && <span className={styles.note}>Sleeper · {sleeperStatus}</span>}
        </div>
        <div>
          <span className={styles.note}>{!recommendedQb && possibleQb ? 'Piste à vérifier' : 'Remplaçant recommandé'}</span>
          <strong>{possibleQb?.name ?? 'Aucun remplaçant recommandé'}</strong>
          {possibleQb && <span className={styles.note}>ESPN {possibleQb.id}</span>}
        </div>
      </div>
      <p className={styles.recommendationReason}>{recommendation.justification}</p>

      <details className={styles.review}>
        <summary>{action.label}</summary>
        <h4>Remplaçants possibles</h4>
        {candidates.length > 0 ? <ul className={styles.reviewList}>
          {candidates.map(candidate => <li key={candidate.id}>{candidate.name} · ESPN {candidate.id}</li>)}
        </ul> : <p>Aucun candidat identifié dans les relevés disponibles.</p>}
        <h4>Sources</h4>
        {recommendation.sources.length > 0 ? <ul className={styles.reviewList}>
          {recommendation.sources.map(source => <Source key={`${source.label}:${source.url}`} source={source} />)}
        </ul> : <p>Aucune source exploitable.</p>}
        {recommendation.observedAt && <p className={styles.note}>Observation du {torontoDate(recommendation.observedAt)}</p>}
        <h4>Décision Admin</h4>
        <p>{action.instruction}</p>
        <p>{menuImpact(recommendation)}</p>
        <p className={styles.note}>
          {!menu.enabled ? 'L’application de la décision est indisponible tant que le menu hebdomadaire est désactivé.'
            : menu.open ? 'Toute correction exige une confirmation Admin avant le gel.'
              : 'Les corrections du menu sont fermées.'}
        </p>
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
        {menu && <span className={styles.observation}>Mode observation</span>}
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
              <Recommendation key={recommendation.id} recommendation={recommendation} menu={menu} />
            ))}
          </div>
        )}
        {limited && <p className={styles.note}>Les recommandations sont établies à partir des 100 derniers signaux renvoyés par le journal.</p>}
      </>}
    </section>
  );
}
