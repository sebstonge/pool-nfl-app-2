'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  snapshotState,
  confirmationRequest,
  requestSnapshot,
} from './snapshotAdmin.mjs';
import styles from './playoffs.module.css';
import RoundAdmin, { requestRound } from './RoundAdmin';

const season = 2026;

function date(value) {
  return value
    ? new Date(value).toLocaleString('fr-CA', {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : '—';
}

function Logo({ team }) {
  const [failed, setFailed] = useState(false);

  const src = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo;

  return src && !failed ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <span aria-hidden="true">🏈</span>
  );
}

function ConfirmDialog({
  pending,
  busy,
  error,
  onCancel,
  onConfirm,
}) {
  const ref = useRef(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    const trigger = document.activeElement;

    ref.current.showModal();

    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  const final = pending.action === 'finalize';

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="confirmation-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirmation-title">
        {final
          ? 'Finaliser les seeds'
          : 'Actualiser depuis ESPN'}
      </h2>

      {final ? (
        <>
          <p>
            Cette action est irréversible : elle fige les 14 seeds et
            bloque toute future synchronisation ESPN.
          </p>

          <p>
            Capture examinée : {date(pending.state.capturedAt)}.
          </p>

          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />

            Je confirme que la saison régulière NFL {season} est
            terminée et que j’ai vérifié les 14 seeds.
          </label>
        </>
      ) : (
        <p>
          Les standings ESPN peuvent encore être provisoires. Le
          snapshot existant sera remplacé et sa date de capture
          changera. Cette action ne finalise pas les playoffs.
        </p>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>

        <button
          type="button"
          className="button"
          disabled={busy || (final && !ack)}
          onClick={() => onConfirm(final ? ack : true)}
        >
          {busy
            ? 'En cours…'
            : final
              ? 'Confirmer la finalisation'
              : 'Confirmer l’actualisation'}
        </button>
      </div>
    </dialog>
  );
}

export function PlayoffsAdminView({
  request,
  teams = [],
  roundRequest = requestRound,
}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;

    request({ action: 'read', season })
      .then((next) => {
        if (active) setRows(next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, [request]);

  const state = snapshotState(rows || [], season);

  async function execute(body) {
    if (inFlight.current) return;

    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const next = await request(body);

      setRows(next);
      setPending(null);

      setMessage(
        body.action === 'sync'
          ? 'Snapshot provisoire actualisé depuis ESPN.'
          : body.action === 'finalize'
            ? 'Seeds finalisés et figés.'
            : 'Snapshot rechargé.'
      );
    } catch (e) {
      setPending(null);
      setError(`${e.message} L’opération a échoué.`);

      try {
        setRows(
          await request({
            action: 'read',
            season,
          })
        );
      } catch {
        setError(
          `${e.message} Le rechargement a également échoué; le snapshot affiché est conservé. Recharge la page avant de réessayer.`
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function open(action) {
    setError('');
    setMessage('');
    setPending({ action, state });
  }

  return (
    <main className={`page ${styles.page}`}>

      {/* =========================================================
          HERO
          ========================================================= */}

      <header className={`header-card ${styles.hero}`}>
        <div>
          <h1>Séries NFL</h1>
          <p>Saison {season} · Aperçu Admin</p>
        </div>

        {rows !== null && (
          <div className={styles.heroActions}>
            <a
              className={`button-secondary ${styles.navControl}`}
              href="/admin"
            >
              ← Retour au mode régulier
            </a>

            <a
              className={`button-secondary ${styles.navControl}`}
              href="/series/matchs"
            >
              👁 Voir l’app Séries
            </a>
          </div>
        )}
      </header>

      {error && !pending && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}

      {rows === null ? (
        <section className="card">
          <p>
            {error
              ? 'Le snapshot n’a pas pu être chargé.'
              : 'Chargement du snapshot…'}
          </p>

          {error && (
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                execute({
                  action: 'read',
                  season,
                })
              }
            >
              Réessayer
            </button>
          )}
        </section>
      ) : (
        <>

          {/* =====================================================
              ZONE PRINCIPALE DESKTOP
              GAUCHE = SEEDS
              DROITE = RONDE
              ===================================================== */}

          <div className={styles.adminDesktopGrid}>

            {/* ===================================================
                COLONNE GAUCHE
                =================================================== */}

            <div className={styles.seedControlColumn}>

              <section className="card">
                <div className={styles.cardHeading}>
                  <div>
                    <p className={styles.eyebrow}>
                      Classement de référence
                    </p>

                    <h2>Seeds NFL</h2>
                  </div>

                  <span
                    className={`${styles.badge} ${
                      state.finalized
                        ? styles.final
                        : styles.draft
                    }`}
                  >
                    {state.finalized
                      ? 'FINALISÉ'
                      : state.locked
                        ? 'ÉTAT INCOHÉRENT'
                        : 'PROVISOIRE'}
                  </span>
                </div>

                <dl className={styles.meta}>
                  <div>
                    <dt>Capturé le</dt>
                    <dd>{date(state.capturedAt)}</dd>
                  </div>

                  {state.finalized && (
                    <div>
                      <dt>Finalisé le</dt>
                      <dd>{date(state.finalizedAt)}</dd>
                    </div>
                  )}

                  <div>
                    <dt>Équipes</dt>

                    <dd>
                      {rows.length} au total ·{' '}
                      {state.conferences
                        .map(
                          (conference) =>
                            `${conference.rows.length} ${conference.name}`
                        )
                        .join(' · ')}
                    </dd>
                  </div>
                </dl>

                {!rows.length && (
                  <p>Aucun snapshot enregistré.</p>
                )}

                <button
                  className="button"
                  disabled={busy || state.locked}
                  onClick={() => open('sync')}
                >
                  Actualiser depuis ESPN
                </button>
              </section>

              <section className="card">
                <p className={styles.eyebrow}>
                  Validation officielle
                </p>

                <h2>Finaliser les seeds</h2>

                {state.finalized ? (
                  <p>
                    Les seeds sont désormais figés. Aucune modification
                    ni synchronisation ESPN n’est possible.
                  </p>
                ) : (
                  <>
                    <p>
                      La finalisation fige les 14 seeds comme référence
                      officielle des playoffs et empêche les futures
                      synchronisations ESPN.
                    </p>

                    <p className={styles.mutedText}>
                      À effectuer uniquement après la fin de la saison
                      régulière. Un snapshot provisoire n’active aucun
                      bye dans l’arbre public.
                    </p>

                    <button
                      className="button-secondary"
                      disabled={busy || !state.canFinalize}
                      onClick={() => open('finalize')}
                    >
                      Finaliser les seeds
                    </button>

                    {!state.canFinalize && (
                      <p className={styles.helperText}>
                        Un snapshot complet, cohérent et non finalisé
                        est requis.
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>

            {/* ===================================================
                COLONNE DROITE — RONDE
                =================================================== */}

            <div className={styles.roundControlColumn}>
              <div className={styles.desktopSectionHeading}>
                <p className={styles.eyebrow}>
                  Opérations playoffs
                </p>

                <h2>Gestion de la ronde</h2>
              </div>

              <RoundAdmin
                key={`${state.capturedAt}-${state.finalizedAt}`}
                season={season}
                request={roundRequest}
              />
            </div>
          </div>

          {/* =====================================================
              CONFÉRENCES
              ===================================================== */}

          <div className={styles.conferences}>
            {state.conferences.map((conference) => (
              <section
                className={`card ${styles.conferenceCard}`}
                key={conference.name}
              >
                <div className={styles.conferenceHeader}>
                  <div>
                    <p className={styles.eyebrow}>
                      Classement playoffs
                    </p>

                    <h2>{conference.name}</h2>
                  </div>

                  <span className={styles.conferenceCount}>
                    {conference.rows.length}/7
                  </span>
                </div>

                <div className={styles.seedList}>
                  {Array.from({ length: 7 }, (_, i) => {
                    const row = conference.rows.find(
                      (r) => r.seed === i + 1
                    );

                    const team = teams.find(
                      (t) => t.name === row?.team
                    );

                    return (
                      <div
                        className={styles.seed}
                        key={i}
                      >
                        <strong>#{i + 1}</strong>

                        <Logo team={team} />

                        <div>
                          <strong>
                            {row?.team || 'À déterminer'}
                          </strong>

                          {i === 0 && (
                            <small>
                              BYE Wild Card
                              {!state.finalized
                                ? ' · indicatif'
                                : ''}
                            </small>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* =========================================================
          ACTIVATION GLOBALE
          ========================================================= */}

      <section className={`card ${styles.activationCard}`}>
        <div className={styles.activationContent}>
          <div>
            <p className={styles.eyebrow}>
              Étape finale
            </p>

            <h2>Activation globale — à venir</h2>

            <p>
              L’aperçu est réservé à l’Admin. Le mode régulier reste
              inchangé pour les participants.
            </p>

            <p className={styles.mutedText}>
              Cette future action activera les séries pour tous et
              préservera la saison régulière terminée.
            </p>
          </div>

          <button
            className="button-secondary"
            disabled
          >
            🏆 PASSER EN SÉRIES
          </button>
        </div>
      </section>

      {pending && (
        <ConfirmDialog
          pending={pending}
          busy={busy}
          error={error}
          onCancel={() => {
            setPending(null);
            setError('');
          }}
          onConfirm={(confirmed) =>
            execute(
              confirmationRequest(
                pending.action,
                season,
                pending.state,
                confirmed
              )
            )
          }
        />
      )}
    </main>
  );
}

const request = (body) =>
  requestSnapshot(supabase, body);

export default function PlayoffsAdminPage() {
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    let active = true;

    supabase
      .from('teams')
      .select('name,espn_abbr,logo')
      .then(({ data, error }) => {
        if (error) {
          console.error(
            'Logos équipes',
            error.message
          );
        } else if (active) {
          setTeams(data || []);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <PlayoffsAdminView
      request={request}
      teams={teams}
    />
  );
}
