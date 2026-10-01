'use client';
// Presentation copied from app/analytics/page.js. Only Playoffs data/time labels differ.
import {useEffect,useState} from 'react';
import {usePlayoffData} from '../public-pages/usePlayoffData';
import {buildAnalytics} from './analyticsData.mjs';
function PlayerIdentity({
  name,
  realName: secondaryName,
  compact = false,
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <strong
        style={{
          display: "block",
          fontSize: compact ? 14 : 16,
          lineHeight: 1.15,
          color: "#f8fafc",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </strong>

      {secondaryName && (
        <span
          style={{
            display: "block",
            marginTop: 2,
            color: "#94a3b8",
            fontSize: compact ? 11 : 13,
            fontWeight: 400,
            lineHeight: 1.2,
          }}
        >
          {secondaryName}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   CARTE STATISTIQUE
   ========================================================= */

function StatCard({
  icon,
  title,
  value,
  subtitle,
  color = "#22c55e",
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
        minWidth: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          fontSize: 30,
          marginBottom: 10,
        }}
      >
        {icon}
      </div>

      <p
        style={{
          margin: 0,
          color: "#cbd5e1",
          fontWeight: 800,
        }}
      >
        {title}
      </p>

      <h2
        style={{
          margin: "8px 0",
          color,
          fontSize: 34,
        }}
      >
        {value}
      </h2>

      <div
        style={{
          margin: 0,
          color: "#94a3b8",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

/* =========================================================
   CONSENSUS
   ========================================================= */

function ConsensusCard({
  icon,
  title,
  value,
  subtitle,
  color = "#38bdf8",
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background: "rgba(15,23,42,0.72)",
        border: "1px solid rgba(148,163,184,0.14)",
        minWidth: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          fontSize: 26,
          marginBottom: 8,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          color: "#94a3b8",
          fontSize: 12,
          fontWeight: 800,
          marginBottom: 5,
        }}
      >
        {title}
      </div>

      <strong
        style={{
          display: "block",
          color,
          fontSize: 26,
          lineHeight: 1.1,
        }}
      >
        {value}
      </strong>

      {subtitle && (
        <div
          style={{
            marginTop: 6,
            color: "#cbd5e1",
            fontSize: 13,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   CARTE RECORD QB
   ========================================================= */

function QBRecordCard({
  icon,
  title,
  qb,
  teams,
  color = "#22c55e",
  isDesktop = false,
}) {
  const team = teams.find(
    (t) =>
      t.name?.toLowerCase().trim() ===
      qb?.team?.toLowerCase().trim()
  );

  const logo = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo || null;

  const qbHeadshot =
    qb?.espn_athlete_id
      ? `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`
      : null;

  return (
    <div
      style={{
        padding: isDesktop ? "18px 20px" : 16,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {!qb ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 28,
                lineHeight: 1,
              }}
            >
              {icon}
            </span>

            <strong
              style={{
                color: "#cbd5e1",
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              {title}
            </strong>
          </div>

          <p
            style={{
              color: "#94a3b8",
              marginBottom: 0,
            }}
          >
            En attente
          </p>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: isDesktop ? 14 : 16,
            }}
          >
            <span
              style={{
                fontSize: isDesktop ? 28 : 26,
                lineHeight: 1,
              }}
            >
              {icon}
            </span>

            <strong
              style={{
                color: "#cbd5e1",
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              {title}
            </strong>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isDesktop
                ? "125px minmax(0, 1fr)"
                : "92px minmax(0, 1fr)",
              gap: isDesktop ? 16 : 14,
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                position: "relative",
                minHeight: isDesktop ? 118 : 108,
                overflow: "hidden",
              }}
            >
              {qbHeadshot ? (
                <img
                  src={qbHeadshot}
                  alt={qb.name}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    objectPosition: "center center",
                    display: "block",
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 16,
                    background:
                      "rgba(148,163,184,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    fontWeight: 900,
                    fontSize: isDesktop ? 22 : 18,
                  }}
                >
                  QB
                </div>
              )}
            </div>

            <div
              style={{
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: isDesktop ? 9 : 7,
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    color: "#f8fafc",
                    fontSize: isDesktop ? 20 : 18,
                    lineHeight: 1.08,
                    fontWeight: 900,
                    minWidth: 0,
                  }}
                >
                  {qb.name}
                </strong>

                {logo && (
                  <img
                    src={logo}
                    alt={qb.team}
                    style={{
                      width: isDesktop ? 38 : 30,
                      height: isDesktop ? 38 : 30,
                      objectFit: "contain",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>

              <div
                style={{
                  color,
                  fontSize: isDesktop ? 36 : 32,
                  lineHeight: 1,
                  fontWeight: 900,
                }}
              >
                {qb.rating.toFixed(1)}
              </div>

              <div
                style={{
                  color: "#94a3b8",
                  fontSize: isDesktop ? 15 : 14,
                  lineHeight: 1.1,
                  fontWeight: 700,
                }}
              >
                {qb.round}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: isDesktop ? 14 : 13,
              paddingTop: isDesktop ? 12 : 11,
              borderTop:
                "1px solid rgba(148,163,184,0.14)",
            }}
          >
            <span
              style={{
                display: "block",
                color: "#94a3b8",
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              Choisi par
            </span>

            <PlayerIdentity
              name={qb.selectedBy}
              realName={qb.selectedByRealName}
              compact
            />
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   MINI CLASSEMENT
   ========================================================= */

function MiniRanking({
  title,
  rows,
  valueLabel = "",
}) {
  return (
    <section
      className="card"
      style={{
        height: "100%",
        margin: 0,
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        {title}
      </h2>

      {rows.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>
          En attente.
        </p>
      ) : (
        rows.slice(0, 5).map((row, index) => (
          <div
            key={row.userId || index}
            style={{
              display: "grid",
              gridTemplateColumns:
                "42px minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 0",
              borderBottom:
                index ===
                Math.min(rows.length, 5) - 1
                  ? "none"
                  : "1px solid rgba(148,163,184,0.12)",
            }}
          >
            <strong
              style={{
                color:
                  index < 3
                    ? "#22c55e"
                    : "#94a3b8",
              }}
            >
              #{index + 1}
            </strong>

            <div style={{ minWidth: 0 }}>
              <PlayerIdentity
                name={row.name}
                realName={row.realName}
              />

              <p
                style={{
                  margin: "4px 0 0 0",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                {row.detail}
              </p>
            </div>

            <strong
              style={{
                color: "#22c55e",
                fontSize: 22,
              }}
            >
              {row.value}
              {valueLabel}
            </strong>
          </div>
        ))
      )}
    </section>
  );
}

/* =========================================================
   HISTORIQUE PERSONNEL
   ========================================================= */

function PersonalHistory({
  rounds,
  totalScore,
  bestRound,
  worstRound,
  isDesktop,
}) {
  const average =
    rounds.length > 0
      ? totalScore / rounds.length
      : null;

  return (
    <section
      className="card"
      style={{ margin: 0 }}
    >
      <h2 style={{ marginTop: 0 }}>
        👤 Mon historique
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isDesktop
            ? "repeat(4, minmax(0, 1fr))"
            : "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <ConsensusCard
          icon="🏆"
          title="Score total"
          value={totalScore == null ? "—" : totalScore.toFixed(3)}
          subtitle="Séries"
          color="#facc15"
        />

        <ConsensusCard
          icon="📊"
          title="Moyenne / ronde"
          value={average == null ? "—" : average.toFixed(3)}
          subtitle={totalScore == null ? "En attente" : `${rounds.length} ronde${
            rounds.length > 1 ? "s" : ""
          }`}
        />

        <ConsensusCard
          icon="🔥"
          title="Meilleure ronde"
          value={
            bestRound
              ? bestRound.score.toFixed(3)
              : "—"
          }
          subtitle={
            bestRound
              ? `${bestRound.round}`
              : "En attente"
          }
          color="#22c55e"
        />

        <ConsensusCard
          icon="📉"
          title="Pire ronde"
          value={
            worstRound
              ? worstRound.score.toFixed(3)
              : "—"
          }
          subtitle={
            worstRound
              ? `${worstRound.round}`
              : "En attente"
          }
          color="#ef4444"
        />
      </div>
    </section>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export function AnalyticsView({data,error,retry}) {
  const [isDesktop,setIsDesktop]=useState(false);
  useEffect(()=>{const update=()=>setIsDesktop(window.innerWidth>=900);update();window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
  const loading=!data&&!error;
  const message=error || '';
  const teams=data?.teams || [];
  const stats=data&&!data.requiresSignIn?buildAnalytics(data):null;
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#f8fafc",

        width: isDesktop
          ? "calc(100% - 48px)"
          : "100%",

        maxWidth: isDesktop
          ? 1280
          : "none",

        margin: "0 auto",

        padding: isDesktop
          ? "112px 0 110px"
          : "24px 16px 110px",

        boxSizing: "border-box",
      }}
    >
      {/* =====================================================
          EN-TÊTE
          ===================================================== */}

      <section
        className="card"
        style={{
          margin: 0,
          marginBottom: isDesktop
            ? 18
            : 16,
        }}
      >
        <h1
          style={{
            marginTop: 0,
            marginBottom: 6,
          }}
        >
          📊 Statistiques
        </h1>

        <p
          style={{
            margin: 0,
            color: "#94a3b8",
          }}
        >
          Records, tendances et historique du pool.
        </p>
      </section>

      {loading && (
        <section
          className="card"
          style={{
            margin: 0,
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#94a3b8",
            }}
          >
            Chargement des statistiques...
          </p>
        </section>
      )}

      {message && (
        <section
          className="card"
          style={{
            margin: 0,
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#ef4444",
            }}
          >
            {message}
          </p>
        </section>
      )}

      {error && <button className="button-secondary" onClick={retry}>Réessayer</button>}
      {data?.requiresSignIn && <section className="card"><p>Connecte-toi pour consulter les statistiques des séries.</p><a className="button" href="/">Se connecter</a></section>}
      {!loading && stats && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",

            /*
             * IMPORTANT :
             * Toutes les grandes sections de Stats
             * utilisent maintenant exactement le même
             * espacement vertical.
             */
            gap: isDesktop
              ? 18
              : 16,
          }}
        >
          {/* =================================================
              RECORDS DE SÉRIES
              ================================================= */}

          <section
            className="card"
            style={{
              margin: 0,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 16,
              }}
            >
              🏆 Records des séries
            </h2>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  isDesktop
                    ? "repeat(4, minmax(0, 1fr))"
                    : "repeat(2, minmax(0, 1fr))",

                gap: 12,
              }}
            >
              <StatCard
                icon="🔥"
                title="Meilleure ronde"
                value={
                  stats.bestRound
                    ? stats.bestRound.score.toFixed(
                        3
                      )
                    : "—"
                }
                subtitle={
                  stats.bestRound
                    ? `${stats.bestRound.round} · ${stats.bestRound.name}`
                    : "En attente"
                }
              />

              <StatCard
                icon="📉"
                title="Pire ronde"
                value={
                  stats.worstRound
                    ? stats.worstRound.score.toFixed(
                        3
                      )
                    : "—"
                }
                subtitle={
                  stats.worstRound
                    ? `${stats.worstRound.round} · ${stats.worstRound.name}`
                    : "En attente"
                }
                color="#ef4444"
              />

              <StatCard
                icon="🎯"
                title="Écarts exacts"
                value={
                  stats.totalPicks ? stats.totalExact : "—"
                }
                subtitle={`${stats.totalPicks} choix complétés`}
                color="#facc15"
              />

              <StatCard
                icon="✅"
                title="Bons gagnants"
                value={
                  stats.totalPicks ? stats.totalCorrect : "—"
                }
                subtitle={
                  stats.totalPicks > 0
                    ? `${Math.round(
                        (stats.totalCorrect /
                          stats.totalPicks) *
                          100
                      )} % du pool`
                    : "En attente"
                }
                color="#22c55e"
              />
            </div>
          </section>

          {/* =================================================
              CLASSEMENTS JOUEURS
              ================================================= */}

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                isDesktop
                  ? "repeat(2, minmax(0, 1fr))"
                  : "1fr",

              gap: isDesktop
                ? 18
                : 16,

              alignItems: "stretch",
            }}
          >
            <MiniRanking
              title="🎯 Rois de l'écart exact"
              rows={stats.topExact}
            />

            <MiniRanking
              title="✅ Meilleurs gagnants"
              rows={stats.topCorrect}
            />
          </div>

          {/* =================================================
              CONSENSUS DU POOL
              ================================================= */}

          <section
            className="card"
            style={{
              margin: 0,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 16,
              }}
            >
              🧠 Consensus du pool
            </h2>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  isDesktop
                    ? "repeat(4, minmax(0, 1fr))"
                    : "repeat(2, minmax(0, 1fr))",

                gap: 12,
              }}
            >
              <ConsensusCard
                icon="📈"
                title="Réussite du consensus"
                value={stats.consensusPct == null ? "—" : `${Math.round(stats.consensusPct)} %`}
                subtitle={stats.consensusPct == null ? "En attente des résultats publiés" : `${stats.consensusWins} victoires · ${stats.consensusLosses} défaites`}
                color="#38bdf8"
              />

              <ConsensusCard
                icon="✅"
                title="Bons consensus"
                value={
                  stats.consensusPct == null ? "—" : stats.consensusWins
                }
                subtitle="Matchs correctement prédits"
                color="#22c55e"
              />

              <ConsensusCard
                icon="🔥"
                title="Meilleure ronde"
                value={
                  stats.bestConsensusRound
                    ? `${Math.round(
                        stats
                          .bestConsensusRound
                          .pct
                      )} %`
                    : "—"
                }
                subtitle={
                  stats.bestConsensusRound
                    ? `${stats.bestConsensusRound.round} · ${stats.bestConsensusRound.wins}/${stats.bestConsensusRound.wins + stats.bestConsensusRound.losses}`
                    : "En attente"
                }
                color="#facc15"
              />

              <ConsensusCard
                icon="📉"
                title="Pire ronde"
                value={
                  stats.worstConsensusRound
                    ? `${Math.round(
                        stats
                          .worstConsensusRound
                          .pct
                      )} %`
                    : "—"
                }
                subtitle={
                  stats.worstConsensusRound
                    ? `${stats.worstConsensusRound.round} · ${stats.worstConsensusRound.wins}/${stats.worstConsensusRound.wins + stats.worstConsensusRound.losses}`
                    : "En attente"
                }
                color="#ef4444"
              />
            </div>
          </section>

          {/* =================================================
              RECORDS QB
              ================================================= */}

          <section
            className="card"
            style={{
              margin: 0,
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: isDesktop
                  ? 18
                  : 16,
              }}
            >
              Records QB 🔥
            </h2>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  isDesktop
                    ? "repeat(2, minmax(0, 1fr))"
                    : "1fr",

                gap: isDesktop
                  ? 16
                  : 12,

                alignItems: "stretch",
              }}
            >
              <QBRecordCard
                icon="🔥"
                title="Meilleur QB utilisé"
                qb={stats.bestQb}
                teams={teams}
                isDesktop={isDesktop}
              />

              <QBRecordCard
                icon="💀"
                title="Pire QB utilisé"
                qb={stats.worstQb}
                teams={teams}
                color="#ef4444"
                isDesktop={isDesktop}
              />
            </div>
          </section>

          {/* =================================================
              MON HISTORIQUE
              ================================================= */}

          <PersonalHistory
            rounds={
              stats.myRoundRows
            }
            totalScore={
              stats.myTotalScore
            }
            bestRound={
              stats.myBestRound
            }
            worstRound={
              stats.myWorstRound
            }
            isDesktop={isDesktop}
          />

          {/* =================================================
              MES QB UTILISÉS + MES RONDES
              ================================================= */}

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                isDesktop
                  ? "repeat(2, minmax(0, 1fr))"
                  : "1fr",

              gap: isDesktop
                ? 18
                : 16,

              alignItems: "stretch",
            }}
          >
            {/* ===============================================
                MES QB UTILISÉS
                =============================================== */}

            <section
              className="card"
              style={{
                margin: 0,
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: 16,
                }}
              >
                🏈 Mes QB choisis
              </h2>

              {stats.myQbPicks.length === 0 ? (
                <p
                  style={{
                    marginBottom: 0,
                    color: "#94a3b8",
                  }}
                >
                  Aucun QB choisi.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {stats.myQbPicks.map(
                    (qbPick, index) => {
                      const team =
                        teams.find(
                          (teamRow) =>
                            teamRow.name
                              ?.toLowerCase()
                              .trim() ===
                            qbPick.team
                              ?.toLowerCase()
                              .trim()
                        );

                      const teamLogo =
                        team?.espn_abbr
                          ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
                          : team?.logo ||
                            null;

                      return (
                        <div
                          key={`${qbPick.round}-${qbPick.qbName}`}
                          style={{
                            display: "grid",

                            gridTemplateColumns:
                              "82px minmax(0, 1fr) auto",

                            gap: 14,

                            alignItems: "center",

                            padding:
                              "13px 0",

                            borderBottom:
                              index ===
                              stats.myQbPicks.length -
                                1
                                ? "none"
                                : "1px solid rgba(148,163,184,0.12)",
                          }}
                        >
                          {/* RONDE */}

                          <span
                            style={{
                              color:
                                "#94a3b8",

                              fontSize: 13,

                              fontWeight: 700,
                            }}
                          >

                            {qbPick.round}
                          </span>

                          {/* QB */}

                          <div
                            style={{
                              minWidth: 0,
                            }}
                          >
                            <div
                              style={{
                                display:
                                  "flex",

                                alignItems:
                                  "center",

                                gap: 8,

                                minWidth: 0,
                              }}
                            >
                              <strong
                                style={{
                                  color:
                                    "#f8fafc",

                                  fontSize:
                                    16,

                                  lineHeight:
                                    1.15,
                                }}
                              >
                                {
                                  qbPick.qbName
                                }
                              </strong>

                              {teamLogo && (
                                <img
                                  src={
                                    teamLogo
                                  }
                                  alt={
                                    qbPick.team
                                  }
                                  style={{
                                    width: 26,
                                    height: 26,

                                    objectFit:
                                      "contain",

                                    flexShrink: 0,
                                  }}
                                />
                              )}
                            </div>

                            {qbPick.actualQbName &&
                              qbPick.actualQbName !==
                                qbPick.qbName && (
                                <div
                                  style={{
                                    marginTop:
                                      3,

                                    color:
                                      "#94a3b8",

                                    fontSize:
                                      11,
                                  }}
                                >
                                  Remplacé par{" "}
                                  {
                                    qbPick.actualQbName
                                  }
                                </div>
                              )}
                          </div>

                          {/* RATING */}

                          <strong
                            style={{
                              color:
                                qbPick.rating !=
                                null
                                  ? "#22c55e"
                                  : "#94a3b8",

                              fontSize: 20,

                              flexShrink: 0,

                              textAlign:
                                "right",
                            }}
                          >
                            {qbPick.rating !=
                            null
                              ? qbPick.rating.toFixed(
                                  1
                                )
                              : "—"}
                          </strong>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </section>

            {/* ===============================================
                MES RONDES
                =============================================== */}

            <section
              className="card"
              style={{
                margin: 0,
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: 16,
                }}
              >
                📅 Mes rondes
              </h2>

              {stats.myRoundRows.length ===
              0 ? (
                <p
                  style={{
                    marginBottom: 0,
                    color: "#94a3b8",
                  }}
                >
                  En attente des résultats officiels par ronde.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {stats.myRoundRows.map(
                    (
                      roundRow,
                      index
                    ) => (
                      <div
                        key={
                          roundRow.id ||
                          `${roundRow.user_id}-${roundRow.round}`
                        }
                        style={{
                          display:
                            "flex",

                          alignItems:
                            "center",

                          justifyContent:
                            "space-between",

                          gap: 16,

                          padding:
                            "13px 0",

                          borderBottom:
                            index ===
                            stats
                              .myRoundRows
                              .length -
                              1
                              ? "none"
                              : "1px solid rgba(148,163,184,0.12)",
                        }}
                      >
                        <span
                          style={{
                            color:
                              "#94a3b8",

                            fontSize:
                              13,

                            fontWeight:
                              700,
                          }}
                        >

                          {roundRow.round}
                        </span>

                        <strong
                          style={{
                            color:
                              "#22c55e",

                            fontSize:
                              20,

                            textAlign:
                              "right",
                          }}
                        >
                          {roundRow.score.toFixed(
                            3
                          )}
                        </strong>
                      </div>
                    )
                  )}
                </div>
              )}
                        </section>
          </div>

          {/* =================================================
              FIN DES SECTIONS STATS
              ================================================= */}
        </div>
      )}


    </main>
  );
}

export default function SeriesAnalytics(){return <AnalyticsView {...usePlayoffData()}/>;}
