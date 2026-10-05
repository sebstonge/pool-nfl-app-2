'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  ROUNDS,
  roundSummary,
} from '../../../lib/playoffs/rounds.mjs';
import styles from './playoffs.module.css';

export async function requestRound(body) {
  const { data, error } =
    await supabase.auth.getSession();

  if (error || !data.session) {
    throw new Error(
      'Connecte-toi avec un compte administrateur.'
    );
  }

  const response = await fetch(
    '/api/admin/playoff-rounds',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify(body),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error ||
        'Opération refusée.'
    );
  }

  return result;
}

function RoundConfirmation({
  action,
  name,
  busy,
  onCancel,
  onConfirm,
}) {
  const dialog = useRef(null);

  useEffect(() => {
    const trigger =
      document.activeElement;

    dialog.current.showModal();

    return () => {
      if (trigger?.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="round-confirm-title"
      onCancel={(e) => {
        e.preventDefault();

        if (!busy) {
          onCancel();
        }
      }}
    >
      <h2 id="round-confirm-title">
        {action === 'advance'
          ? 'Passer à la ronde suivante'
          : action === 'finalize' ? 'Finaliser la ronde'
          : 'Préparer / ouvrir le Wild Card'}
      </h2>

      <p>
        {action === 'finalize' ? 'Les résultats calculés seront verrouillés définitivement. Vérifie les classements avant de confirmer.' : `${name} sera ouverte seulement si ses affrontements et horaires officiels ESPN sont disponibles. Les résultats de la ronde finalisée restent inchangés.`}
      </p>

      <div className={styles.actions}>
        <button
          className="button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>

        <button
          className="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy
            ? 'Vérification ESPN…'
            : 'Confirmer'}
        </button>
      </div>
    </dialog>
  );
}

export default function RoundAdmin({
  season,
  request = requestRound,
}) {
  const [data, setData] =
    useState(null);

  const [error, setError] =
    useState('');

  const [message, setMessage] =
    useState('');

  const [busy, setBusy] =
    useState(false);

  const [pending, setPending] =
    useState(null);

  const [warnings, setWarnings] =
    useState([]);

  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;

    request({
      action: 'read',
      season,
    })
      .then((result) => {
        if (active) {
          setData(result.data);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
        }
      });

    return () => {
      active = false;
    };
  }, [request, season]);

  let view;
  let invalid = '';

  try {
    if (data) {
      view = roundSummary(data);
    }
  } catch (e) {
    invalid = e.message;
  }

  async function run(
    action,
    roundKey
  ) {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;

    setBusy(true);
    setError('');
    setMessage('');
    setWarnings([]);

    try {
      const result =
        await request({
          action,
          season,
          roundKey,
          confirmed:
            [
              'prepare',
              'advance',
              'finalize',
            ].includes(action),
        });

      setData(result.data);

      setMessage(
        result.message ||
          'Ronde mise à jour.'
      );

      setWarnings(
        result.warnings || []
      );
    } catch (e) {
      setError(
        `${e.message} Les données affichées sont conservées. Recharge la page avant de réessayer.`
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPending(null);
    }
  }

  const index = view
    ? ROUNDS.findIndex(
        (round) =>
          round.key ===
          view.current.round_key
      )
    : -1;

  const active =
    view &&
    ['open', 'locked', 'scored'].includes(
      view.current.status
    );

  const initial =
    view &&
    index === 0 &&
    view.current.status ===
      'draft' &&
    view.officialCount === 0;

  return (
    <section
      className={styles.roundAdmin}
      aria-label="Gestion des rondes"
    >
      {error && (
        <p
          role="alert"
          className={styles.error}
        >
          {error}
        </p>
      )}

      {invalid && (
        <p
          role="alert"
          className={styles.error}
        >
          {invalid}
        </p>
      )}

      {message && (
        <p
          role="status"
          className={styles.success}
        >
          {message}
        </p>
      )}

      {warnings.length > 0 && (
        <div role="alert">
          <p>
            Mise à jour partielle :
            certains résultats n’ont
            pas été actualisés.
          </p>

          <ul>
            {warnings.map(
              (warning) => (
                <li key={warning}>
                  {warning}
                </li>
              )
            )}
          </ul>
        </div>
      )}

      {!data && !error && (
        <p>
          Chargement de la ronde…
        </p>
      )}

      {view && (
        <>
          <div
            className={
              active
                ? styles.operations
                : undefined
            }
          >
            {active && (
              <section
                className={`card ${styles.operationCard}`}
                aria-labelledby="round-update-title"
              >
                <h2 id="round-update-title">
                  🔄 Mise à jour complète
                </h2>

                <p>
                  Met à jour les résultats, QB Ratings et classements de la ronde.
                </p>

                <p
                  className={
                    styles.mutedText
                  }
                >
                  Scores ESPN · QB Ratings · Scoring · Classements. Vérifie les résultats avant de finaliser la ronde.
                </p>

                <div
                  className={
                    styles.operationAction
                  }
                >
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !view.canUpdate
                    }
                    onClick={() =>
                      run(
                        'update',
                        view.current
                          .round_key
                      )
                    }
                  >
                    {busy
                      ? 'En cours…'
                      : 'Mise à jour complète'}
                  </button>
                </div>
              </section>
            )}

            <section
              className={`card ${styles.operationCard}`}
              aria-labelledby="round-title"
            >
              <div
                className={
                  styles.roundTitleRow
                }
              >
                <div>
                  <p
                    className={
                      styles.eyebrow
                    }
                  >
                    Ronde active
                  </p>

                  <h2 id="round-title">
                    🏆{' '}
                    {
                      view.definition
                        .name
                    }
                  </h2>
                </div>

                <span
                  className={`${styles.badge} ${styles.draft}`}
                >
                  {
                    view.current
                      .status
                  }
                </span>
              </div>

              <dl
                className={
                  styles.roundMeta
                }
              >
                <div>
                  <dt>
                    Matchs officiels
                  </dt>

                  <dd>
                    {
                      view.officialCount
                    }{' '}
                    /{' '}
                    {
                      view.definition
                        .count
                    }
                  </dd>
                </div>

                <div>
                  <dt>FINAL</dt>

                  <dd>
                    {view.finalCount} /{' '}
                    {
                      view.definition
                        .count
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    Choix complets
                  </dt>

                  <dd>
                    {
                      data.completeMatchParticipants
                    }
                  </dd>
                </div>

                <div>
                  <dt>
                    Premier kickoff
                  </dt>

                  <dd>
                    {view.firstKickoff
                      ? new Date(
                          view.firstKickoff
                        ).toLocaleString(
                          'fr-CA',
                          {
                            dateStyle:
                              'medium',
                            timeStyle:
                              'short',
                          }
                        )
                      : 'À déterminer'}
                  </dd>
                </div>
              </dl>

              {view.blocked && (
                <p
                  className={
                    styles.roundBlocked
                  }
                >
                  {view.blocked}
                </p>
              )}

              {initial && (
                <div
                  className={
                    styles.operationAction
                  }
                >
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !view.canPrepare
                    }
                    onClick={() =>
                      setPending({
                        action:
                          'prepare',
                        roundKey:
                          'wild_card',
                        name:
                          view.definition
                            .name,
                      })
                    }
                  >
                    Préparer / ouvrir le
                    Wild Card
                  </button>
                </div>
              )}

              {active &&
                index < 3 &&
                !view.canAdvance && (
                  <p
                    className={
                      styles.helperText
                    }
                  >
                    La ronde doit être calculée puis finalisée avant de poursuivre.
                  </p>
                )}

              {(active || view.current.status === 'finalized') &&
                index < 3 && (
                  <div
                    className={
                      styles.operationAction
                    }
                  >
                    <button
                      className="button-secondary"
                      disabled={
                        busy ||
                        !view.canAdvance
                      }
                      onClick={() =>
                        setPending({
                          action:
                            'advance',
                          roundKey:
                            view.current
                              .round_key,
                          name:
                            ROUNDS[
                              index + 1
                            ].name,
                        })
                      }
                    >
                      Passer à la ronde
                      suivante
                    </button>
                  </div>
                )}

              {view.canFinalize && <div className={styles.operationAction}>
                <button className="button-secondary" disabled={busy} onClick={()=>setPending({action:'finalize',roundKey:view.current.round_key,name:view.definition.name})}>Finaliser la ronde</button>
              </div>}

              {index === 3 && (
                <p>
                  Le Super Bowl est la
                  dernière ronde.
                </p>
              )}

              {view.current.status ===
                'draft' &&
                !initial && (
                  <p>
                    Cette ronde doit être
                    ouverte par le passage
                    depuis la ronde
                    précédente. Aucune
                    initialisation séparée
                    n’est disponible.
                  </p>
                )}
            </section>
          </div>

          {view.games.length > 0 && (
            <section
              className={`card ${styles.gamesCard}`}
            >
              <div
                className={
                  styles.gamesHeader
                }
              >
                <h3>
                  Matchs de la ronde
                </h3>

                <span>
                  {view.games.length}{' '}
                  match
                  {view.games.length >
                  1
                    ? 's'
                    : ''}
                </span>
              </div>

              <ul
                className={
                  styles.roundGames
                }
              >
                {view.games.map(
                  (game) => (
                    <li
                      key={game.id}
                    >
                      <span>
                        {
                          game.away_team
                        }{' '}
                        @{' '}
                        {
                          game.home_team
                        }
                      </span>

                      <strong>
                        {game.external_game_id?.startsWith(
                          'TEST-'
                        )
                          ? 'TEST'
                          : {
                              pre:
                                'À venir',
                              in:
                                'LIVE',
                              post:
                                'FINAL',
                            }[
                              game
                                .game_status
                            ] ||
                            'Non vérifié'}
                      </strong>

                      {game.game_status !==
                        'pre' &&
                        game.home_score !=
                          null &&
                        game.away_score !=
                          null && (
                          <span>
                            {
                              game.away_score
                            }{' '}
                            –{' '}
                            {
                              game.home_score
                            }
                          </span>
                        )}
                    </li>
                  )
                )}
              </ul>
            </section>
          )}
        </>
      )}

      {pending && (
        <RoundConfirmation
          {...pending}
          busy={busy}
          onCancel={() =>
            setPending(null)
          }
          onConfirm={() =>
            run(
              pending.action,
              pending.roundKey
            )
          }
        />
      )}
    </section>
  );
}
