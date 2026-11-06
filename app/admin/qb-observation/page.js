'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import MenuControls from './MenuControls';
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
  nflverse_projection: 'Titulaire indiqué par nflverse',
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

const CHECK_RESULT = {
  dispatched: 'Vérification lancée. Actualise le journal pour consulter le résultat.',
  too_recent: 'Une vérification a été lancée récemment.',
  already_dispatched: 'Une vérification est déjà lancée pour cette fenêtre.',
  outside_window: 'La fenêtre de vérification est fermée.',
  inactive: 'La vérification est indisponible pour la semaine actuelle.',
  busy: 'Une vérification est déjà en cours.',
  dispatch_failed: 'La vérification n’a pas pu être lancée. Consulte le journal.',
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
          <dt>Éléments analysés</dt><dd>{run.counts.analyzed ?? '—'}</dd>
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

function Entry({ entry, context, busy, onPrepare, onDismiss }) {
  const source = sourceHref(entry.url);
  let status = ENTRY_STATUS[entry.status] ?? entry.status;
  if (entry.reviewOutcome === 'confirmed') status = 'Titulaire confirmé par l’Admin';
  else if (entry.dismissedAt) status = 'Signal écarté';
  else if (entry.reason === 'nflverse_projection') status = 'Titulaire indiqué · à confirmer';
  const canReview = entry.currentSignal && entry.entryId && !entry.dismissedAt && context?.canCheck
    && entry.season === context.season && entry.week === context.week;
  return (
    <details className={styles.row}>
      <summary>
        <strong>
          {entry.team ?? 'Équipe inconnue'}
          {entry.match?.opponent && ` c. ${entry.match.opponent}`}
          {entry.newQB?.name && ` · ${entry.newQB.name}`}
        </strong>
        <span className={styles.note}>
          Saison {entry.season} · Semaine {entry.week} · {status}
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
      {entry.evidence && <p className={styles.evidence}>{entry.evidence}</p>}
      {canReview && <div className={`${styles.actions} ${styles.review}`}>
        {context.open && entry.newQB?.name && /^\d{1,18}$/.test(entry.espnAthleteId) && (
          <button type="button" className="button-secondary" disabled={busy} onClick={() => onPrepare(entry)}>Vérifier et confirmer</button>
        )}
        <button type="button" className="button-secondary" disabled={busy} onClick={() => onDismiss(entry.entryId)}>Écarter le signal</button>
      </div>}
    </details>
  );
}

export default function QbObservationPage() {
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

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

        const [{ data, error }, menu] = await Promise.all([
          supabase.rpc('read_qb_observation_log', { p_limit: 20 }, { get: true }).abortSignal(controller.signal),
          supabase.rpc('read_regular_qb_menu_admin', {}, { get: true }).abortSignal(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (error?.code === '42501') {
          setResult({ error: 'Ce journal est réservé aux administrateurs.' });
          return;
        }
        if (error || !Array.isArray(data?.runs) || !Array.isArray(data?.entries)) {
          throw new Error('Journal indisponible');
        }
        setResult({ data, context: !menu.error && Array.isArray(menu.data?.teams) ? menu.data : null });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ error: 'Le journal d’observation est indisponible.' });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [refresh]);

  function reload() {
    setDraft(null);
    setResult(null);
    setRefresh(value => value + 1);
  }

  async function runAction(rpc, params, message) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.rpc(rpc, params);
      if (error) throw error;
      const report = typeof message === 'function' ? message(data) : { message };
      setFeedback(report);
      reload();
    } catch (error) {
      setFeedback({
        error: true,
        message: error?.code === '42501' ? 'Cette action exige un compte administrateur.'
          : 'Action refusée ou indisponible. Vérifie la semaine, le gel et l’identité du QB.',
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const journal = result?.data;
  const context = result?.context;
  return (
    <main className={`page ${styles.page}`}>
      <header className="header-card">
        <h1>Journal d’observation des QB</h1>
        <p>Signaux de titulaires et corrections du menu régulier. Heures de Toronto.</p>
        <div className={styles.actions}>
          <a href="/admin" className="button-secondary">← Admin</a>
          <button type="button" className="button-secondary" disabled={!result || busy} onClick={reload}>Actualiser le journal</button>
        </div>
      </header>
      {!result && <p role="status">Chargement du journal…</p>}
      {result?.error && <p role="alert">{result.error}</p>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
      {journal && <>
        <MenuControls context={context} draft={draft} busy={busy}
          onEdit={() => setDraft({})}
          onClose={() => setDraft(null)}
          onApply={params => runAction('manage_regular_qb_menu', params, params.p_action === 'assign'
            ? 'Titulaire du menu mis à jour.' : 'QB retiré du menu de cette semaine.')}
          onCheck={() => runAction('request_qb_observation_check', {}, data => ({
            message: CHECK_RESULT[data?.status] ?? 'Résultat de vérification indisponible.',
            error: !CHECK_RESULT[data?.status] || data?.status === 'dispatch_failed',
          }))}
        />
        <section className="card" aria-labelledby="qb-observation-entries">
          <h2 id="qb-observation-entries">Signaux de titulaires</h2>
          {journal.entries.length === 0 && <p>Aucun signal enregistré.</p>}
          {journal.entries.map(entry => (
            <Entry key={entry.entryId ?? `${entry.season}:${entry.week}:${entry.url}`}
              entry={entry} context={context} busy={busy}
              onPrepare={row => setDraft({ entry: row })}
              onDismiss={entryId => runAction('dismiss_qb_observation_candidate', { p_entry_id: entryId }, 'Signal écarté.')}
            />
          ))}
        </section>
        <section className="card" aria-labelledby="qb-observation-runs">
          <h2 id="qb-observation-runs">Collectes récentes</h2>
          {journal.runs.length === 0 && <p>Aucune collecte enregistrée.</p>}
          {journal.runs.map(run => <Run key={run.runId} run={run} />)}
        </section>
      </>}
    </main>
  );
}
