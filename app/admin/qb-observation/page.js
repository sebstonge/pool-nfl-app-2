'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import styles from './journal.module.css';

const RUN_STATUS = {
  pending: 'En attente',
  completed: 'Terminée',
  skipped: 'Ignorée',
  failed: 'Échec de la collecte',
  dispatch_failed: 'Échec du lancement',
  response_failed: 'Réponse invalide ou indisponible',
};

const ENTRY_STATUS = {
  proposed: 'Annonce de titulaire confirmée',
  ambiguous: 'Annonce ambiguë',
  rejected: 'Annonce écartée',
};

const ENTRY_REASON = {
  calendar_unavailable: 'Calendrier indisponible',
  conflicting_announcements: 'Annonces contradictoires',
  contradictory_article: 'Article contradictoire',
  duplicate_evidence: 'Annonce déjà relevée',
  fixture_mismatch: 'Annonce concernant un autre match',
  fixture_unconfirmed: 'Match non confirmé',
  future_publication: 'Date de publication future',
  future_update: 'Date de mise à jour future',
  invalid_run_window: 'Fenêtre d’observation invalide',
  invalid_update: 'Date de mise à jour invalide',
  late_publication: 'Article publié après le gel',
  late_update: 'Article mis à jour après le gel',
  missing_publication: 'Date de publication absente',
  multiple_candidates: 'Plusieurs QB possibles',
  no_starter_announcement: 'Aucune annonce de titulaire',
  older_than_previous: 'Annonce antérieure à la référence',
  previous_unknown: 'QB précédent inconnu',
  qb_ineligible: 'QB non admissible selon ESPN',
  qualified_announcement: 'Annonce conditionnelle',
  same_qb: 'QB inchangé',
  stale_article: 'Article trop ancien',
  starter_confirmed: 'Titulaire confirmé par la source',
  starter_denied: 'Source indiquant que le QB ne jouera pas',
  superseded: 'Annonce remplacée par une plus récente',
  unattributed_report: 'Annonce sans attribution confirmée',
  untrusted_source: 'Source hors du périmètre de collecte',
};

function sourceHref(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    // Journal entries can have a missing or rejected source.
  }
  return null;
}

function Run({ run }) {
  const date = run.observedAt ?? run.dispatchedAt ?? run.openedAt;
  return (
    <details className={styles.row}>
      <summary>
        <strong>Saison {run.season} · Semaine {run.week}</strong>
        <span className={styles.note}>{RUN_STATUS[run.status] ?? run.status} · {torontoDate(date)}</span>
      </summary>
      <dl className={styles.fields}>
        <dt>Ouverture</dt><dd>{torontoDate(run.openedAt)}</dd>
        <dt>Premier coup d’envoi</dt><dd>{torontoDate(run.firstKickoffAt)}</dd>
        <dt>Lancement</dt><dd>{torontoDate(run.dispatchedAt)}</dd>
        <dt>Observation</dt><dd>{torontoDate(run.observedAt)}</dd>
        <dt>Réception</dt><dd>{torontoDate(run.harvestedAt)}</dd>
        {run.reason && <><dt>Motif</dt><dd>{run.reason}</dd></>}
        {run.httpStatus != null && <><dt>Statut HTTP</dt><dd>{run.httpStatus}</dd></>}
        {run.counts && <>
          <dt>Articles analysés</dt><dd>{run.counts.analyzed ?? '—'}</dd>
          <dt>Erreurs de collecte</dt><dd>{run.counts.sourceErrors ?? '—'}</dd>
        </>}
      </dl>
      {run.errors?.length > 0 && <ul className={styles.errors} aria-label="Erreurs de collecte">
        {run.errors.map((error, index) => (
          <li key={index}>
            {error.team ?? error.url ?? 'Collecte'} · {error.message ?? 'Erreur sans détail'}
            {error.status != null && ` (HTTP ${error.status})`}
          </li>
        ))}
      </ul>}
    </details>
  );
}

function Entry({ entry }) {
  const source = sourceHref(entry.url);
  return (
    <details className={styles.row}>
      <summary>
        <strong>
          {entry.team ?? 'Équipe inconnue'}
          {entry.match?.opponent && ` c. ${entry.match.opponent}`}
          {entry.newQB?.name && ` · ${entry.newQB.name}`}
        </strong>
        <span className={styles.note}>
          Saison {entry.season} · Semaine {entry.week} · {ENTRY_STATUS[entry.status] ?? entry.status}
        </span>
      </summary>
      <dl className={styles.fields}>
        <dt>Match ESPN</dt><dd>{entry.match?.id ?? '—'}</dd>
        <dt>Coup d’envoi</dt><dd>{torontoDate(entry.match?.kickoffAt)}</dd>
        <dt>QB précédent</dt><dd>{entry.previousQB?.name ?? '—'}</dd>
        <dt>Nouveau QB détecté</dt><dd>{entry.newQB?.name ?? '—'}</dd>
        <dt>Identifiant ESPN</dt><dd>{entry.espnAthleteId ?? '—'}</dd>
        <dt>Motif</dt><dd>{ENTRY_REASON[entry.reason] ?? entry.reason ?? '—'}</dd>
        {entry.status === 'proposed' && <>
          <dt>Admissible comme proposition</dt><dd>{entry.proposalEligible ? 'Oui' : 'Non'}</dd>
        </>}
        <dt>Publication</dt><dd>{torontoDate(entry.publishedAt)}</dd>
        <dt>Première détection</dt><dd>{torontoDate(entry.firstDetectedAt)}</dd>
        <dt>Dernière détection</dt><dd>{torontoDate(entry.lastDetectedAt)}</dd>
        <dt>Source</dt><dd>{source ? (
          <a className={styles.source} href={source} target="_blank" rel="noreferrer">
            {new URL(source).hostname}{entry.title && ` · ${entry.title}`}
          </a>
        ) : entry.title || '—'}</dd>
      </dl>
      {entry.evidence && <blockquote className={styles.evidence}>{entry.evidence}</blockquote>}
    </details>
  );
}

export default function QbObservationPage() {
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        if (sessionError) throw sessionError;
        if (!session) {
          setResult({ error: 'Connecte-toi pour consulter le journal.' });
          return;
        }

        const { data, error } = await supabase
          .rpc('read_qb_observation_log', { p_limit: 20 }, { get: true })
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error?.code === '42501') {
          setResult({ error: 'Ce journal est réservé aux administrateurs.' });
          return;
        }
        if (error || !Array.isArray(data?.runs) || !Array.isArray(data?.entries)) {
          throw new Error('Journal indisponible');
        }
        setResult({ data });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ error: 'Le journal d’observation est indisponible.' });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [refresh]);

  const journal = result?.data;
  return (
    <main className={`page ${styles.page}`}>
      <header className="header-card">
        <h1>Journal d’observation des QB</h1>
        <p>Les annonces et décisions de la collecte sont présentées en lecture seule. Heures de Toronto.</p>
        <div className={styles.actions}>
          <a href="/admin" className="button-secondary">← Admin</a>
          <button type="button" className="button-secondary" disabled={!result} onClick={() => {
            setResult(null);
            setRefresh(value => value + 1);
          }}>Actualiser le journal</button>
        </div>
      </header>
      {!result && <p role="status">Chargement du journal…</p>}
      {result?.error && <p role="alert">{result.error}</p>}
      {journal && <>
        <section className="card" aria-labelledby="qb-observation-runs">
          <h2 id="qb-observation-runs">Collectes récentes</h2>
          {journal.runs.length === 0 && <p>Aucune collecte enregistrée.</p>}
          {journal.runs.map(run => <Run key={run.runId} run={run} />)}
        </section>
        <section className="card" aria-labelledby="qb-observation-entries">
          <h2 id="qb-observation-entries">Annonces observées</h2>
          {journal.entries.length === 0 && <p>Aucune annonce enregistrée.</p>}
          {journal.entries.map(entry => (
            <Entry key={`${entry.season}:${entry.week}:${entry.url}`} entry={entry} />
          ))}
        </section>
      </>}
    </main>
  );
}
