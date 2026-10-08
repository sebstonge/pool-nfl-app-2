'use client';
import NotificationLog from '../components/NotificationLog';
import {isPreviewAdmin} from '../../series/components/admin-preview/previewAdmin.mjs';
import { getPlayoffContext } from '../../../lib/playoffs/context.mjs';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  snapshotState,
  requestSnapshot,
} from './snapshotAdmin.mjs';
import styles from './playoffs.module.css';
import RoundAdmin, { requestRound } from './RoundAdmin';


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

export function PlayoffsAdminView({
  activeMode=false,
  season,
  request,
  teams = [],
  roundRequest = requestRound,
}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
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
  }, [request, season, activeMode]);

  const state = snapshotState(rows || [], season);

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
          <h1>{activeMode?'Admin Séries ⚙️':'🏆 Séries NFL'}</h1>
          <p>Saison {season}{!activeMode?' · Aperçu Admin':''}</p>
        </div>

        {rows !== null && (
          <div className={styles.heroActions}>
            <a
              className={`button-secondary ${styles.navControl}`}
              href={activeMode?'/':'/admin'}
            >
              {activeMode?'Voir l’application':'← Mode régulier'}
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

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {rows === null ? (
        <section className="card">
          <p>
            {error
              ? 'Le snapshot n’a pas pu être chargé.'
              : 'Chargement des séries…'}
          </p>

        </section>
      ) : (
        <>

          <RoundAdmin season={season} request={roundRequest} activeMode={activeMode}/>
          {!activeMode && <p className={styles.mutedText}>Le passage en Séries depuis l’Admin régulier valide les seeds et ouvre Wild Card dans une seule opération. <a href="/admin">Retour à l’Admin</a></p>}
          <section className="card">
            <h2>🏈 Seeds NFL</h2>
            <p>{state.finalized?'Référence officielle figée':state.locked?'État incohérent':'Classement provisoire'} · {rows.length}/14 équipes · AFC {afcCount}/7 · NFC {nfcCount}/7</p>
            <p className={styles.mutedText}>Capture : {date(state.capturedAt)}</p>
          </section>

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


        </>
      )}


      <NotificationLog scope="playoffs" />

    </main>
  );
}

const request = (body) =>
  requestSnapshot(supabase, body);

export default function PlayoffsAdminPage() {
  const [authorized,setAuthorized]=useState(null);
  useEffect(()=>{let active=true;isPreviewAdmin(supabase).then(value=>{if(active)setAuthorized(value);});return()=>{active=false;};},[]);
  const [teams, setTeams] = useState([]);
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState('');
  useEffect(() => {
    let active = true;
    getPlayoffContext(supabase).then(value => { if(active) setContext(value); })
      .catch(() => { if(active) setContextError('Contexte global indisponible.'); });
    return () => { active = false; };
  }, []);

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

  if(authorized===false)return <main className="page"><p role="alert">Accès administrateur requis.</p><a href="/">Accueil / Connexion</a></main>;
  if(authorized===null)return <main className="page"><p role="status">Vérification de l’accès…</p></main>;
  if (!context) return <main className="page"><p role="status">{contextError || "Chargement…"}</p></main>;
  return (
    <PlayoffsAdminView
      activeMode={context.phase==='playoffs'}
      season={context.season}
      request={request}
      teams={teams}
    />
  );
}
