"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

/* =========================================================
   IDENTITÉ JOUEUR
   ========================================================= */

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "Joueur";
}

function realName(user) {
  return user?.real_name || "";
}

function PlayerIdentity({
  player,
  compact = false,
  align = "left",
}) {
  return (
    <div
      style={{
        minWidth: 0,
        textAlign: align,
      }}
    >
      <strong
        style={{
          display: "block",
          color: "#f8fafc",
          fontSize: compact ? 13 : 15,
          fontWeight: 900,
          lineHeight: 1.15,
          overflowWrap: "anywhere",
        }}
      >
        {displayName(player)}
      </strong>

      {realName(player) && (
        <span
          style={{
            display: "block",
            marginTop: 2,
            color: "#94a3b8",
            fontSize: compact ? 10 : 11,
            fontWeight: 500,
            lineHeight: 1.15,
            overflowWrap: "anywhere",
          }}
        >
          {realName(player)}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   QB
   ========================================================= */

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function QBPhoto({
  qb,
  size = 58,
}) {
  const [error, setError] = useState(false);

  const src = getQbHeadshot(qb);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 14,
          background: "rgba(148,163,184,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f8fafc",
          fontWeight: 900,
          flexShrink: 0,
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
        flexShrink: 0,
      }}
    />
  );
}

/* =========================================================
   LOGOS ÉQUIPES
   ========================================================= */

function TeamLogo({
  logo,
  name,
  size = 60,
}) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 14,
          background: "rgba(148,163,184,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f8fafc",
          fontWeight: 900,
          flexShrink: 0,
        }}
      >
        {name?.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={logo}
      alt={name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

/* =========================================================
   RATINGS
   ========================================================= */

function ratingColor(rating) {
  const value = Number(rating);

  if (value >= 100) return "#22c55e";
  if (value >= 90) return "#f8fafc";
  if (value >= 70) return "#f97316";

  return "#ef4444";
}

/* =========================================================
   RÉSULTAT PICK
   ========================================================= */

function getPickResult(game, pick) {
  /*
   * IMPORTANT :
   *
   * Cette fonction regarde SEULEMENT
   * les scores officiels Supabase.
   *
   * Un score ESPN temporaire, même FINAL,
   * ne donne donc jamais de couleur/points
   * avant la mise à jour Admin.
   */
  if (
    game.home_score == null ||
    game.away_score == null
  ) {
    return {
      badge: "⚪",
      points: null,
      label: "À jouer",
    };
  }

  if (
    Number(game.home_score) ===
    Number(game.away_score)
  ) {
    return {
      badge: "⚪",
      points: null,
      label: "Égalité",
    };
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
    return {
      badge: "🔴",
      points: 0,
      label: "0 pt",
    };
  }

  if (
    Number(pick.predicted_spread) ===
    Number(realSpread)
  ) {
    return {
      badge: "🟢",
      points: 2,
      label: "2 pts",
    };
  }

  return {
    badge: "🟡",
    points: 1,
    label: "1 pt",
  };
}

/* =========================================================
   DATE MATCH
   ========================================================= */

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

  const time = date.toLocaleTimeString(
    "fr-CA",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );

  return `${day} · ${time}`;
}

function GameTimeBar({
  gameDate,
}) {
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
      <span>🗓️</span>

      <span>
        {formatGameDate(gameDate)}
      </span>
    </div>
  );
}

/* =========================================================
   HELPERS ESPN LIVE / POST
   ========================================================= */

function getLiveGameStatus(summary) {
  const competition =
    summary?.header?.competitions?.[0];

  const status =
    competition?.status || null;

  return {
    state:
      status?.type?.state || "",

    completed:
      status?.type?.completed === true,

    period:
      Number(status?.period || 0),

    clock:
      status?.displayClock || "",

    detail:
      status?.type?.shortDetail ||
      status?.type?.detail ||
      "",
  };
}

function getLiveScore(summary) {
  const competition =
    summary?.header?.competitions?.[0];

  const competitors =
    competition?.competitors || [];

  const away =
    competitors.find(
      (team) =>
        team.homeAway === "away"
    );

  const home =
    competitors.find(
      (team) =>
        team.homeAway === "home"
    );

  if (!away || !home) {
    return null;
  }

  const awayScore =
    Number(away.score);

  const homeScore =
    Number(home.score);

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

  boxscoreTeams.forEach(
    (teamBox) => {
      const team =
        teamBox?.team || {};

      const teamNames = [
        team.abbreviation,
        team.shortDisplayName,
        team.displayName,
        team.name,
      ]
        .filter(Boolean)
        .map((value) =>
          String(value)
            .toLowerCase()
            .trim()
        );

      const passingCategory =
        teamBox.statistics?.find(
          (category) =>
            category.name ===
              "passing" ||
            category.displayName ===
              "Passing"
        );

      if (!passingCategory) {
        return;
      }

      const labels =
        passingCategory.labels || [];

      const ratingIndex =
        labels.findIndex(
          (label) =>
            [
              "RTG",
              "RAT",
              "RATE",
            ].includes(
              String(label).toUpperCase()
            )
        );

      if (ratingIndex === -1) {
        return;
      }

      (
        passingCategory.athletes || []
      ).forEach((row) => {
        const rating =
          Number(
            row.stats?.[
              ratingIndex
            ]
          );

        if (
          Number.isNaN(rating)
        ) {
          return;
        }

        passers.push({
          athleteId:
            row.athlete?.id
              ? String(
                  row.athlete.id
                )
              : null,

          name:
            row.athlete
              ?.displayName ||
            row.athlete
              ?.shortName ||
            "",

          rating,

          teamNames,
        });
      });
    }
  );

  return passers;
}

/* =========================================================
   MATCHING ÉQUIPE
   ========================================================= */

function normalizeTeam(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function teamMatches(
  qbTeam,
  teamNames
) {
  const normalizedQbTeam =
    normalizeTeam(qbTeam);

  if (!normalizedQbTeam) {
    return false;
  }

  return (
    teamNames || []
  ).some((name) => {
    const normalizedName =
      normalizeTeam(name);

    return (
      normalizedName ===
        normalizedQbTeam ||
      normalizedName.includes(
        normalizedQbTeam
      ) ||
      normalizedQbTeam.includes(
        normalizedName
      )
    );
  });
}

/* =========================================================
   TROUVER MATCH + PASSEUR DU QB
   ========================================================= */

function findQbGameData(
  qbPick,
  liveGames,
  includePost = true
) {
  const qb =
    qbPick?.qbs;

  if (!qb?.team) {
    return null;
  }

  const matchingGame =
    Object.values(
      liveGames || {}
    ).find((game) => {
      if (!game) {
        return false;
      }

      const state =
        game.status?.state;

      const validState =
        state === "in" ||
        (
          includePost &&
          state === "post"
        );

      if (!validState) {
        return false;
      }

      return teamMatches(
        qb.team,
        game.teamNames
      );
    });

  if (!matchingGame) {
    return null;
  }

  const passers =
    matchingGame.passers || [];

  let passer = null;

  /*
   * PRIORITÉ 1 :
   * QB sélectionné lui-même.
   *
   * S'il commence le match puis
   * se blesse, SON rating demeure
   * celui du pool.
   */
  if (qb.espn_athlete_id) {
    passer =
      passers.find(
        (row) =>
          String(
            row.athleteId
          ) ===
          String(
            qb.espn_athlete_id
          )
      ) || null;
  }

  /*
   * PRIORITÉ 2 :
   * recherche par nom.
   */
  if (!passer) {
    const qbName =
      String(qb.name || "")
        .toLowerCase()
        .trim();

    passer =
      passers.find(
        (row) =>
          String(
            row.name || ""
          )
            .toLowerCase()
            .trim() ===
          qbName
      ) || null;
  }

  /*
   * PRIORITÉ 3 :
   * le QB choisi n'a pas joué.
   *
   * On prend alors le passeur réel
   * de sa même équipe.
   */
  if (!passer) {
    passer =
      passers.find(
        (row) =>
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

/* =========================================================
   NAVIGATION SEMAINES
   ========================================================= */

function WeekNavigator({
  viewedWeek,
  currentWeek,
  availableWeeks,
  onChange,
}) {
  const index =
    availableWeeks.indexOf(viewedWeek);

  const previousWeek =
    index > 0
      ? availableWeeks[index - 1]
      : null;

  const nextWeek =
    index >= 0 &&
    index <
      availableWeeks.length - 1
      ? availableWeeks[index + 1]
      : null;

  return (
    <section
      className="card"
      style={{
        padding: 12,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "48px 1fr 48px",
          gap: 10,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          disabled={previousWeek == null}
          onClick={() => {
            if (previousWeek != null) {
              onChange(previousWeek);
            }
          }}
          style={{
            height: 44,
            borderRadius: 14,
            border:
              "1px solid rgba(148,163,184,0.18)",
            background:
              previousWeek != null
                ? "rgba(34,197,94,0.10)"
                : "rgba(148,163,184,0.05)",
            color:
              previousWeek != null
                ? "#86efac"
                : "#475569",
            fontSize: 24,
            fontWeight: 900,
          }}
        >
          ‹
        </button>

        <div
          style={{
            textAlign: "center",
          }}
        >
          <strong
            style={{
              display: "block",
              color: "#f8fafc",
              fontSize: 18,
            }}
          >
            Semaine {viewedWeek}
          </strong>

          <span
            style={{
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            {viewedWeek === currentWeek
              ? "Semaine active"
              : "Historique"}
          </span>
        </div>

        <button
          type="button"
          disabled={nextWeek == null}
          onClick={() => {
            if (nextWeek != null) {
              onChange(nextWeek);
            }
          }}
          style={{
            height: 44,
            borderRadius: 14,
            border:
              "1px solid rgba(148,163,184,0.18)",
            background:
              nextWeek != null
                ? "rgba(34,197,94,0.10)"
                : "rgba(148,163,184,0.05)",
            color:
              nextWeek != null
                ? "#86efac"
                : "#475569",
            fontSize: 24,
            fontWeight: 900,
          }}
        >
          ›
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   DONNÉES D'AFFICHAGE QB
   ========================================================= */

function getDisplayedQbData(
  qbPick,
  qbRatings,
  liveGames
) {
  const officialRating =
    qbRatings.find(
      (row) =>
        row.qb_id ===
        qbPick.qb_id
    );

  const espnData =
    findQbGameData(
      qbPick,
      liveGames,
      true
    );

  const espnPasser =
    espnData?.passer;

  const hasOfficialRating =
    officialRating?.passer_rating != null;

  const displayedRating =
    hasOfficialRating
      ? Number(
          officialRating.passer_rating
        )
      : espnPasser?.rating != null
      ? Number(
          espnPasser.rating
        )
      : null;

  const actualAthleteId =
    hasOfficialRating
      ? officialRating
          ?.actual_espn_athlete_id ||
        qbPick.qbs
          ?.espn_athlete_id
      : espnPasser?.athleteId ||
        qbPick.qbs
          ?.espn_athlete_id;

  const actualName =
    hasOfficialRating
      ? officialRating
          ?.actual_qb_name ||
        qbPick.qbs?.name
      : espnPasser?.name ||
        qbPick.qbs?.name ||
        "QB";

  const replaced =
    actualAthleteId &&
    qbPick.qbs
      ?.espn_athlete_id &&
    String(actualAthleteId) !==
      String(
        qbPick.qbs
          .espn_athlete_id
      );

  return {
    officialRating,
    espnData,
    espnPasser,
    displayedRating,
    actualAthleteId,
    actualName,
    replaced,
    displayedQb: {
      name: actualName,
      team:
        qbPick.qbs?.team,
      espn_athlete_id:
        actualAthleteId,
    },
  };
}

/* =========================================================
   CARTE QB DU BLOC DU HAUT
   ========================================================= */

function QbPickCard({
  qbPick,
  qbRatings,
  players,
  qbSeasonAverages,
  getTeamLogo,
  isMobile,
  liveGames,
}) {
  const player =
    players.find(
      (p) =>
        p.id ===
        qbPick.user_id
    );

  const {
    displayedRating,
    actualAthleteId,
    displayedQb,
    replaced,
  } =
    getDisplayedQbData(
      qbPick,
      qbRatings,
      liveGames
    );

  const average =
    qbSeasonAverages[
      String(
        actualAthleteId || ""
      )
    ];

  /*
   * VERSION COMPACTE :
   *
   * joueur en haut,
   * photo à gauche,
   * QB + équipe + stats à droite.
   *
   * 4 colonnes desktop plutôt que 5.
   */
  return (
    <div
      style={{
        minWidth: 0,
        padding:
          isMobile
            ? "9px"
            : "10px 11px",
        borderRadius: 14,
        background:
          "rgba(15,23,42,0.72)",
        border:
          "1px solid rgba(148,163,184,0.13)",
      }}
    >
      <PlayerIdentity
        player={player}
        compact={true}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            isMobile
              ? "44px minmax(0,1fr)"
              : "50px minmax(0,1fr)",
          gap: 8,
          alignItems: "center",
          marginTop: 7,
        }}
      >
        <QBPhoto
          qb={displayedQb}
          size={
            isMobile
              ? 44
              : 50
          }
        />

        <div
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
            }}
          >
            <TeamLogo
              logo={getTeamLogo(
                displayedQb?.team
              )}
              name={
                displayedQb?.team
              }
              size={19}
            />

            <strong
              style={{
                color: "#f8fafc",
                fontSize:
                  isMobile
                    ? 11
                    : 12,
                lineHeight: 1.15,
                overflowWrap: "anywhere",
              }}
            >
              {displayedQb?.name ||
                "QB"}
            </strong>
          </div>

          {replaced && (
            <div
              style={{
                marginTop: 3,
                color: "#facc15",
                fontSize: 8,
                fontWeight: 900,
              }}
            >
              🔄 Remplacement
            </div>
          )}

          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: "#94a3b8",
              lineHeight: 1.2,
            }}
          >
            Rating{" "}
            <strong
              style={{
                color:
                  displayedRating !=
                  null
                    ? ratingColor(
                        displayedRating
                      )
                    : "#64748b",
              }}
            >
              {displayedRating != null
                ? displayedRating.toFixed(
                    1
                  )
                : "--"}
            </strong>

            {average != null && (
              <>
                <span> · </span>

                Moy.{" "}
                <strong
                  style={{
                    color:
                      ratingColor(
                        average
                      ),
                  }}
                >
                  {average.toFixed(1)}
                </strong>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   BLOC QB DU HAUT
   ========================================================= */

function QbWeekSection({
  qbPicks,
  qbRatings,
  players,
  qbSeasonAverages,
  getTeamLogo,
  isMobile,
  liveGames,
}) {
  /*
   * Dès qu'un match est EN DIRECT,
   * le QB concerné disparaît du bloc
   * du haut.
   *
   * Dès que le match passe à POST,
   * il revient ici automatiquement.
   */
  const visibleQbPicks =
    qbPicks.filter(
      (qbPick) => {
        const data =
          findQbGameData(
            qbPick,
            liveGames,
            false
          );

        return (
          data?.game?.status
            ?.state !== "in"
        );
      }
    );

  return (
    <section className="card">
      <div
        style={{
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            color: "#22c55e",
            fontSize:
              isMobile
                ? 20
                : 24,
          }}
        >
          🏈 QB de la semaine
        </h2>

        <p
          style={{
            margin: "5px 0 0",
            color: "#94a3b8",
            fontSize: 12,
          }}
        >
          {qbPicks.length} sélection
          {qbPicks.length !== 1
            ? "s"
            : ""}{" "}
          soumise
          {qbPicks.length !== 1
            ? "s"
            : ""}
        </p>
      </div>

      {visibleQbPicks.length ===
      0 ? (
        <p
          style={{
            margin: 0,
            color: "#64748b",
          }}
        >
          Les QB sélectionnés jouent
          actuellement.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(4, minmax(0, 1fr))",
            gap:
              isMobile
                ? 7
                : 9,
          }}
        >
          {visibleQbPicks.map(
            (qbPick) => (
              <QbPickCard
                key={qbPick.id}
                qbPick={qbPick}
                qbRatings={
                  qbRatings
                }
                players={
                  players
                }
                qbSeasonAverages={
                  qbSeasonAverages
                }
                getTeamLogo={
                  getTeamLogo
                }
                isMobile={
                  isMobile
                }
                liveGames={
                  liveGames
                }
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   QB AFFICHÉ SOUS SON ÉQUIPE PENDANT LE LIVE
   ========================================================= */

function LiveTeamQbs({
  qbPicks,
  players,
  qbRatings,
  liveGames,
  isMobile,
}) {
  if (!qbPicks?.length) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 11,
        display: "grid",
        gap: 7,
      }}
    >
      {qbPicks.map(
        (qbPick) => {
          const player =
            players.find(
              (p) =>
                p.id ===
                qbPick.user_id
            );

          const {
            displayedRating,
            displayedQb,
            replaced,
          } =
            getDisplayedQbData(
              qbPick,
              qbRatings,
              liveGames
            );

          return (
            <div
              key={qbPick.id}
              style={{
                padding:
                  isMobile
                    ? "8px 5px"
                    : "9px 8px",
                borderRadius: 11,
                background:
                  "rgba(239,68,68,0.055)",
                border:
                  "1px solid rgba(239,68,68,0.18)",
                textAlign: "center",
                minWidth: 0,
              }}
            >
              {/* PHOTO DU QB */}

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "center",
                }}
              >
                <QBPhoto
                  qb={displayedQb}
                  size={
                    isMobile
                      ? 42
                      : 48
                  }
                />
              </div>

              {/* NOM DU QB */}

              <strong
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "#f8fafc",
                  fontSize:
                    isMobile
                      ? 10
                      : 12,
                  fontWeight: 900,
                  lineHeight: 1.15,
                  overflowWrap:
                    "anywhere",
                }}
              >
                {displayedQb?.name ||
                  "QB"}
              </strong>

              {/* JOUEUR DU POOL */}

              <div
                style={{
                  marginTop: 6,
                }}
              >
                <PlayerIdentity
                  player={player}
                  compact={true}
                  align="center"
                />
              </div>

              {/* REMPLACEMENT */}

              {replaced && (
                <div
                  style={{
                    marginTop: 4,
                    color: "#facc15",
                    fontSize: 8,
                    fontWeight: 900,
                  }}
                >
                  🔄 Remplacement
                </div>
              )}

              {/* LIVE */}

              <div
                style={{
                  marginTop: 5,
                  color: "#f87171",
                  fontSize: 8,
                  fontWeight: 900,
                  letterSpacing:
                    "0.4px",
                }}
              >
                ● EN DIRECT
              </div>

              {/* PASSER RATING */}

              <div
                style={{
                  marginTop: 3,
                  color: "#94a3b8",
                  fontSize: 10,
                }}
              >
                Rating{" "}
                <strong
                  style={{
                    color:
                      displayedRating !=
                      null
                        ? ratingColor(
                            displayedRating
                          )
                        : "#64748b",
                  }}
                >
                  {displayedRating !=
                  null
                    ? displayedRating.toFixed(
                        1
                      )
                    : "--"}
                </strong>
              </div>
            </div>
          );
        }
      )}
    </div>
  );
}

/* =========================================================
   UNE LIGNE DE PICK
   ========================================================= */

function PickRow({
  pick,
  game,
  players,
  getTeamLogo,
  isMobile,
  showBottomBorder = true,
}) {
  const player =
    players.find(
      (p) =>
        p.id ===
        pick.user_id
    );

  const result =
    getPickResult(
      game,
      pick
    );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(0,1fr) auto",
        gap: 8,
        alignItems: "center",
        padding:
          isMobile
            ? "11px 0"
            : "11px 4px",
        borderBottom:
          showBottomBorder
            ? "1px solid rgba(148,163,184,0.08)"
            : "none",
      }}
    >
      <PlayerIdentity
        player={player}
        compact={true}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            "flex-end",
          gap: 7,
          minWidth: 0,
        }}
      >
        <TeamLogo
          logo={getTeamLogo(
            pick.picked_team
          )}
          name={
            pick.picked_team
          }
          size={26}
        />

        <strong
          style={{
            color: "#f8fafc",
            fontSize:
              isMobile
                ? 12
                : 13,
            whiteSpace: "nowrap",
          }}
        >
          {pick.picked_team} par{" "}
          {pick.predicted_spread}
        </strong>

        <span
          title={result.label}
          style={{
            fontSize: 16,
            marginLeft: 1,
          }}
        >
          {result.badge}
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   CARTE MATCH
   ========================================================= */

function GamePicksCard({
  game,
  gamePicks,
  players,
  getTeamLogo,
  isMobile,
  liveGame,
  qbPicks,
  qbRatings,
  liveGames,
}) {
  /*
   * SCORE OFFICIEL SUPABASE
   */
  const hasOfficialScore =
    game.home_score != null &&
    game.away_score != null;

  /*
   * DONNÉES ESPN TEMPORAIRES
   */
  const espnScore =
    liveGame?.score || null;

  const isLive =
    liveGame?.status
      ?.state === "in";

  /*
   * PRIORITÉ :
   *
   * 1. Supabase
   * 2. ESPN in/post
   * 3. aucun score
   */
  const displayedScore =
    hasOfficialScore
      ? {
          awayScore:
            Number(
              game.away_score
            ),
          homeScore:
            Number(
              game.home_score
            ),
        }
      : espnScore
      ? {
          awayScore:
            espnScore.awayScore,
          homeScore:
            espnScore.homeScore,
        }
      : null;

  const sortedPicks = [
    ...gamePicks,
  ].sort(
    (a, b) =>
      new Date(
        a.updated_at || 0
      ).getTime() -
      new Date(
        b.updated_at || 0
      ).getTime()
  );

  const awayCount =
    sortedPicks.filter(
      (pick) =>
        pick.picked_team ===
        game.away_team
    ).length;

  const homeCount =
    sortedPicks.filter(
      (pick) =>
        pick.picked_team ===
        game.home_team
    ).length;

  const splitPoint =
    Math.ceil(
      sortedPicks.length / 2
    );

  const leftPicks =
    sortedPicks.slice(
      0,
      splitPoint
    );

  const rightPicks =
    sortedPicks.slice(
      splitPoint
    );

  /*
   * QB DU POOL CONCERNÉS
   * PAR CE MATCH.
   *
   * Seulement pendant LIVE.
   */
  const liveQbPicks =
    isLive
      ? qbPicks.filter(
          (qbPick) => {
            const data =
              findQbGameData(
                qbPick,
                liveGames,
                false
              );

            return (
              data?.game
                ?.gameId ===
              game.id
            );
          }
        )
      : [];

  /*
   * On les sépare entre
   * équipe visiteuse / locale.
   */
  const awayLiveQbs =
    liveQbPicks.filter(
      (qbPick) =>
        teamMatches(
          qbPick.qbs?.team,
          [
            game.away_team,
          ]
        )
    );

  const homeLiveQbs =
    liveQbPicks.filter(
      (qbPick) =>
        teamMatches(
          qbPick.qbs?.team,
          [
            game.home_team,
          ]
        )
    );

  return (
    <section
      className="card"
      style={{
        overflow: "hidden",
      }}
    >
      <GameTimeBar
        gameDate={
          game.game_date
        }
      />

      {/* =====================================================
          SCOREBOARD
          ===================================================== */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0,1fr) auto minmax(0,1fr)",
          gap:
            isMobile
              ? 8
              : 20,
          alignItems: "start",
          marginTop: 18,
        }}
      >
        {/* ÉQUIPE VISITEUSE */}

        <div
          style={{
            minWidth: 0,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "center",
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
                  : 86
              }
            />
          </div>

          <strong
            style={{
              display: "block",
              marginTop: 6,
              color: "#f8fafc",
              fontSize:
                isMobile
                  ? 14
                  : 19,
              fontWeight: 900,
            }}
          >
            {game.away_team}
          </strong>

          {/* QB LIVE SOUS SON ÉQUIPE */}

          <LiveTeamQbs
            qbPicks={
              awayLiveQbs
            }
            players={
              players
            }
            qbRatings={
              qbRatings
            }
            liveGames={
              liveGames
            }
            isMobile={
              isMobile
            }
          />
        </div>

        {/* SCORE */}

        <div
          style={{
            textAlign: "center",
            minWidth:
              isMobile
                ? 72
                : 125,
            paddingTop: 18,
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
                      ? 23
                      : 34,
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
                <>
                  <span
                    style={{
                      display:
                        "block",
                      marginTop: 4,
                      color:
                        "#f87171",
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing:
                        "0.55px",
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    ● EN DIRECT
                  </span>

                  <span
                    style={{
                      display:
                        "block",
                      marginTop: 3,
                      color:
                        "#cbd5e1",
                      fontSize: 10,
                      fontWeight: 800,
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    {getQuarterLabel(
                      liveGame
                        ?.status
                        ?.period
                    )}

                    {liveGame
                      ?.status
                      ?.clock
                      ? ` · ${liveGame.status.clock}`
                      : ""}
                  </span>
                </>
              ) : (
                <span
                  style={{
                    display:
                      "block",
                    marginTop: 4,
                    color:
                      "#94a3b8",
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
                fontSize:
                  isMobile
                    ? 20
                    : 28,
              }}
            >
              @
            </strong>
          )}
        </div>

        {/* ÉQUIPE DOMICILE */}

        <div
          style={{
            minWidth: 0,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "center",
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
                  : 86
              }
            />
          </div>

          <strong
            style={{
              display: "block",
              marginTop: 6,
              color: "#f8fafc",
              fontSize:
                isMobile
                  ? 14
                  : 19,
              fontWeight: 900,
            }}
          >
            {game.home_team}
          </strong>

          {/* QB LIVE SOUS SON ÉQUIPE */}

          <LiveTeamQbs
            qbPicks={
              homeLiveQbs
            }
            players={
              players
            }
            qbRatings={
              qbRatings
            }
            liveGames={
              liveGames
            }
            isMobile={
              isMobile
            }
          />
        </div>
      </div>

      {/* =====================================================
          CONSENSUS
          ===================================================== */}

      {sortedPicks.length > 0 && (
        <div
          style={{
            marginTop: 17,
            padding:
              "8px 12px",
            borderRadius: 10,
            background:
              "rgba(30,41,59,0.76)",
            border:
              "1px solid rgba(148,163,184,0.08)",
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            gap: 8,
            flexWrap: "wrap",
            color: "#cbd5e1",
            fontSize: 12,
          }}
        >
          <span
            style={{
              color: "#94a3b8",
            }}
          >
            Choix du pool
          </span>

          <span
            style={{
              color: "#22c55e",
            }}
          >
            •
          </span>

          <strong>
            {awayCount}{" "}
            {game.away_team}
          </strong>

          <span
            style={{
              color: "#22c55e",
            }}
          >
            •
          </span>

          <strong>
            {homeCount}{" "}
            {game.home_team}
          </strong>
        </div>
      )}

      {sortedPicks.length ===
        0 && (
        <div
          style={{
            marginTop: 16,
            padding:
              "14px 0 2px",
            textAlign:
              "center",
            color: "#64748b",
            fontSize: 13,
          }}
        >
          Aucun choix soumis pour ce match.
        </div>
      )}

      {/* =====================================================
          PICKS MOBILE
          ===================================================== */}

      {sortedPicks.length > 0 &&
        isMobile && (
          <div
            style={{
              marginTop: 12,
            }}
          >
            {sortedPicks.map(
              (pick, index) => (
                <PickRow
                  key={pick.id}
                  pick={pick}
                  game={game}
                  players={
                    players
                  }
                  getTeamLogo={
                    getTeamLogo
                  }
                  isMobile={
                    true
                  }
                  showBottomBorder={
                    index <
                    sortedPicks.length -
                      1
                  }
                />
              )
            )}
          </div>
        )}

      {/* =====================================================
          PICKS DESKTOP
          ===================================================== */}

      {sortedPicks.length > 0 &&
        !isMobile && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0,1fr) minmax(0,1fr)",
              marginTop: 14,
            }}
          >
            <div
              style={{
                paddingRight: 14,
              }}
            >
              {leftPicks.map(
                (pick, index) => (
                  <PickRow
                    key={pick.id}
                    pick={pick}
                    game={game}
                    players={
                      players
                    }
                    getTeamLogo={
                      getTeamLogo
                    }
                    isMobile={
                      false
                    }
                    showBottomBorder={
                      index <
                      leftPicks.length -
                        1
                    }
                  />
                )
              )}
            </div>

            <div
              style={{
                paddingLeft: 14,
                borderLeft:
                  "1px solid rgba(148,163,184,0.12)",
              }}
            >
              {rightPicks.map(
                (pick, index) => (
                  <PickRow
                    key={pick.id}
                    pick={pick}
                    game={game}
                    players={
                      players
                    }
                    getTeamLogo={
                      getTeamLogo
                    }
                    isMobile={
                      false
                    }
                    showBottomBorder={
                      index <
                      rightPicks.length -
                        1
                    }
                  />
                )
              )}
            </div>
          </div>
        )}
    </section>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function TousLesChoix() {
  const [
    players,
    setPlayers,
  ] = useState([]);

  const [
    picks,
    setPicks,
  ] = useState([]);

  const [
    qbPicks,
    setQbPicks,
  ] = useState([]);

  const [
    qbRatings,
    setQbRatings,
  ] = useState([]);

  const [
    teams,
    setTeams,
  ] = useState([]);

  const [
    weekGames,
    setWeekGames,
  ] = useState([]);

  const [
    currentWeek,
    setCurrentWeek,
  ] = useState(null);

  const [
    viewedWeek,
    setViewedWeek,
  ] = useState(null);

  const [
    availableWeeks,
    setAvailableWeeks,
  ] = useState([]);

  const [
    qbSeasonAverages,
    setQbSeasonAverages,
  ] = useState({});

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    isMobile,
    setIsMobile,
  ] = useState(false);

  /*
   * ESPN temporaire.
   *
   * Rien de ce state n'est écrit
   * dans Supabase.
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
        window.innerWidth <
          700
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
     BASE
     ========================================================= */

  useEffect(() => {
    async function loadBaseData() {
      setLoading(true);

      const {
        data: settingsData,
      } = await supabase
        .from("settings")
        .select("*")
        .single();

      const activeWeek =
        Number(
          settingsData
            ?.current_week
        ) || 1;

      setCurrentWeek(
        activeWeek
      );

      setViewedWeek(
        activeWeek
      );

      const {
        data: teamsData,
      } = await supabase
        .from("teams")
        .select("*");

      setTeams(
        teamsData || []
      );

      const {
        data: usersData,
      } = await supabase
        .from("users")
        .select(`
          id,
          email,
          display_name,
          real_name
        `);

      setPlayers(
        usersData || []
      );

      const {
        data: weeksData,
      } = await supabase
        .from("games")
        .select("week")
        .eq(
          "is_pool_eligible",
          true
        );

      const weeks =
        Array.from(
          new Set(
            (
              weeksData || []
            )
              .map((game) =>
                Number(
                  game.week
                )
              )
              .filter(
                (week) =>
                  Number.isFinite(
                    week
                  ) &&
                  week <=
                    activeWeek
              )
          )
        ).sort(
          (a, b) =>
            a - b
        );

      setAvailableWeeks(
        weeks.length > 0
          ? weeks
          : [activeWeek]
      );

      setLoading(false);
    }

    loadBaseData();
  }, []);

  /* =========================================================
     DONNÉES DE LA SEMAINE
     ========================================================= */

  useEffect(() => {
    if (
      viewedWeek == null ||
      currentWeek == null
    ) {
      return;
    }

    async function loadWeekData() {
      setLoading(true);
      setMessage("");

      /*
       * Quand on change de semaine,
       * on vide les données ESPN
       * de l'ancienne semaine.
       */
      setLiveGames({});

      /* MATCHS */

      const {
        data: gamesData,
        error: gamesError,
      } = await supabase
        .from("games")
        .select(`
          id,
          week,
          away_team,
          home_team,
          away_score,
          home_score,
          game_date,
          external_game_id,
          is_pool_eligible
        `)
        .eq(
          "week",
          viewedWeek
        )
        .eq(
          "is_pool_eligible",
          true
        )
        .order(
          "game_date",
          {
            ascending: true,
          }
        );

      if (gamesError) {
        setMessage(
          "Erreur matchs : " +
            gamesError.message
        );

        setLoading(false);
        return;
      }

      const games =
        gamesData || [];

      setWeekGames(
        games
      );

      /* PICKS */

      const gameIds =
        games.map(
          (game) =>
            game.id
        );

      let weekPicks = [];

      if (
        gameIds.length > 0
      ) {
        const {
          data: picksData,
          error: picksError,
        } = await supabase
          .from("picks")
          .select(`
            id,
            user_id,
            game_id,
            picked_team,
            predicted_spread,
            updated_at
          `)
          .in(
            "game_id",
            gameIds
          );

        if (picksError) {
          setMessage(
            "Erreur choix : " +
              picksError.message
          );

          setLoading(false);
          return;
        }

        weekPicks =
          picksData || [];
      }

      setPicks(
        weekPicks
      );

      /* QB PICKS */

      const {
        data: qbData,
        error: qbError,
      } = await supabase
        .from("qb_picks")
        .select(`
          id,
          user_id,
          week,
          qb_id,
          created_at,
          qbs (
            id,
            name,
            team,
            logo,
            espn_athlete_id
          )
        `)
        .eq(
          "week",
          viewedWeek
        )
        .order(
          "created_at",
          {
            ascending: true,
          }
        );

      if (qbError) {
        setMessage(
          "Erreur QB : " +
            qbError.message
        );

        setLoading(false);
        return;
      }

      setQbPicks(
        qbData || []
      );

      /* RATINGS OFFICIELS */

      const {
        data: ratingsData,
        error: ratingsError,
      } = await supabase
        .from("qb_ratings")
        .select("*")
        .eq(
          "week",
          viewedWeek
        );

      if (ratingsError) {
        setMessage(
          "Erreur ratings : " +
            ratingsError.message
        );

        setLoading(false);
        return;
      }

      setQbRatings(
        ratingsData || []
      );

      /* MOYENNES QB */

      const {
        data: allRatings,
      } = await supabase
        .from("qb_ratings")
        .select(`
          qb_id,
          week,
          passer_rating,
          actual_espn_athlete_id,
          qbs (
            espn_athlete_id
          )
        `)
        .lte(
          "week",
          viewedWeek
        );

      const averages = {};

      (
        allRatings || []
      ).forEach(
        (row) => {
          if (
            row.passer_rating ==
            null
          ) {
            return;
          }

          const athleteId =
            row.actual_espn_athlete_id ||
            row.qbs
              ?.espn_athlete_id;

          if (!athleteId) {
            return;
          }

          const key =
            String(
              athleteId
            );

          if (
            !averages[key]
          ) {
            averages[key] = {
              total: 0,
              count: 0,
            };
          }

          averages[
            key
          ].total +=
            Number(
              row.passer_rating
            );

          averages[
            key
          ].count += 1;
        }
      );

      const formatted = {};

      Object.keys(
        averages
      ).forEach(
        (athleteId) => {
          formatted[
            athleteId
          ] =
            averages[
              athleteId
            ].total /
            averages[
              athleteId
            ].count;
        }
      );

      setQbSeasonAverages(
        formatted
      );

      setLoading(false);
    }

    loadWeekData();
  }, [
    viewedWeek,
    currentWeek,
  ]);

  /* =========================================================
     ESPN LIVE + POST-MATCH
     ========================================================= */

  useEffect(() => {
    /*
     * Seulement la semaine active.
     */
    if (
      viewedWeek == null ||
      currentWeek == null ||
      viewedWeek !==
        currentWeek ||
      weekGames.length === 0
    ) {
      setLiveGames({});
      return;
    }

    let cancelled = false;

    async function refreshLive() {
      const eligibleGames =
        weekGames.filter(
          (game) =>
            game.is_pool_eligible ===
              true &&
            game.external_game_id
        );

      if (
        eligibleGames.length ===
        0
      ) {
        return;
      }

      const results = {};

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

              if (!response.ok) {
                return;
              }

              const summary =
                await response.json();

              const status =
                getLiveGameStatus(
                  summary
                );

              /*
               * IMPORTANT :
               *
               * AVANT :
               * on gardait uniquement "in".
               *
               * MAINTENANT :
               * on garde "in" ET "post".
               *
               * Ainsi, le score et le
               * passer rating ne disparaissent
               * plus à la fin du match.
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
                  ?.competitions
                  ?.[0];

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
                  .map((value) =>
                    String(value)
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
            } catch (error) {
              console.error(
                `Erreur ESPN match ${game.external_game_id}:`,
                error
              );
            }
          }
        )
      );

      /*
       * IMPORTANT :
       *
       * On ne remplace plus tout le state
       * par "results".
       *
       * On fusionne les nouvelles données
       * avec les dernières données connues.
       *
       * Donc si ESPN rate une lecture
       * temporairement, le score/rating
       * ne disparaît pas immédiatement.
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

    /*
     * Lecture immédiate.
     */
    refreshLive();

    /*
     * Rafraîchissement toutes
     * les 30 secondes.
     */
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
    weekGames,
    viewedWeek,
    currentWeek,
  ]);

  /* =========================================================
     LOGO ÉQUIPE
     ========================================================= */

  const getTeamLogo =
    (teamName) => {
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

  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <main className="page">
      <section className="header-card">
        <h1>
          Tous les choix 👀
        </h1>

        <p>
          Compare les choix du pool,
          match par match.
        </p>
      </section>

      {currentWeek != null &&
        viewedWeek != null && (
          <WeekNavigator
            viewedWeek={
              viewedWeek
            }
            currentWeek={
              currentWeek
            }
            availableWeeks={
              availableWeeks
            }
            onChange={
              setViewedWeek
            }
          />
        )}

      {message && (
        <section className="card">
          <p
            style={{
              margin: 0,
            }}
          >
            {message}
          </p>
        </section>
      )}

      {loading && (
        <section className="card">
          <p
            style={{
              margin: 0,
              color: "#94a3b8",
            }}
          >
            Chargement des choix...
          </p>
        </section>
      )}

      {!loading && (
        <>
          <QbWeekSection
            qbPicks={
              qbPicks
            }
            qbRatings={
              qbRatings
            }
            players={
              players
            }
            qbSeasonAverages={
              qbSeasonAverages
            }
            getTeamLogo={
              getTeamLogo
            }
            isMobile={
              isMobile
            }
            liveGames={
              liveGames
            }
          />

          {weekGames.length ===
          0 ? (
            <section className="card">
              <p
                style={{
                  margin: 0,
                  color:
                    "#94a3b8",
                }}
              >
                Aucun match du pool
                pour cette semaine.
              </p>
            </section>
          ) : (
            weekGames.map(
              (game) => {
                const gamePicks =
                  picks.filter(
                    (pick) =>
                      pick.game_id ===
                      game.id
                  );

                return (
                  <GamePicksCard
                    key={
                      game.id
                    }
                    game={
                      game
                    }
                    gamePicks={
                      gamePicks
                    }
                    players={
                      players
                    }
                    getTeamLogo={
                      getTeamLogo
                    }
                    isMobile={
                      isMobile
                    }
                    liveGame={
                      liveGames[
                        game.id
                      ] ||
                      null
                    }
                    qbPicks={
                      qbPicks
                    }
                    qbRatings={
                      qbRatings
                    }
                    liveGames={
                      liveGames
                    }
                  />
                );
              }
            )
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}
