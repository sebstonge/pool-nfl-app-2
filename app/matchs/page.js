"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

/* =========================================================
   ORDRE OFFICIEL — SEMAINE 1
   ========================================================= */

const WEEK_1_QB_ORDER = [
  "Alexandre",
  "Edouard",
  "Louis-Simon",
  "Séb",
  "Charles",
  "Naomie",
  "Léa",
  "Félix",
  "Carolyne",
  "Mathieu",
  "Katy",
  "Pierre-André",
  "Étienne",
];

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerRealName(player) {
  return (
    player?.real_name ||
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) {
  const ordered = [];
  const usedIds = new Set();

  WEEK_1_QB_ORDER.forEach((wantedName) => {
    const wanted = normalizeName(wantedName);

    let player = players.find(
      (p) =>
        !usedIds.has(p.id) &&
        normalizeName(p.real_name) === wanted
    );

    if (!player) {
      player = players.find((p) => {
        if (usedIds.has(p.id)) return false;

        const actual = normalizeName(p.real_name);

        return (
          actual.startsWith(wanted) ||
          wanted.startsWith(actual)
        );
      });
    }

    if (player) {
      ordered.push(player);
      usedIds.add(player.id);
    }
  });

  const leftovers = players
    .filter((p) => !usedIds.has(p.id))
    .sort((a, b) =>
      playerRealName(a).localeCompare(
        playerRealName(b),
        "fr"
      )
    );

  return [...ordered, ...leftovers];
}

function getWeeklyScoreValue(row) {
  const candidates = [
    row?.total_score,
    row?.final_score,
    row?.weekly_score,
    row?.score,
    row?.points,
    row?.total,
  ];

  for (const value of candidates) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

/* =========================================================
   HELPERS
   ========================================================= */

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function getPickBadge(game, pick) {
  if (
    game.home_score == null ||
    game.away_score == null
  ) {
    return "⚪";
  }

  const winner =
    game.home_score > game.away_score
      ? game.home_team
      : game.away_team;

  const realSpread = Math.abs(
    game.home_score - game.away_score
  );

  if (pick.picked_team !== winner) return "🔴";

  if (
    Number(pick.predicted_spread) === realSpread
  ) {
    return "🟢";
  }

  return "🟡";
}

function getPickPoints(game, pick) {
  if (
    game.home_score == null ||
    game.away_score == null
  ) {
    return null;
  }

  const winner =
    Number(game.home_score) >
    Number(game.away_score)
      ? game.home_team
      : game.away_team;

  const realSpread = Math.abs(
    Number(game.home_score) -
      Number(game.away_score)
  );

  if (pick.picked_team !== winner) {
    return 0;
  }

  if (
    Number(pick.predicted_spread) === realSpread
  ) {
    return 2;
  }

  return 1;
}

function getOfficialResultText(game) {
  if (
    game.home_score == null ||
    game.away_score == null
  ) {
    return null;
  }

  if (
    Number(game.home_score) ===
    Number(game.away_score)
  ) {
    return "Égalité";
  }

  const winner =
    Number(game.home_score) >
    Number(game.away_score)
      ? game.home_team
      : game.away_team;

  const spread = Math.abs(
    Number(game.home_score) -
      Number(game.away_score)
  );

  return `${winner} par ${spread}`;
}

function getTemporaryResultText(game, liveGame) {
  if (!liveGame?.score) return null;

  const awayScore = Number(liveGame.score.awayScore);
  const homeScore = Number(liveGame.score.homeScore);

  if (awayScore === homeScore) {
    return "Égalité";
  }

  const winner =
    homeScore > awayScore
      ? game.home_team
      : game.away_team;

  const spread = Math.abs(homeScore - awayScore);

  return `${winner} par ${spread}`;
}

function ratingColor(rating) {
  const value = Number(rating);

  if (value >= 100) return "#22c55e";
  if (value >= 90) return "#f8fafc";
  if (value >= 70) return "#f97316";

  return "#ef4444";
}

function TeamLogo({
  logo,
  name,
  selected = false,
  onClick,
  size = 78,
  plain = false,
}) {
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: plain ? "auto" : size,
        height: plain ? "auto" : size,
        borderRadius: plain ? 0 : "50%",
        background: plain
          ? "transparent"
          : selected
          ? "#ffffff"
          : "transparent",
        border: plain
          ? "none"
          : selected
          ? "3px solid #ffffff"
          : "2px solid rgba(148,163,184,0.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onClick ? "pointer" : "default",
        boxShadow:
          plain || !selected
            ? "none"
            : "0 0 18px rgba(255,255,255,0.35)",
        padding: 0,
      }}
    >
      {!error && logo ? (
        <img
          src={logo}
          alt={name}
          onError={() => setError(true)}
          style={{
            width: plain ? size : size - 18,
            height: plain ? size : size - 18,
            objectFit: "contain",
          }}
        />
      ) : (
        <span
          style={{
            fontWeight: 900,
            color: "#f8fafc",
          }}
        >
          {name?.slice(0, 2)}
        </span>
      )}
    </button>
  );
}

function formatGameDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  const days = [
    "DIMANCHE",
    "LUNDI",
    "MARDI",
    "MERCREDI",
    "JEUDI",
    "VENDREDI",
    "SAMEDI",
  ];

  const day = days[date.getDay()];

  const time = date.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${day} · ${time}`;
}

function GameTimeBar({
  gameDate,
  isLive = false,
  isEspnFinal = false,
  hasOfficialScore = false,
}) {
  const fullDate = formatGameDate(gameDate);
  const dayOnly = fullDate.split(" · ")[0];

  let content;

  if (hasOfficialScore) {
    content = (
      <>
        <span>🗓️</span>
        <span>{dayOnly}</span>
      </>
    );
  } else if (isEspnFinal) {
    content = <span>TERMINÉ</span>;
  } else if (isLive) {
    content = (
      <span style={{ color: "#f87171" }}>
        ● EN DIRECT
      </span>
    );
  } else {
    content = (
      <>
        <span>🗓️</span>
        <span>{fullDate}</span>
      </>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        color: "#4ade80",
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: "0.25px",
      }}
    >
      {content}
    </div>
  );
}

/* =========================================================
   ESPN LIVE / POST
   ========================================================= */

function getLiveGameStatus(summary) {
  const competition =
    summary?.header?.competitions?.[0];

  const status = competition?.status || null;

  return {
    state: status?.type?.state || "",
    completed: status?.type?.completed === true,
    period: Number(status?.period || 0),
    clock: status?.displayClock || "",
  };
}

function getLiveScore(summary) {
  const competition =
    summary?.header?.competitions?.[0];

  const competitors =
    competition?.competitors || [];

  const away = competitors.find(
    (team) => team.homeAway === "away"
  );

  const home = competitors.find(
    (team) => team.homeAway === "home"
  );

  if (!away || !home) return null;

  const awayScore = Number(away.score);
  const homeScore = Number(home.score);

  if (
    Number.isNaN(awayScore) ||
    Number.isNaN(homeScore)
  ) {
    return null;
  }

  return {
    awayScore,
    homeScore,
  };
}

function getQuarterLabel(period) {
  if (period === 1) return "1er";
  if (period === 2) return "2e";
  if (period === 3) return "3e";
  if (period === 4) return "4e";
  if (period > 4) return "PROL.";

  return "";
}

function getLivePassers(summary) {
  const passers = [];

  const boxscoreTeams =
    summary?.boxscore?.players || [];

  boxscoreTeams.forEach((teamBox) => {
    const team = teamBox?.team || {};

    const teamNames = [
      team.abbreviation,
      team.shortDisplayName,
      team.displayName,
      team.name,
    ]
      .filter(Boolean)
      .map((value) =>
        String(value).toLowerCase().trim()
      );

    const passingCategory =
      teamBox.statistics?.find(
        (category) =>
          category.name === "passing" ||
          category.displayName === "Passing"
      );

    if (!passingCategory) return;

    const labels = passingCategory.labels || [];

    const ratingIndex = labels.findIndex((label) =>
      ["RTG", "RAT", "RATE"].includes(
        String(label).toUpperCase()
      )
    );

    if (ratingIndex === -1) return;

    (passingCategory.athletes || []).forEach(
      (row) => {
        const rating = Number(
          row.stats?.[ratingIndex]
        );

        if (Number.isNaN(rating)) return;

        passers.push({
          athleteId: row.athlete?.id
            ? String(row.athlete.id)
            : null,

          name:
            row.athlete?.displayName ||
            row.athlete?.shortName ||
            "",

          rating,
          teamNames,
        });
      }
    );
  });

  return passers;
}

function normalizeTeam(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function teamMatches(qbTeam, teamNames) {
  const normalizedQbTeam =
    normalizeTeam(qbTeam);

  if (!normalizedQbTeam) return false;

  return (teamNames || []).some((name) => {
    const normalizedName =
      normalizeTeam(name);

    return (
      normalizedName === normalizedQbTeam ||
      normalizedName.includes(
        normalizedQbTeam
      ) ||
      normalizedQbTeam.includes(
        normalizedName
      )
    );
  });
}

function findQbGameData(
  qbPick,
  liveGames,
  includePost = true
) {
  const qb = qbPick?.qbs;

  if (!qb?.team) return null;

  const matchingGame = Object.values(
    liveGames || {}
  ).find((game) => {
    if (!game) return false;

    const state = game.status?.state;

    const validState =
      state === "in" ||
      (includePost && state === "post");

    if (!validState) return false;

    return teamMatches(
      qb.team,
      game.teamNames
    );
  });

  if (!matchingGame) return null;

  const passers = matchingGame.passers || [];

  let passer = null;

  if (qb.espn_athlete_id) {
    passer =
      passers.find(
        (row) =>
          String(row.athleteId) ===
          String(qb.espn_athlete_id)
      ) || null;
  }

  if (!passer) {
    const qbName = String(qb.name || "")
      .toLowerCase()
      .trim();

    passer =
      passers.find(
        (row) =>
          String(row.name || "")
            .toLowerCase()
            .trim() === qbName
      ) || null;
  }

  /*
   * Si le QB choisi n'a PAS joué,
   * on utilise le QB réel de l'équipe.
   *
   * Si le QB choisi a commencé puis
   * s'est blessé, il existe déjà dans
   * passers et son propre rating demeure.
   */
  if (!passer) {
    passer =
      passers.find((row) =>
        teamMatches(
          qb.team,
          row.teamNames
        )
      ) || null;
  }

  return {
    game: matchingGame,
    passer,
  };
}

function QBPhoto({
  qb,
  mobile = false,
  size: forcedSize,
}) {
  const [error, setError] = useState(false);

  const src = getQbHeadshot(qb);

  const size =
    forcedSize ||
    (mobile ? 105 : 140);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 24,
          background:
            "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize:
            size < 80
              ? 16
              : mobile
              ? 22
              : 28,
        }}
      >
        QB
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={qb?.name || "QB"}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        maxWidth: "100%",
      }}
    />
  );
}

/* =========================================================
   ORDRE DE SÉLECTION QB
   ========================================================= */

function SelectionOrderBar({
  players,
  currentUserId,
  currentWeek,
}) {
  /*
   * Lorsque les 13 joueurs ont soumis,
   * la carte disparaît complètement.
   */
  if (!players || players.length === 0) {
    return null;
  }

  return (
    <section
      className="card"
      style={{
        padding: 20,
        overflow: "hidden",
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            color: "#f8fafc",
            fontSize: 22,
          }}
        >
          🏈 Ordre de sélection
        </h2>

        <p
          style={{
            margin: "6px 0 0",
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Ordre restant · Semaine {currentWeek}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingTop: 18,
          paddingBottom: 4,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {players.map((player, index) => {
          const isNext = index === 0;
          const isMe =
            player.id === currentUserId;

          return (
            <div
              key={player.id}
              style={{
                flex: "0 0 auto",
                minWidth: 160,
                padding: "12px 14px",
                borderRadius: 16,
                background: isNext
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(15,23,42,0.72)",
                border: isNext
                  ? "1px solid rgba(34,197,94,0.34)"
                  : "1px solid rgba(148,163,184,0.14)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 27,
                    height: 27,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isNext
                      ? "#22c55e"
                      : "rgba(148,163,184,0.14)",
                    color: isNext
                      ? "#052e16"
                      : "#cbd5e1",
                    fontWeight: 900,
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </span>

                <strong
                  style={{
                    color: "#f8fafc",
                    fontSize: 14,
                    lineHeight: 1.15,
                  }}
                >
                  {playerRealName(player)}
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginTop: 9,
                }}
              >
                {isNext && (
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background:
                        "rgba(34,197,94,0.16)",
                      color: "#86efac",
                      fontSize: 10,
                      fontWeight: 900,
                    }}
                  >
                    PROCHAIN
                  </span>
                )}

                {isMe && (
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background:
                        "rgba(59,130,246,0.14)",
                      color: "#93c5fd",
                      fontSize: 10,
                      fontWeight: 900,
                    }}
                  >
                    TOI
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* =========================================================
   CARTE D'UN MATCH DÉJÀ SOUMIS
   ========================================================= */

function SubmittedGameCard({
  game,
  pick,
  liveGame,
  getTeamLogo,
  formatTeamRecord,
  isMobile,
}) {
  const hasOfficialScore =
    game.home_score != null &&
    game.away_score != null;

  const isLive =
    liveGame?.status?.state === "in";

  const isEspnFinal =
    liveGame?.status?.state === "post";

  /*
   * PRIORITÉ DU SCORE :
   *
   * 1. Score officiel Supabase
   * 2. Score temporaire ESPN
   * 3. Aucun score
   */
  const displayedScore =
    hasOfficialScore
      ? {
          awayScore: Number(
            game.away_score
          ),
          homeScore: Number(
            game.home_score
          ),
        }
      : liveGame?.score || null;

  /*
   * IMPORTANT :
   *
   * Le badge utilise uniquement
   * le score officiel Supabase.
   *
   * ESPN ne peut donc jamais
   * attribuer temporairement
   * 🟢 🟡 🔴.
   */
  const badge =
    getPickBadge(game, pick);

  let resultText = null;
  let pointsText = null;

  if (hasOfficialScore) {
    const awayScore =
      Number(game.away_score);

    const homeScore =
      Number(game.home_score);

    if (awayScore === homeScore) {
      resultText = "Égalité";
    } else {
      const winner =
        homeScore > awayScore
          ? game.home_team
          : game.away_team;

      const spread =
        Math.abs(
          homeScore - awayScore
        );

      resultText =
        `${winner} par ${spread}`;

      if (
        pick.picked_team !==
        winner
      ) {
        pointsText = "0 point";
      } else if (
        Number(
          pick.predicted_spread
        ) === spread
      ) {
        pointsText = "2 points";
      } else {
        pointsText = "1 point";
      }
    }
  }

  /*
   * Pendant le LIVE seulement,
   * on peut montrer l'écart actuel
   * dans Ton choix.
   *
   * Ce n'est PAS un résultat officiel.
   */
  let currentSpreadText = null;

  if (
    isLive &&
    !hasOfficialScore &&
    displayedScore
  ) {
    const awayScore =
      Number(
        displayedScore.awayScore
      );

    const homeScore =
      Number(
        displayedScore.homeScore
      );

    if (awayScore === homeScore) {
      currentSpreadText =
        "Match à égalité";
    } else {
      const currentWinner =
        homeScore > awayScore
          ? game.home_team
          : game.away_team;

      const currentSpread =
        Math.abs(
          homeScore - awayScore
        );

      currentSpreadText =
        `${currentWinner} par ${currentSpread}`;
    }
  }

  /*
   * Match ESPN terminé mais
   * pas encore officialisé :
   *
   * on peut afficher le résultat
   * final temporaire, mais PAS
   * attribuer de couleur ou de points.
   */
  let temporaryFinalText = null;

  if (
    isEspnFinal &&
    !hasOfficialScore &&
    displayedScore
  ) {
    const awayScore =
      Number(
        displayedScore.awayScore
      );

    const homeScore =
      Number(
        displayedScore.homeScore
      );

    if (awayScore === homeScore) {
      temporaryFinalText =
        "Égalité";
    } else {
      const temporaryWinner =
        homeScore > awayScore
          ? game.home_team
          : game.away_team;

      const temporarySpread =
        Math.abs(
          homeScore - awayScore
        );

      temporaryFinalText =
        `${temporaryWinner} par ${temporarySpread}`;
    }
  }

  return (
    <div
      style={{
        padding: isMobile
          ? "18px 0"
          : "20px 0",
        borderBottom:
          "1px solid rgba(148,163,184,0.12)",
      }}
    >
      {/* ================= STATUT / DATE ================= */}

      <GameTimeBar
        gameDate={game.game_date}
        isLive={isLive}
        isEspnFinal={
          isEspnFinal
        }
        hasOfficialScore={
          hasOfficialScore
        }
      />

      {/* ================= MATCH ================= */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            isMobile
              ? "minmax(0,1fr) auto minmax(0,1fr)"
              : "minmax(0,1fr) 130px minmax(0,1fr) minmax(210px,0.9fr)",
          gap: isMobile
            ? 8
            : 18,
          alignItems: "center",
          marginTop: 14,
        }}
      >
        {/* ================= VISITEUR ================= */}

        <div
          style={{
            textAlign: "center",
            minWidth: 0,
          }}
        >
          <TeamLogo
            logo={getTeamLogo(
              game.away_team
            )}
            name={
              game.away_team
            }
            size={
              isMobile
                ? 62
                : 82
            }
            plain={true}
          />

          <strong
            style={{
              display: "block",
              marginTop: 5,
              color: "#f8fafc",
              fontSize:
                isMobile
                  ? 12
                  : 15,
              lineHeight: 1.15,
            }}
          >
            {game.away_team}
          </strong>

          <span
            style={{
              display: "block",
              marginTop: 3,
              color: "#94a3b8",
              fontSize:
                isMobile
                  ? 9
                  : 11,
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {formatTeamRecord(
              game.away_team
            )}
          </span>
        </div>

        {/* ================= SCORE ================= */}

        <div
          style={{
            textAlign: "center",
            minWidth:
              isMobile
                ? 72
                : 110,
          }}
        >
          {displayedScore ? (
            <>
              <strong
                style={{
                  display: "block",
                  color: "#f8fafc",
                  fontSize:
                    isMobile
                      ? 22
                      : 31,
                  fontWeight: 900,
                  whiteSpace:
                    "nowrap",
                }}
              >
                {
                  displayedScore.awayScore
                }{" "}
                -{" "}
                {
                  displayedScore.homeScore
                }
              </strong>

              {isLive &&
              !hasOfficialScore ? (
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    color: "#cbd5e1",
                    fontSize: 10,
                    fontWeight: 800,
                    whiteSpace:
                      "nowrap",
                  }}
                >
                  {getQuarterLabel(
                    liveGame?.status
                      ?.period
                  )}

                  {liveGame?.status
                    ?.clock
                    ? ` · ${liveGame.status.clock}`
                    : ""}
                </span>
              ) : (
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    color: "#94a3b8",
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing:
                      "0.7px",
                  }}
                >
                  FINAL
                </span>
              )}
            </>
          ) : (
            <strong
              style={{
                color: "#64748b",
                fontSize: 22,
              }}
            >
              @
            </strong>
          )}
        </div>

        {/* ================= DOMICILE ================= */}

        <div
          style={{
            textAlign: "center",
            minWidth: 0,
          }}
        >
          <TeamLogo
            logo={getTeamLogo(
              game.home_team
            )}
            name={
              game.home_team
            }
            size={
              isMobile
                ? 62
                : 82
            }
            plain={true}
          />

          <strong
            style={{
              display: "block",
              marginTop: 5,
              color: "#f8fafc",
              fontSize:
                isMobile
                  ? 12
                  : 15,
              lineHeight: 1.15,
            }}
          >
            {game.home_team}
          </strong>

          <span
            style={{
              display: "block",
              marginTop: 3,
              color: "#94a3b8",
              fontSize:
                isMobile
                  ? 9
                  : 11,
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {formatTeamRecord(
              game.home_team
            )}
          </span>
        </div>

        {/* ================= TON CHOIX ================= */}

        <div
          style={{
            gridColumn:
              isMobile
                ? "1 / -1"
                : "auto",
            marginTop:
              isMobile
                ? 8
                : 0,
            padding:
              isMobile
                ? "11px 13px"
                : "14px 16px",
            borderRadius: 14,
            background:
              "rgba(30,41,59,0.72)",
            border:
              "1px solid rgba(148,163,184,0.13)",
          }}
        >
          <span
            style={{
              display: "block",
              color: "#4ade80",
              fontSize: 10,
              fontWeight: 900,
              letterSpacing:
                "0.5px",
              textTransform:
                "uppercase",
            }}
          >
            Ton choix
          </span>

          {/* Choix + badge sur la même ligne */}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 5,
              minWidth: 0,
            }}
          >
            <strong
              style={{
                color: "#f8fafc",
                fontSize:
                  isMobile
                    ? 14
                    : 16,
                lineHeight: 1.2,
              }}
            >
              {pick.picked_team} par{" "}
              {pick.predicted_spread}
            </strong>

            <span
              style={{
                fontSize: 18,
                marginLeft: "auto",
                flexShrink: 0,
              }}
            >
              {badge}
            </span>
          </div>

          {/* LIVE : écart actuel */}

          {currentSpreadText && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop:
                  "1px solid rgba(148,163,184,0.10)",
                color: "#94a3b8",
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              Écart actuel :{" "}
              <strong
                style={{
                  color: "#cbd5e1",
                }}
              >
                {currentSpreadText}
              </strong>
            </div>
          )}

          {/* TERMINÉ ESPN MAIS PAS ENCORE OFFICIEL */}

          {temporaryFinalText && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop:
                  "1px solid rgba(148,163,184,0.10)",
                color: "#94a3b8",
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              Résultat :{" "}
              <strong
                style={{
                  color: "#cbd5e1",
                }}
              >
                {temporaryFinalText}
              </strong>
            </div>
          )}

           {/* OFFICIEL SUPABASE */}

          {hasOfficialScore && resultText && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop:
                  "1px solid rgba(148,163,184,0.10)",
                color: "#94a3b8",
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "nowrap",
                }}
              >
                <span
                  style={{
                    whiteSpace: "nowrap",
                  }}
                >
                  Résultat :{" "}
                  <strong
                    style={{
                      color: "#cbd5e1",
                    }}
                  >
                    {resultText}
                  </strong>
                </span>

                {pointsText && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "4px 8px",
                      borderRadius: 999,
                      background:
                        "rgba(148,163,184,0.10)",
                      color: "#f8fafc",
                      fontSize: 10,
                      fontWeight: 900,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {pointsText}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function Matchs() {
  const [
    user,
    setUser,
  ] = useState(null);

  const [
    currentWeek,
    setCurrentWeek,
  ] = useState(null);

  /*
   * Matchs DU POOL seulement.
   */
  const [
    games,
    setGames,
  ] = useState([]);

  /*
   * TOUS les matchs NFL de la semaine.
   *
   * Sert entre autres à savoir
   * quelles équipes sont en bye.
   */
  const [
    allWeekGames,
    setAllWeekGames,
  ] = useState([]);

  const [
    teams,
    setTeams,
  ] = useState([]);

  const [
    qbs,
    setQbs,
  ] = useState([]);

  const [
    availableQbs,
    setAvailableQbs,
  ] = useState([]);

  const [
    selectedQbId,
    setSelectedQbId,
  ] = useState("");

  const [
    qbMenuOpen,
    setQbMenuOpen,
  ] = useState(false);

  const [
    existingQbPick,
    setExistingQbPick,
  ] = useState(null);

  const [
    qbRating,
    setQbRating,
  ] = useState(null);

  const [
    savedPicks,
    setSavedPicks,
  ] = useState({});

  const [
    draftPicks,
    setDraftPicks,
  ] = useState({});

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    qbSeasonAverages,
    setQbSeasonAverages,
  ] = useState({});

  const [
    isMobile,
    setIsMobile,
  ] = useState(false);

  const [
    selectionOrder,
    setSelectionOrder,
  ] = useState([]);

  /*
   * Données ESPN temporaires.
   *
   * Jamais écrites dans Supabase.
   */
  const [
    liveGames,
    setLiveGames,
  ] = useState({});

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
    const updateMobile = () => {
      setIsMobile(
        window.innerWidth < 700
      );
    };

    updateMobile();

    window.addEventListener(
      "resize",
      updateMobile
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateMobile
      );
    };
  }, []);

  /* =========================================================
     CHARGEMENT PRINCIPAL
     ========================================================= */

  async function loadData() {
    const {
      data: sessionData,
    } =
      await supabase.auth.getSession();

    const currentUser =
      sessionData.session?.user ??
      null;

    setUser(currentUser);

    /* ================= SEMAINE ================= */

    const {
      data: settingsData,
    } =
      await supabase
        .from("settings")
        .select("*")
        .single();

    const week =
      Number(
        settingsData?.current_week
      ) || 1;

    setCurrentWeek(week);

    /* ================= ÉQUIPES ================= */

    const {
      data: teamsData,
    } =
      await supabase
        .from("teams")
        .select("*");

    setTeams(
      teamsData || []
    );

    /* =========================================================
       TOUS LES MATCHS NFL DE LA SEMAINE
       ========================================================= */

    const {
      data: allWeekGamesData,
      error: allWeekGamesError,
    } =
      await supabase
        .from("games")
        .select("*")
        .eq(
          "week",
          week
        )
        .order(
          "game_date",
          {
            ascending: true,
          }
        );

    if (allWeekGamesError) {
      console.error(
        "Erreur chargement horaire NFL :",
        allWeekGamesError.message
      );
    }

    const weekSchedule =
      allWeekGamesData || [];

    setAllWeekGames(
      weekSchedule
    );

    /*
     * L'interface Mes choix continue
     * d'afficher seulement les matchs
     * admissibles au pool.
     */
    const poolGames =
      weekSchedule.filter(
        (game) =>
          game.is_pool_eligible ===
          true
      );

    setGames(
      poolGames
    );

    /* ================= QB ACTIFS ================= */

    const {
      data: qbsData,
    } =
      await supabase
        .from("qbs")
        .select("*")
        .eq(
          "active",
          true
        )
        .eq(
          "is_active_starter",
          true
        )
        .order(
          "name",
          {
            ascending: true,
          }
        );

    setQbs(
      qbsData || []
    );

    if (!currentUser) {
      return;
    }

    /* =========================================================
       ORDRE DE SÉLECTION QB
       ========================================================= */

    const {
      data: playersData,
      error: playersError,
    } =
      await supabase
        .from("users")
        .select(
          "id, email, display_name, real_name"
        );

    if (playersError) {
      console.error(
        "Erreur chargement joueurs :",
        playersError.message
      );
    }

    const players =
      playersData || [];

    const {
      data: currentWeekQbPicks,
      error: orderQbError,
    } =
      await supabase
        .from("qb_picks")
        .select(
          "user_id"
        )
        .eq(
          "week",
          week
        );

    if (orderQbError) {
      console.error(
        "Erreur chargement QB picks pour l'ordre :",
        orderQbError.message
      );
    }

    /*
     * Actuellement, le QB pick sert
     * de marqueur de soumission.
     *
     * Comme QB + matchs sont soumis
     * ensemble dans cette page,
     * le joueur disparaît ensuite
     * de l'ordre restant.
     */
    const alreadyPickedIds =
      new Set(
        (
          currentWeekQbPicks ||
          []
        ).map(
          (row) =>
            row.user_id
        )
      );

    let fullOrder = [];

    if (
      Number(week) === 1
    ) {
      fullOrder =
        getWeek1Order(
          players
        );
    } else {
      const {
        data: previousScores,
        error: scoreError,
      } =
        await supabase
          .from(
            "weekly_scores"
          )
          .select("*")
          .eq(
            "week",
            Number(week) - 1
          );

      if (scoreError) {
        console.error(
          "Erreur chargement scores précédents :",
          scoreError.message
        );
      }

      const scoreByUser =
        {};

      (
        previousScores || []
      ).forEach(
        (row) => {
          scoreByUser[
            row.user_id
          ] =
            getWeeklyScoreValue(
              row
            );
        }
      );

      fullOrder =
        [...players].sort(
          (a, b) => {
            const scoreA =
              scoreByUser[
                a.id
              ];

            const scoreB =
              scoreByUser[
                b.id
              ];

            /*
             * Les joueurs sans score
             * sont placés après ceux
             * qui possèdent un score.
             */
            if (
              scoreA == null &&
              scoreB == null
            ) {
              return playerRealName(
                a
              ).localeCompare(
                playerRealName(
                  b
                ),
                "fr"
              );
            }

            if (
              scoreA == null
            ) {
              return 1;
            }

            if (
              scoreB == null
            ) {
              return -1;
            }

            /*
             * Inverse du classement :
             * plus petit score = premier.
             */
            if (
              scoreA !== scoreB
            ) {
              return (
                scoreA -
                scoreB
              );
            }

            return playerRealName(
              a
            ).localeCompare(
              playerRealName(
                b
              ),
              "fr"
            );
          }
        );
    }

    const remainingOrder =
      fullOrder.filter(
        (player) =>
          !alreadyPickedIds.has(
            player.id
          )
      );

    setSelectionOrder(
      remainingOrder
    );

    /* =========================================================
       CHOIX DE MATCHS DU JOUEUR
       ========================================================= */

    const {
      data: picksData,
      error: picksError,
    } =
      await supabase
        .from("picks")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        );

    if (picksError) {
      console.error(
        "Erreur chargement choix :",
        picksError.message
      );
    }

    const picksByGame =
      {};

    (
      picksData || []
    ).forEach(
      (pick) => {
        picksByGame[
          pick.game_id
        ] = pick;
      }
    );

    setSavedPicks(
      picksByGame
    );

    /* =========================================================
       QB DÉJÀ SOUMIS CETTE SEMAINE
       ========================================================= */

    const {
      data:
        existingQbPickData,
      error:
        existingQbPickError,
    } =
      await supabase
        .from(
          "qb_picks"
        )
        .select(`
          *,
          qbs (
            id,
            name,
            team,
            logo,
            espn_athlete_id
          )
        `)
        .eq(
          "user_id",
          currentUser.id
        )
        .eq(
          "week",
          week
        )
        .maybeSingle();

    if (
      existingQbPickError
    ) {
      console.error(
        "Erreur chargement QB soumis :",
        existingQbPickError.message
      );
    }

    setExistingQbPick(
      existingQbPickData ||
        null
    );

    /* =========================================================
       RATING OFFICIEL DU QB
       ========================================================= */

    let officialRating =
      null;

    if (
      existingQbPickData
        ?.qb_id
    ) {
      const {
        data: ratingData,
        error: ratingError,
      } =
        await supabase
          .from(
            "qb_ratings"
          )
          .select("*")
          .eq(
            "week",
            week
          )
          .eq(
            "qb_id",
            existingQbPickData
              .qb_id
          )
          .maybeSingle();

      if (
        ratingError
      ) {
        console.error(
          "Erreur chargement rating QB :",
          ratingError.message
        );
      }

      officialRating =
        ratingData ||
        null;
    }

    setQbRating(
      officialRating
    );

    /* =========================================================
       MOYENNES SAISON QB
       ========================================================= */

    const {
      data:
        allRatingsData,
      error:
        allRatingsError,
    } =
      await supabase
        .from(
          "qb_ratings"
        )
        .select(`
          *,
          qbs (
            espn_athlete_id
          )
        `);

    if (
      allRatingsError
    ) {
      console.error(
        "Erreur chargement moyennes QB :",
        allRatingsError.message
      );
    }

    const ratingsByQb =
      {};

    (
      allRatingsData || []
    ).forEach(
      (row) => {
        const athleteId =
          row
            .actual_espn_athlete_id ||
          row
            .qbs
            ?.espn_athlete_id;

        if (
          !athleteId ||
          row
            .passer_rating ==
            null
        ) {
          return;
        }

        const key =
          String(
            athleteId
          );

        if (
          !ratingsByQb[
            key
          ]
        ) {
          ratingsByQb[
            key
          ] = [];
        }

        ratingsByQb[
          key
        ].push(
          Number(
            row
              .passer_rating
          )
        );
      }
    );

    const averages =
      {};

    Object.entries(
      ratingsByQb
    ).forEach(
      ([
        athleteId,
        values,
      ]) => {
        if (
          values.length ===
          0
        ) {
          return;
        }

        averages[
          athleteId
        ] =
          values.reduce(
            (
              total,
              value
            ) =>
              total +
              value,
            0
          ) /
          values.length;
      }
    );

    setQbSeasonAverages(
      averages
    );

    /* =========================================================
       QB DÉJÀ PRIS CETTE SEMAINE
       ========================================================= */

    const {
      data:
        takenQbsData,
      error:
        takenQbsError,
    } =
      await supabase
        .from(
          "qb_picks"
        )
        .select(
          "qb_id"
        )
        .eq(
          "week",
          week
        );

    if (
      takenQbsError
    ) {
      console.error(
        "Erreur chargement QB pris :",
        takenQbsError.message
      );
    }

    const takenQbIds =
      new Set(
        (
          takenQbsData ||
          []
        ).map(
          (row) =>
            row.qb_id
        )
      );

    /* =========================================================
       QB DÉJÀ UTILISÉS PAR CE JOUEUR
       ========================================================= */

    const {
      data:
        qbHistoryData,
      error:
        qbHistoryError,
    } =
      await supabase
        .from(
          "qb_history"
        )
        .select(
          "qb_id"
        )
        .eq(
          "user_id",
          currentUser.id
        );

    if (
      qbHistoryError
    ) {
      console.error(
        "Erreur historique QB :",
        qbHistoryError.message
      );
    }

    const usedQbIds =
      new Set(
        (
          qbHistoryData ||
          []
        ).map(
          (row) =>
            row.qb_id
        )
      );

    /* =========================================================
       ÉQUIPES QUI JOUENT CETTE SEMAINE
       ========================================================= */

    const playingTeams =
      new Set();

    weekSchedule.forEach(
      (game) => {
        if (
          game.home_team
        ) {
          playingTeams.add(
            normalizeName(
              game.home_team
            )
          );
        }

        if (
          game.away_team
        ) {
          playingTeams.add(
            normalizeName(
              game.away_team
            )
          );
        }
      }
    );

    /* =========================================================
       QB DISPONIBLES
       ========================================================= */

    const filteredQbs =
      (
        qbsData ||
        []
      ).filter(
        (qb) => {
          const teamIsPlaying =
            playingTeams.has(
              normalizeName(
                qb.team
              )
            );

          const alreadyTaken =
            takenQbIds.has(
              qb.id
            );

          const alreadyUsed =
            usedQbIds.has(
              qb.id
            );

          return (
            teamIsPlaying &&
            !alreadyTaken &&
            !alreadyUsed
          );
        }
      );

    setAvailableQbs(
      filteredQbs
    );
  }
     useEffect(() => {
    loadData();
  }, []);

  /* =========================================================
     ESPN TEMPORAIRE — LIVE + POST
     ========================================================= */

  useEffect(() => {
    if (
      currentWeek == null ||
      games.length === 0
    ) {
      setLiveGames({});
      return;
    }

    let cancelled =
      false;

    async function refreshLive() {
      const eligibleGames =
        games.filter(
          (game) =>
            game.external_game_id
        );

      if (
        eligibleGames.length ===
        0
      ) {
        return;
      }

      const results =
        {};

      await Promise.all(
        eligibleGames.map(
          async (game) => {
            try {
              const response =
                await fetch(
                  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.external_game_id}`,
                  {
                    cache:
                      "no-store",
                  }
                );

              if (
                !response.ok
              ) {
                return;
              }

              const summary =
                await response.json();

              const status =
                getLiveGameStatus(
                  summary
                );

              /*
               * On garde seulement :
               *
               * in   = match en cours
               * post = match terminé
               *
               * Le pré-match reste géré
               * avec game_date.
               */
              if (
                status.state !==
                  "in" &&
                status.state !==
                  "post"
              ) {
                return;
              }

              const score =
                getLiveScore(
                  summary
                );

              if (!score) {
                return;
              }

              const competition =
                summary?.header
                  ?.competitions?.[0];

              const competitors =
                competition
                  ?.competitors ||
                [];

              const teamNames =
                competitors
                  .flatMap(
                    (team) => [
                      team?.team
                        ?.abbreviation,
                      team?.team
                        ?.shortDisplayName,
                      team?.team
                        ?.displayName,
                      team?.team
                        ?.name,
                    ]
                  )
                  .filter(Boolean)
                  .map(
                    (value) =>
                      String(
                        value
                      )
                        .toLowerCase()
                        .trim()
                  );

              results[
                game.id
              ] = {
                gameId:
                  game.id,

                status,

                score,

                teamNames,

                passers:
                  getLivePassers(
                    summary
                  ),
              };
            } catch (
              error
            ) {
              console.error(
                `Erreur ESPN match ${game.external_game_id}:`,
                error
              );
            }
          }
        )
      );

      /*
       * On fusionne avec le dernier
       * état connu.
       *
       * Une erreur ESPN temporaire
       * ne fait donc pas disparaître
       * immédiatement le score.
       */
      if (!cancelled) {
        setLiveGames(
          (previous) => ({
            ...previous,
            ...results,
          })
        );
      }
    }

    refreshLive();

    const interval =
      window.setInterval(
        refreshLive,
        30000
      );

    return () => {
      cancelled = true;

      window.clearInterval(
        interval
      );
    };
  }, [
    games,
    currentWeek,
  ]);

  /* =========================================================
     ÉQUIPES
     ========================================================= */

  const getTeamLogo = (
    teamName
  ) => {
    const team =
      teams.find(
        (t) =>
          t.name
            ?.toLowerCase()
            .trim() ===
          teamName
            ?.toLowerCase()
            .trim()
      );

    return team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo ||
          null;
  };

  const getTeamInfo = (
    teamName
  ) => {
    return teams.find(
      (t) =>
        t.name
          ?.toLowerCase()
          .trim() ===
        teamName
          ?.toLowerCase()
          .trim()
    );
  };

  const translateDivision = (
    division
  ) => {
    if (!division) {
      return "";
    }

    const value =
      String(
        division
      )
        .trim()
        .toUpperCase();

    const map = {
      "AFC EAST":
        "AFC Est",

      "AFC NORTH":
        "AFC Nord",

      "AFC SOUTH":
        "AFC Sud",

      "AFC WEST":
        "AFC Ouest",

      "NFC EAST":
        "NFC Est",

      "NFC NORTH":
        "NFC Nord",

      "NFC SOUTH":
        "NFC Sud",

      "NFC WEST":
        "NFC Ouest",
    };

    return (
      map[value] ||
      division
    );
  };

  const formatDivisionRank = (
    rank
  ) => {
    const value =
      Number(rank);

    if (!value) {
      return "";
    }

    return value === 1
      ? "1er"
      : `${value}e`;
  };

  const formatTeamRecord = (
    teamName
  ) => {
    const team =
      getTeamInfo(
        teamName
      );

    if (!team) {
      return "";
    }

    const wins =
      Number(
        team.wins || 0
      );

    const losses =
      Number(
        team.losses || 0
      );

    const ties =
      Number(
        team.ties || 0
      );

    const record =
      ties > 0
        ? `${wins}-${losses}-${ties}`
        : `${wins}-${losses}`;

    const division =
      translateDivision(
        team.division_name
      );

    const gamesPlayed =
      wins +
      losses +
      ties;

    if (
      gamesPlayed === 0
    ) {
      return division
        ? `${record} • ${division}`
        : record;
    }

    const rank =
      formatDivisionRank(
        team.division_rank
      );

    if (
      rank &&
      division
    ) {
      return `${record} • ${rank} ${division}`;
    }

    if (division) {
      return `${record} • ${division}`;
    }

    return record;
  };

  /* =========================================================
     QB AFFICHÉ
     ========================================================= */

  const selectedQb =
    qbs.find(
      (qb) =>
        qb.id ===
        selectedQbId
    );

  /*
   * Données ESPN temporaires du
   * QB choisi.
   *
   * L'officiel Supabase conserve
   * toujours la priorité.
   */
  const liveQbData =
    existingQbPick
      ? findQbGameData(
          existingQbPick,
          liveGames,
          true
        )
      : null;

  const livePasser =
    liveQbData?.passer ||
    null;

  const hasOfficialQbRating =
    qbRating?.passer_rating !=
    null;

  const displayedQb =
    hasOfficialQbRating &&
    qbRating
      ?.actual_espn_athlete_id
      ? {
          name:
            qbRating.actual_qb_name ||
            existingQbPick?.qbs
              ?.name,

          team:
            existingQbPick?.qbs
              ?.team,

          espn_athlete_id:
            qbRating
              .actual_espn_athlete_id,
        }
      : livePasser
          ?.athleteId
      ? {
          name:
            livePasser.name ||
            existingQbPick
              ?.qbs?.name,

          team:
            existingQbPick
              ?.qbs?.team,

          espn_athlete_id:
            livePasser
              .athleteId,
        }
      : existingQbPick
          ?.qbs;

  const displayedQbRating =
    hasOfficialQbRating
      ? Number(
          qbRating
            .passer_rating
        )
      : livePasser?.rating !=
        null
      ? Number(
          livePasser.rating
        )
      : null;

  const displayedQbAverage =
    qbSeasonAverages[
      String(
        hasOfficialQbRating
          ? qbRating
              ?.actual_espn_athlete_id ||
              existingQbPick
                ?.qbs
                ?.espn_athlete_id
          : livePasser
              ?.athleteId ||
              existingQbPick
                ?.qbs
                ?.espn_athlete_id
      )
    ];

  /*
   * CORRECTION DU CRASH :
   *
   * C'est CETTE variable qui doit
   * être utilisée plus bas dans
   * le rendu.
   *
   * On ne doit plus avoir :
   * qbDisplayData?.replaced
   */
  const qbWasReplaced =
    displayedQb
      ?.espn_athlete_id &&
    existingQbPick
      ?.qbs
      ?.espn_athlete_id &&
    String(
      displayedQb
        .espn_athlete_id
    ) !==
      String(
        existingQbPick
          .qbs
          .espn_athlete_id
      );
  const qbNextGame =
    displayedQb?.team
      ? allWeekGames.find(
          (game) =>
            normalizeName(game.home_team) ===
              normalizeName(displayedQb.team) ||
            normalizeName(game.away_team) ===
              normalizeName(displayedQb.team)
        )
      : null;

  const qbOpponent =
    qbNextGame
      ? normalizeName(qbNextGame.home_team) ===
        normalizeName(displayedQb?.team)
        ? qbNextGame.away_team
        : qbNextGame.home_team
      : null;

  const qbIsHome =
    qbNextGame &&
    normalizeName(qbNextGame.home_team) ===
      normalizeName(displayedQb?.team);
  /* =========================================================
     DRAFT PICKS
     ========================================================= */

  const updateDraftPick = (
    gameId,
    field,
    value
  ) => {
    setDraftPicks(
      (prev) => ({
        ...prev,

        [gameId]: {
          ...prev[
            gameId
          ],

          [field]:
            value,
        },
      })
    );
  };
     /* =========================================================
     SOUMISSION
     ========================================================= */

  const submitEverything =
    async () => {
      if (!user) {
        setMessage(
          "Connecte-toi avant de soumettre."
        );

        return;
      }

      const gamesToPick =
        games.filter(
          (game) =>
            !savedPicks[
              game.id
            ]
        );

      if (
        !existingQbPick &&
        !selectedQbId
      ) {
        setMessage(
          "Choisis un QB avant de soumettre."
        );

        return;
      }

      /*
       * Tous les matchs doivent être
       * complétés avant la soumission.
       */
      for (
        const game of
        gamesToPick
      ) {
        const pick =
          draftPicks[
            game.id
          ];

        if (
          !pick
            ?.picked_team ||
          pick
            .predicted_spread ===
            undefined ||
          pick
            .predicted_spread ===
            ""
        ) {
          setMessage(
            "Complète tous les matchs avant de soumettre."
          );

          return;
        }
      }

      const confirmation =
        window.confirm(
          "Confirmer la soumission? Le choix de QB est irréversible."
        );

      if (
        !confirmation
      ) {
        return;
      }

      /*
       * QB
       */
      if (
        !existingQbPick
      ) {
        const {
          error: qbError,
        } =
          await supabase
            .from(
              "qb_picks"
            )
            .insert({
              user_id:
                user.id,

              week:
                currentWeek,

              qb_id:
                selectedQbId,
            });

        if (qbError) {
          setMessage(
            "Erreur QB : " +
              qbError.message
          );

          return;
        }

        const {
          error:
            historyError,
        } =
          await supabase
            .from(
              "qb_history"
            )
            .insert({
              user_id:
                user.id,

              qb_id:
                selectedQbId,
            });

        if (
          historyError
        ) {
          console.error(
            "Erreur historique QB :",
            historyError.message
          );
        }
      }

      /*
       * PICKS
       */
      const pickRows =
        gamesToPick.map(
          (game) => ({
            user_id:
              user.id,

            game_id:
              game.id,

            picked_team:
              draftPicks[
                game.id
              ].picked_team,

            predicted_spread:
              Number(
                draftPicks[
                  game.id
                ]
                  .predicted_spread
              ),

            updated_at:
              new Date()
                .toISOString(),
          })
        );

      if (
        pickRows.length >
        0
      ) {
        const {
          error:
            picksError,
        } =
          await supabase
            .from(
              "picks"
            )
            .upsert(
              pickRows,
              {
                onConflict:
                  "user_id,game_id",
              }
            );

        if (
          picksError
        ) {
          setMessage(
            "Erreur choix : " +
              picksError.message
          );

          return;
        }
      }

      setMessage(
        "Choix soumis ✅"
      );

      await loadData();
    };

  const gamesToPick =
    games.filter(
      (game) =>
        !savedPicks[
          game.id
        ]
    );

  const submittedGames =
    games.filter(
      (game) =>
        savedPicks[
          game.id
        ]
    );

  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <main className="page">
      <section className="header-card">
        <h1>Mes choix ✅</h1>

        <p>
          Semaine {currentWeek || "..."}
        </p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {/* ================= ORDRE QB ================= */}

      {selectionOrder.length > 0 && (
        <SelectionOrderBar
          players={selectionOrder}
          currentUserId={user?.id}
          currentWeek={currentWeek}
        />
      )}

      {/* ================= QB ================= */}

      <section className="card">
       {existingQbPick ? (
  <>
    <h2
      style={{
        color: "#22c55e",
        marginTop: 0,
        marginBottom: 24,
      }}
    >
      QB soumis ✅
    </h2>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? "1fr"
          : "minmax(0, 1fr) minmax(320px, 0.9fr)",
        gap: isMobile ? 22 : 32,
        alignItems: "center",
      }}
    >
      {/* =====================================================
          GAUCHE — QB
          ===================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "105px minmax(0, 1fr)"
            : "150px minmax(0, 1fr)",
          gap: isMobile ? 12 : 18,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <QBPhoto
          qb={displayedQb}
          mobile={isMobile}
        />

        <div
          style={{
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#f8fafc",
              fontSize: isMobile ? 21 : 30,
              lineHeight: 1.1,
            }}
          >
            {displayedQb?.name}
          </h2>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              marginBottom: 8,
            }}
          >
            <TeamLogo
              logo={getTeamLogo(
                displayedQb?.team
              )}
              name={displayedQb?.team}
              size={isMobile ? 30 : 38}
              plain={true}
            />

            <strong
              style={{
                color: "#94a3b8",
                fontSize: isMobile ? 14 : 18,
              }}
            >
              {displayedQb?.team}
            </strong>
          </div>

          {qbWasReplaced && (
            <p
              style={{
                margin: "6px 0",
                color: "#facc15",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              🔄 QB utilisé automatiquement
            </p>
          )}

          {displayedQbRating != null ? (
            <p
              style={{
                marginTop: 16,
                marginBottom: 0,
                fontSize: isMobile ? 15 : 19,
                lineHeight: 1.5,
                color: "#94a3b8",
              }}
            >
              Passer Rating :{" "}
              <strong
                style={{
                  color: ratingColor(
                    displayedQbRating
                  ),
                }}
              >
                {Number(
                  displayedQbRating
                ).toFixed(1)}
              </strong>

              {!isMobile && " — "}

              {isMobile && <br />}

              Moyenne saison :{" "}
              <strong
                style={{
                  color: "#cbd5e1",
                }}
              >
                {displayedQbAverage != null
                  ? displayedQbAverage.toFixed(1)
                  : "--"}
              </strong>
            </p>
          ) : (
            <p
              style={{
                marginTop: 16,
                marginBottom: 0,
                color: "#94a3b8",
                fontSize: isMobile ? 14 : 18,
              }}
            >
              Moyenne saison :{" "}
              <strong
                style={{
                  color: "#cbd5e1",
                }}
              >
                {displayedQbAverage != null
                  ? displayedQbAverage.toFixed(1)
                  : "--"}
              </strong>
            </p>
          )}
        </div>
      </div>

      {/* =====================================================
          DROITE — PROCHAIN MATCH
          ===================================================== */}

      {qbNextGame && qbOpponent ? (
        <div
          style={{
            width: "100%",
            padding: isMobile
              ? "16px 18px"
              : "20px 24px",
            borderRadius: 18,
            background:
              "rgba(30,41,59,0.72)",
            border:
              "1px solid rgba(148,163,184,0.18)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              color: "#94a3b8",
              fontSize: isMobile ? 11 : 13,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: 14,
            }}
          >
            Prochain match
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <img
              src={getTeamLogo(
                qbOpponent
              )}
              alt={qbOpponent}
              style={{
                width: isMobile ? 42 : 54,
                height: isMobile ? 42 : 54,
                objectFit: "contain",
                flexShrink: 0,
              }}
            />

            <strong
              style={{
                color: "#f8fafc",
                fontSize: isMobile ? 18 : 22,
                lineHeight: 1.2,
              }}
            >
              {qbIsHome ? "vs" : "@"}{" "}
              {qbOpponent}
            </strong>
          </div>

          <div
            style={{
              marginTop: 14,
              color: "#4ade80",
              fontSize: isMobile ? 13 : 15,
              fontWeight: 900,
            }}
          >
            {formatGameDate(
              qbNextGame.game_date
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            padding: isMobile
              ? "16px 18px"
              : "20px 24px",
            borderRadius: 18,
            background:
              "rgba(30,41,59,0.45)",
            border:
              "1px solid rgba(148,163,184,0.12)",
            color: "#64748b",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              fontSize: isMobile ? 11 : 13,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
            }}
          >
            Prochain match
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 14,
            }}
          >
            Aucun match cette semaine
          </div>
        </div>
      )}
    </div>
  </>
) : (
          <>
            <h2
              style={{
                color: "#22c55e",
              }}
            >
              1. Choisis ton QB
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "minmax(0, 1fr) 160px",
                gap: 18,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  position: "relative",
                  zIndex: qbMenuOpen
                    ? 100
                    : 1,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                  }}
                >
                  <button
                    type="button"
                    className="input"
                    onClick={() =>
                      setQbMenuOpen(
                        (prev) => !prev
                      )
                    }
                    style={{
                      width: "100%",
                      minWidth: 0,
                      height: isMobile
                        ? 58
                        : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        "space-between",
                      gap: 10,
                      cursor: "pointer",
                      textAlign: "left",
                      overflow: "hidden",
                      paddingLeft: isMobile
                        ? 14
                        : undefined,
                      paddingRight: isMobile
                        ? 14
                        : undefined,
                    }}
                  >
                    {selectedQb ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent:
                            "space-between",
                          gap: 10,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            overflow: "hidden",
                          }}
                        >
                          <strong
                            style={{
                              fontSize: isMobile
                                ? 15
                                : 16,
                              overflow: "hidden",
                              textOverflow:
                                "ellipsis",
                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            {selectedQb.name}
                          </strong>

                          <img
                            src={getTeamLogo(
                              selectedQb.team
                            )}
                            alt={selectedQb.team}
                            style={{
                              width: isMobile
                                ? 23
                                : 28,
                              height: isMobile
                                ? 23
                                : 28,
                              objectFit:
                                "contain",
                              flexShrink: 0,
                            }}
                          />
                        </div>

                        <span
                          style={{
                            color: "#94a3b8",
                            whiteSpace:
                              "nowrap",
                            flexShrink: 0,
                            fontSize: isMobile
                              ? 13
                              : 14,
                          }}
                        >
                          Moy.{" "}
                          {qbSeasonAverages[
                            String(
                              selectedQb.espn_athlete_id
                            )
                          ] != null
                            ? qbSeasonAverages[
                                String(
                                  selectedQb.espn_athlete_id
                                )
                              ].toFixed(1)
                            : "--"}
                        </span>
                      </div>
                    ) : (
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                          fontSize: isMobile
                            ? 15
                            : undefined,
                        }}
                      >
                        -- Sélectionner un QB --
                      </span>
                    )}

                    <span
                      style={{
                        marginLeft: 4,
                        flexShrink: 0,
                      }}
                    >
                      {qbMenuOpen
                        ? "▲"
                        : "▼"}
                    </span>
                  </button>
                  {qbMenuOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        zIndex: 9999,
                        maxHeight: isMobile
                          ? 310
                          : 360,
                        overflowY: "auto",
                        overflowX: "hidden",
                        borderRadius: 16,
                        background: "#0f172a",
                        border:
                          "1px solid rgba(148,163,184,0.22)",
                        boxShadow:
                          "0 18px 40px rgba(0,0,0,0.55)",
                      }}
                    >
                      {availableQbs.length ===
                        0 && (
                        <div
                          style={{
                            padding:
                              "16px 18px",
                            color: "#94a3b8",
                            fontSize: 14,
                          }}
                        >
                          Aucun QB disponible.
                        </div>
                      )}

                      {availableQbs.map(
                        (qb) => {
                          const average =
                            qbSeasonAverages[
                              String(
                                qb.espn_athlete_id
                              )
                            ];

                          return (
                            <button
                              key={qb.id}
                              type="button"
                              onClick={() => {
                                setSelectedQbId(
                                  qb.id
                                );

                                setQbMenuOpen(
                                  false
                                );
                              }}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                display: "flex",
                                alignItems:
                                  "center",
                                justifyContent:
                                  "space-between",
                                padding: isMobile
                                  ? "12px 14px"
                                  : "12px 18px",
                                gap: 12,
                                background:
                                  selectedQbId ===
                                  qb.id
                                    ? "rgba(34,197,94,0.12)"
                                    : "transparent",
                                border: "none",
                                borderBottom:
                                  "1px solid rgba(148,163,184,0.10)",
                                color: "#f8fafc",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems:
                                    "center",
                                  gap: 8,
                                  minWidth: 0,
                                  flex: 1,
                                  overflow:
                                    "hidden",
                                }}
                              >
                                <strong
                                  style={{
                                    minWidth: 0,
                                    fontSize:
                                      isMobile
                                        ? 14
                                        : 16,
                                    lineHeight:
                                      1.15,
                                    overflow:
                                      "hidden",
                                    textOverflow:
                                      "ellipsis",
                                    whiteSpace:
                                      "nowrap",
                                  }}
                                >
                                  {qb.name}
                                </strong>

                                <img
                                  src={getTeamLogo(
                                    qb.team
                                  )}
                                  alt={qb.team}
                                  style={{
                                    width:
                                      isMobile
                                        ? 22
                                        : 28,
                                    height:
                                      isMobile
                                        ? 22
                                        : 28,
                                    objectFit:
                                      "contain",
                                    flexShrink: 0,
                                  }}
                                />
                              </div>

                              <span
                                style={{
                                  color:
                                    "#94a3b8",
                                  whiteSpace:
                                    "nowrap",
                                  flexShrink: 0,
                                  fontSize:
                                    isMobile
                                      ? 12
                                      : 14,
                                }}
                              >
                                Moy.{" "}
                                {average != null
                                  ? average.toFixed(
                                      1
                                    )
                                  : "--"}
                              </span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>

                {!isMobile && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 14,
                      borderRadius: 18,
                      background:
                        "rgba(34,197,94,0.08)",
                      border:
                        "1px solid rgba(34,197,94,0.20)",
                      color: "#cbd5e1",
                      lineHeight: 1.45,
                    }}
                  >
                    ✅ Seuls les QB actifs
                    dont l'équipe joue cette
                    semaine sont affichés. Un
                    QB ne peut être choisi
                    qu'une seule fois par
                    semaine et ne peut pas être
                    réutilisé.
                  </div>
                )}
              </div>

              <div
                style={{
                  textAlign: "center",
                  display:
                    isMobile &&
                    !selectedQb
                      ? "none"
                      : "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selectedQb ? (
                  <QBPhoto
                    qb={selectedQb}
                    mobile={isMobile}
                  />
                ) : (
                  <div
                    style={{
                      color: "#94a3b8",
                    }}
                  >
                    Aucun QB
                  </div>
                )}

                {selectedQb && (
                  <p
                    style={{
                      marginTop: 8,
                      marginBottom: 0,
                      fontWeight: 800,
                    }}
                  >
                    {selectedQb.team}
                  </p>
                )}
              </div>

              {isMobile && (
                <div
                  style={{
                    marginTop: 0,
                    padding: 12,
                    borderRadius: 18,
                    background:
                      "rgba(34,197,94,0.08)",
                    border:
                      "1px solid rgba(34,197,94,0.20)",
                    color: "#cbd5e1",
                    fontSize: 14,
                    lineHeight: 1.45,
                  }}
                >
                  ✅ Seuls les QB actifs dont
                  l'équipe joue cette semaine
                  sont affichés. Un QB ne peut
                  être choisi qu'une seule fois
                  par semaine et ne peut pas être
                  réutilisé.
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ================= MATCHS À CHOISIR ================= */}

      {gamesToPick.length > 0 && (
        <section className="card">
          <h2
            style={{
              color: "#22c55e",
            }}
          >
            2. Choisis les matchs
          </h2>

          {gamesToPick.map((game) => {
            const pick =
              draftPicks[game.id] || {};

            const awaySelected =
              pick.picked_team ===
              game.away_team;

            const homeSelected =
              pick.picked_team ===
              game.home_team;

            return (
              <div
                key={game.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    isMobile
                      ? "minmax(0,1fr) 32px minmax(0,1fr) 64px"
                      : "1fr 70px 1fr 120px",
                  alignItems: "center",
                  gap: isMobile ? 6 : 12,
                  padding: "24px 0",
                  borderBottom:
                    "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <div
                  style={{
                    gridColumn: "1 / -1",
                  }}
                >
                  <GameTimeBar
                    gameDate={game.game_date}
                  />
                </div>

                {/* ÉQUIPE VISITEUSE */}

                <button
                  type="button"
                  onClick={() =>
                    updateDraftPick(
                      game.id,
                      "picked_team",
                      game.away_team
                    )
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    minWidth: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(
                      game.away_team
                    )}
                    alt={game.away_team}
                    style={{
                      width: isMobile
                        ? 62
                        : 96,
                      height: isMobile
                        ? 62
                        : 96,
                      maxWidth: "100%",
                      objectFit: "contain",
                      opacity: awaySelected
                        ? 1
                        : 0.82,
                      transform: awaySelected
                        ? "scale(1.08)"
                        : "scale(1)",
                      transition:
                        "0.2s ease",
                      filter: awaySelected
                        ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                        : "none",
                    }}
                  />

                  <strong
                    style={{
                      marginTop: 5,
                      color: "#f8fafc",
                      fontSize: isMobile
                        ? 12
                        : 14,
                      lineHeight: 1.1,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {game.away_team}
                  </strong>

                  <span
                    style={{
                      marginTop: 3,
                      color: "#94a3b8",
                      fontSize: isMobile
                        ? 10
                        : 12,
                      lineHeight: 1.15,
                      fontWeight: 700,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatTeamRecord(
                      game.away_team
                    )}
                  </span>
                </button>

                <div
                  style={{
                    textAlign: "center",
                    fontSize: isMobile
                      ? 22
                      : 34,
                    fontWeight: 900,
                    color: "#ffffff",
                  }}
                >
                  @
                </div>
                {/* ÉQUIPE DOMICILE */}

                <button
                  type="button"
                  onClick={() =>
                    updateDraftPick(
                      game.id,
                      "picked_team",
                      game.home_team
                    )
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    minWidth: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(
                      game.home_team
                    )}
                    alt={game.home_team}
                    style={{
                      width: isMobile
                        ? 62
                        : 96,
                      height: isMobile
                        ? 62
                        : 96,
                      maxWidth: "100%",
                      objectFit: "contain",
                      opacity: homeSelected
                        ? 1
                        : 0.82,
                      transform: homeSelected
                        ? "scale(1.08)"
                        : "scale(1)",
                      transition:
                        "0.2s ease",
                      filter: homeSelected
                        ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                        : "none",
                    }}
                  />

                  <strong
                    style={{
                      marginTop: 5,
                      color: "#f8fafc",
                      fontSize: isMobile
                        ? 12
                        : 14,
                      lineHeight: 1.1,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {game.home_team}
                  </strong>

                  <span
                    style={{
                      marginTop: 3,
                      color: "#94a3b8",
                      fontSize: isMobile
                        ? 10
                        : 12,
                      lineHeight: 1.15,
                      fontWeight: 700,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatTeamRecord(
                      game.home_team
                    )}
                  </span>
                </button>

                {/* ÉCART */}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: isMobile
                        ? 13
                        : 16,
                      lineHeight: 1.15,
                      color: "#cbd5e1",
                      textAlign: "center",
                    }}
                  >
                    Écart prédit
                  </span>

                  <input
                    type="number"
                    inputMode="numeric"
                    value={
                      pick.predicted_spread ??
                      ""
                    }
                    onChange={(e) =>
                      updateDraftPick(
                        game.id,
                        "predicted_spread",
                        e.target.value
                      )
                    }
                    style={{
                      width: isMobile
                        ? 50
                        : 72,
                      height: isMobile
                        ? 50
                        : 72,
                      borderRadius: 18,
                      border:
                        "2px solid rgba(148,163,184,0.18)",
                      background:
                        "rgba(2,6,23,0.75)",
                      color: "#ffffff",
                      fontSize: isMobile
                        ? 18
                        : 24,
                      fontWeight: 800,
                      textAlign: "center",
                      outline: "none",
                      appearance:
                        "textfield",
                      MozAppearance:
                        "textfield",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ================= SOUMISSION ================= */}

      {(gamesToPick.length > 0 ||
        !existingQbPick) && (
        <section className="card">
          <button
            className="button"
            onClick={submitEverything}
            style={{
              width: "100%",
              fontSize: isMobile
                ? 17
                : 20,
            }}
          >
            Soumettre mon QB et mes choix
          </button>

          <p
            style={{
              color: "#94a3b8",
            }}
          >
            🔒 Tu ne pourras plus modifier
            après la soumission.
          </p>
        </section>
      )}

      {/* ================= MATCHS SOUMIS ================= */}

      {submittedGames.length > 0 && (
        <section className="card">
          <h2
            style={{
              marginTop: 0,
              color: "#22c55e",
            }}
          >
            Tes choix de matchs ✅
          </h2>

          {submittedGames.map((game) => (
            <SubmittedGameCard
              key={game.id}
              game={game}
              pick={savedPicks[game.id]}
              liveGame={
                liveGames[game.id] || null
              }
              getTeamLogo={getTeamLogo}
              formatTeamRecord={
                formatTeamRecord
              }
              isMobile={isMobile}
            />
          ))}

          <p
            style={{
              marginBottom: 0,
              color: "#94a3b8",
            }}
          >
            🔒 Choix soumis pour la semaine{" "}
            {currentWeek}.
          </p>
        </section>
      )}

      <BottomNav />
    </main>
  );
}
