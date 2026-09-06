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
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
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

  if (game.home_score === game.away_score) {
    return {
      badge: "⚪",
      points: null,
      label: "Égalité",
    };
  }

  const winner =
    game.home_score > game.away_score
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
   BLOC QB
   ========================================================= */

function QbWeekSection({
  qbPicks,
  qbRatings,
  players,
  qbSeasonAverages,
  getTeamLogo,
  isMobile,
}) {
  return (
    <section className="card">
      <div
        style={{
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            color: "#22c55e",
            fontSize: isMobile
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

      {qbPicks.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: "#64748b",
          }}
        >
          Aucun QB soumis pour le moment.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "repeat(2, minmax(0, 1fr))"
              : "repeat(5, minmax(0, 1fr))",
            gap: isMobile ? 8 : 10,
          }}
        >
          {qbPicks.map((qbPick) => {
            const player =
              players.find(
                (p) =>
                  p.id ===
                  qbPick.user_id
              );

            const rating =
              qbRatings.find(
                (row) =>
                  row.qb_id ===
                  qbPick.qb_id
              );

            const displayedQb =
              rating?.actual_espn_athlete_id
                ? {
                    name:
                      rating.actual_qb_name ||
                      qbPick.qbs?.name,
                    team:
                      qbPick.qbs?.team,
                    espn_athlete_id:
                      rating.actual_espn_athlete_id,
                  }
                : qbPick.qbs;

            const replaced =
              rating?.actual_espn_athlete_id &&
              String(
                rating.actual_espn_athlete_id
              ) !==
                String(
                  qbPick.qbs
                    ?.espn_athlete_id
                );

            const average =
              qbSeasonAverages[
                String(
                  rating?.actual_espn_athlete_id ||
                    qbPick.qbs
                      ?.espn_athlete_id
                )
              ];

            return (
              <div
                key={qbPick.id}
                style={{
                  minWidth: 0,
                  padding: isMobile
                    ? 10
                    : 12,
                  borderRadius: 15,
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
                    marginTop: 10,
                    display: "flex",
                    justifyContent:
                      "center",
                  }}
                >
                  <QBPhoto
                    qb={displayedQb}
                    size={
                      isMobile
                        ? 55
                        : 66
                    }
                  />
                </div>

                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      "center",
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
                    size={22}
                  />

                  <strong
                    style={{
                      color: "#f8fafc",
                      fontSize: isMobile
                        ? 11
                        : 13,
                      lineHeight: 1.15,
                      textAlign: "center",
                      overflow: "hidden",
                      textOverflow:
                        "ellipsis",
                    }}
                  >
                    {displayedQb?.name ||
                      "QB"}
                  </strong>
                </div>

                {replaced && (
                  <div
                    style={{
                      marginTop: 5,
                      color: "#facc15",
                      fontSize: 9,
                      textAlign: "center",
                      fontWeight: 900,
                    }}
                  >
                    🔄 Remplacement
                  </div>
                )}

                <div
                  style={{
                    marginTop: 7,
                    textAlign: "center",
                    fontSize: 10,
                    color: "#94a3b8",
                  }}
                >
                  {rating?.passer_rating !=
                    null && (
                    <>
                      Rating{" "}
                      <strong
                        style={{
                          color:
                            ratingColor(
                              rating.passer_rating
                            ),
                        }}
                      >
                        {Number(
                          rating.passer_rating
                        ).toFixed(1)}
                      </strong>
                    </>
                  )}

                  {rating?.passer_rating !=
                    null &&
                    average != null && (
                      <span> · </span>
                    )}

                  {average != null && (
                    <>
                      Moy.{" "}
                      <strong
                        style={{
                          color:
                            ratingColor(
                              average
                            ),
                        }}
                      >
                        {average.toFixed(
                          1
                        )}
                      </strong>
                    </>
                  )}

                  {rating?.passer_rating ==
                    null &&
                    average == null &&
                    "--"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
        p.id === pick.user_id
    );

  const result =
    getPickResult(game, pick);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(0,1fr) auto",
        gap: 8,
        alignItems: "center",
        padding: isMobile
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
          name={pick.picked_team}
          size={26}
        />

        <strong
          style={{
            color: "#f8fafc",
            fontSize: isMobile
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
}) {
  const hasScore =
    game.home_score != null &&
    game.away_score != null;

  /*
   * ORDRE DE SOUMISSION
   * Aucun numéro n'est affiché.
   */
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

  /*
   * Desktop :
   * 13 joueurs => 7 à gauche / 6 à droite.
   */
  const splitPoint = Math.ceil(
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

  return (
    <section
      className="card"
      style={{
        overflow: "hidden",
      }}
    >
      {/* HEURE */}

      <GameTimeBar
        gameDate={game.game_date}
      />

      {/* SCOREBOARD */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0,1fr) auto minmax(0,1fr)",
          gap: isMobile
            ? 8
            : 20,
          alignItems: "center",
          marginTop: 18,
        }}
      >
        {/* VISITEUR */}

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
              name={game.away_team}
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
              fontSize: isMobile
                ? 14
                : 19,
              fontWeight: 900,
            }}
          >
            {game.away_team}
          </strong>
        </div>

        {/* SCORE */}

        <div
          style={{
            textAlign: "center",
            minWidth: isMobile
              ? 72
              : 125,
          }}
        >
          {hasScore ? (
            <>
              <strong
                style={{
                  display: "block",
                  color: "#f8fafc",
                  fontSize: isMobile
                    ? 23
                    : 34,
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                }}
              >
                {game.away_score} -{" "}
                {game.home_score}
              </strong>

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
            </>
          ) : (
            <strong
              style={{
                color: "#64748b",
                fontSize: isMobile
                  ? 20
                  : 28,
              }}
            >
              @
            </strong>
          )}
        </div>

        {/* DOMICILE */}

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
              name={game.home_team}
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
              fontSize: isMobile
                ? 14
                : 19,
              fontWeight: 900,
            }}
          >
            {game.home_team}
          </strong>
        </div>
      </div>

      {/* CONSENSUS */}

      {sortedPicks.length > 0 && (
        <div
          style={{
            marginTop: 17,
            padding: "8px 12px",
            borderRadius: 10,
            background:
              "rgba(30,41,59,0.76)",
            border:
              "1px solid rgba(148,163,184,0.08)",
            display: "flex",
            alignItems: "center",
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

      {/* AUCUN PICK */}

      {sortedPicks.length === 0 && (
        <div
          style={{
            marginTop: 16,
            padding: "14px 0 2px",
            textAlign: "center",
            color: "#64748b",
            fontSize: 13,
          }}
        >
          Aucun choix soumis pour ce match.
        </div>
      )}

      {/* PICKS MOBILE */}

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
                  players={players}
                  getTeamLogo={
                    getTeamLogo
                  }
                  isMobile={true}
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

      {/* PICKS DESKTOP */}

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
            {/* GAUCHE */}

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
                    players={players}
                    getTeamLogo={
                      getTeamLogo
                    }
                    isMobile={false}
                    showBottomBorder={
                      index <
                      leftPicks.length -
                        1
                    }
                  />
                )
              )}
            </div>

            {/* DROITE */}

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
                    players={players}
                    getTeamLogo={
                      getTeamLogo
                    }
                    isMobile={false}
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
  const [players, setPlayers] =
    useState([]);

  const [picks, setPicks] =
    useState([]);

  const [qbPicks, setQbPicks] =
    useState([]);

  const [qbRatings, setQbRatings] =
    useState([]);

  const [teams, setTeams] =
    useState([]);

  const [weekGames, setWeekGames] =
    useState([]);

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
          settingsData?.current_week
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
            (weeksData || [])
              .map((game) =>
                Number(game.week)
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
     SEMAINE
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

      /* QB PICKS
         Premier soumis = premier affiché
      */

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

      /* RATINGS */

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
