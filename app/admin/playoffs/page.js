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
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
    />
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
    ref.current?.showModal();

    return () => {
      if (trigger?.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  const final = pending.action === 'finalize';

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="confirmation-title"
      onCancel={(event) => {
        event.preventDefault();

        if (!busy) {
          onCancel();
        }
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
            Cette action est irréversible : elle fige les 14 seeds
            et bloque toute future synchronisation ESPN.
          </p>

          <p>
            Capture examinée : {date(pending.state.capturedAt)}.
          </p>

          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(event) => setAck(event.target.checked)}
            />

            <span>
              Je confirme que la saison régulière NFL {season} est
              terminée et que j’ai vérifié les 14 seeds.
            </span>
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

    request({
      action: 'read',
      season,
    })
      .then((next) => {
        if (active) {
          setRows(next);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
        }
      });

    return () => {
      active = false;
    };
  }, [request]);

  const state = snapshotState(rows || [], season);

  async function execute(body) {
    if (inFlight.current) {
      return;
    }

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
    } catch (err) {
      setPending(null);
      setError(`${err.message} L’opération a échoué.`);

      try {
        setRows(
          await request({
            action: 'read',
            season,
          })
        );
      } catch {
        setError(
          `${err.message} Le rechargement a également échoué; le snapshot affiché est conservé. Recharge la page avant de réessayer.`
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

    setPending({
      action,
      state,
    });
  }

  const afcCount =
    state.conferences.find(
      (conference) => conference.name === 'AFC'
    )?.rows.length || 0;

  const nfcCount =
    state.conferences.find(
      (conference) => conference.name === 'NFC'
    )?.rows.length || 0;

  return (
    <main className={`page ${styles.page}`}>

      {/* =========================================================
          HERO — MÊME ESPRIT QUE L'ADMIN RÉGULIER
          ========================================================= */}

      <header className={`header-card ${styles.hero}`}>
        <div>
          <h1>🏆 Séries NFL</h1>
          <p>Saison {season} · Aperçu Admin</p>
        </div>

        {rows !== null && (
          <div className={styles.heroActions}>
            <a
              className={`button-secondary ${styles.navControl}`}
              href="/admin"
            >
              ← Mode régulier
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
              : 'Chargement des séries…'}
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
              LIGNE 1 — DEUX ACTIONS PRINCIPALES
              ===================================================== */}

          <div className={styles.mainGrid}>

            <section className={`card ${styles.actionCard}`}>
              <div className={styles.cardTop}>
                <div>
                  <p className={styles.eyebrow}>
                    Classement de référence
                  </p>

                  <h2>🏈 Seeds NFL</h2>
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

              <p className={styles.description}>
                Synchronise le classement NFL utilisé comme référence
                pour les affrontements et le reseeding des séries.
              </p>

              <div className={styles.inlineInfo}>
                <span>
                  <strong>{rows.length}/14</strong> équipes
                </span>

                <span>
                  <strong>{afcCount}/7</strong> AFC
                </span>

                <span>
                  <strong>{nfcCount}/7</strong> NFC
                </span>

                <span>
                  Capture : <strong>{date(state.capturedAt)}</strong>
                </span>
              </div>

              <div className={styles.actionBottom}>
                <button
                  className="button"
                  disabled={busy || state.locked}
                  onClick={() => open('sync')}
                >
                  Actualiser depuis ESPN
                </button>
              </div>
            </section>

            {/* ===================================================
                ROUNDADMIN CONSERVÉ TEL QUEL.
                display: contents dans le CSS permet à ses cartes
                d'utiliser la grille desktop sans casser sa logique.
                =================================================== */}

            <div className={styles.roundSlot}>
              <RoundAdmin
                key={`${state.capturedAt}-${state.finalizedAt}`}
                season={season}
                request={roundRequest}
              />
            </div>
          </div>


          {/* =====================================================
              LIGNE 2 — AFC / NFC
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
                  {Array.from({ length: 7 }, (_, index) => {
                    const seed = index + 1;

                    const row = conference.rows.find(
                      (item) => item.seed === seed
                    );

                    const team = teams.find(
                      (item) => item.name === row?.team
                    );

                    return (
                      <div className={styles.seed} key={seed}>
                        <strong className={styles.seedNumber}>
                          #{seed}
                        </strong>

                        <Logo team={team} />

                        <strong className={styles.seedTeam}>
                          {row?.team || 'À déterminer'}
                        </strong>

                        {seed === 1 && (
                          <span className={styles.byeBadge}>
                            BYE Wild Card
                            {!state.finalized
                              ? ' · indicatif'
                              : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>


          {/* =====================================================
              FINALISATION — PLEINE LARGEUR
              ===================================================== */}

          <section className={`card ${styles.fullActionCard}`}>
            <div className={styles.fullActionText}>
              <p className={styles.eyebrow}>
                Validation officielle
              </p>

              <h2>Finaliser les seeds</h2>

              {state.finalized ? (
                <p>
                  Les 14 seeds sont maintenant figés comme référence
                  officielle des séries.
                </p>
              ) : (
                <p>
                  Fige les 14 seeds et empêche toute nouvelle
                  synchronisation ESPN. À effectuer uniquement après
                  la fin de la saison régulière.
                </p>
              )}
            </div>

            {!state.finalized && (
              <div className={styles.fullActionButton}>
                <button
                  className="button-secondary"
                  disabled={busy || !state.canFinalize}
                  onClick={() => open('finalize')}
                >
                  Finaliser les seeds
                </button>

                {!state.canFinalize && (
                  <small>
                    Snapshot complet et cohérent requis.
                  </small>
                )}
              </div>
            )}
          </section>
        </>
      )}


      {/* =========================================================
          ACTIVATION — PLEINE LARGEUR
          ========================================================= */}

      <section className={`card ${styles.fullActionCard}`}>
        <div className={styles.fullActionText}>
          <p className={styles.eyebrow}>
            Étape finale
          </p>

          <h2>Activation globale — à venir</h2>

          <p>
            Le mode régulier reste inchangé pour les participants
            pendant la préparation des séries.
          </p>
        </div>

        <div className={styles.fullActionButton}>
          <button
            className="button-secondary"
            disabled
          >
            🏆 PASSER EN SÉRIES
          </button>
        </div>
      </section>


      {/* =========================================================
          CONFIRMATION
          ========================================================= */}

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
