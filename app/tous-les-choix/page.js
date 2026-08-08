"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "Joueur";
}

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function QBPhoto({ qb, size = 78 }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 18,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
        }}
      >
        QB
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={qb.name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
      }}
    />
  );
}

function TeamLogo({ logo, name, size = 66 }) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 18,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
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
      }}
    />
  );
}

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) {
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

  if (Number(pick.predicted_spread) === realSpread) {
    return "🟢";
  }

  return "🟡";
}

function ratingColor(rating) {
  const value = Number(rating);

  if (value >= 100) return "#22c55e";
  if (value >= 90) return "#f8fafc";
  if (value >= 70) return "#f97316";

  return "#ef4444";
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

function GameTimeBar({ gameDate }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "7px 12px",
        marginBottom: 8,
        borderRadius: 10,
        background: "rgba(34,197,94,0.10)",
        border: "1px solid rgba(34,197,94,0.18)",
        color: "#86efac",
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: "0.4px",
      }}
    >
      <span>🗓️</span>
      <span>{formatGameDate(gameDate)}</span>
    </div>
  );
}

function WeekNavigator({
  viewedWeek,
  currentWeek,
  minWeek,
  onPrevious,
  onNext,
}) {
  const canGoPrevious = viewedWeek > minWeek;
  const canGoNext = viewedWeek < currentWeek;

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
          gridTemplateColumns: "48px 1fr 48px",
          gap: 10,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={onPrevious}
          disabled={!canGoPrevious}
          aria-label="Semaine précédente"
          style={{
            height: 44,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.18)",
            background: canGoPrevious
              ? "rgba(34,197,94,0.10)"
              : "rgba(148,163,184,0.05)",
            color: canGoPrevious ? "#86efac" : "#475569",
            fontSize: 24,
            fontWeight: 900,
            cursor: canGoPrevious ? "pointer" : "default",
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
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Semaine suivante"
          style={{
            height: 44,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.18)",
            background: canGoNext
              ? "rgba(34,197,94,0.10)"
              : "rgba(148,163,184,0.05)",
            color: canGoNext ? "#86efac" : "#475569",
            fontSize: 24,
            fontWeight: 900,
            cursor: canGoNext ? "pointer" : "default",
          }}
        >
          ›
        </button>
      </div>
    </section>
  );
}

export default function TousLesChoix() {
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
  const [qbRatings, setQbRatings] = useState([]);
  const [teams, setTeams] = useState([]);

  const [currentWeek, setCurrentWeek] = useState(null);
  const [viewedWeek, setViewedWeek] = useState(null);

  const [availableWeeks, setAvailableWeeks] = useState([]);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const [qbSeasonAverages, setQbSeasonAverages] =
    useState({});

  /*
   * Charge les données générales une seule fois :
   * semaine active, utilisateurs, équipes et semaines disponibles.
   */
  useEffect(() => {
    async function loadBaseData() {
      setLoading(true);

      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      const activeWeek =
        settingsData?.current_week || 1;

      setCurrentWeek(activeWeek);
      setViewedWeek(activeWeek);

      const { data: teamsData } = await supabase
        .from("teams")
        .select("*");

      setTeams(teamsData || []);

      const { data: usersData } = await supabase
        .from("users")
        .select("id, email, display_name")
        .order("email", { ascending: true });

      setPlayers(usersData || []);

      /*
       * On récupère les semaines qui existent vraiment
       * dans la table games.
       */
      const { data: weeksData, error: weeksError } =
        await supabase
          .from("games")
          .select("week")
          .eq("is_pool_eligible", true);

      if (weeksError) {
        setMessage(
          "Erreur semaines : " + weeksError.message
        );
      }

      const weeks = Array.from(
        new Set(
          (weeksData || [])
            .map((game) => Number(game.week))
            .filter(
              (week) =>
                Number.isFinite(week) &&
                week <= activeWeek
            )
        )
      ).sort((a, b) => a - b);

      /*
       * Si aucune semaine n'est trouvée,
       * on garde au minimum la semaine active.
       */
      setAvailableWeeks(
        weeks.length > 0 ? weeks : [activeWeek]
      );
    }

    loadBaseData();
  }, []);

  /*
   * Charge tout ce qui dépend de la semaine affichée.
   * Ce useEffect se relance lorsqu'on utilise les flèches.
   */
  useEffect(() => {
    if (viewedWeek == null) return;

    async function loadWeekData() {
      setLoading(true);
      setMessage("");

      /*
       * Choix de matchs de la semaine consultée.
       */
      const { data: picksData, error: picksError } =
        await supabase
          .from("picks")
          .select(`
            id,
            user_id,
            picked_team,
            predicted_spread,
            games!inner (
              id,
              week,
              away_team,
              home_team,
              away_score,
              home_score,
              game_date
            )
          `)
          .eq("games.week", viewedWeek);

      if (picksError) {
        setMessage(
          "Erreur choix : " + picksError.message
        );
        setLoading(false);
        return;
      }

      setPicks(picksData || []);

      /*
       * QB choisis durant cette semaine.
       */
      const { data: qbData, error: qbError } =
        await supabase
          .from("qb_picks")
          .select(`
            id,
            user_id,
            week,
            qb_id,
            qbs (
              id,
              name,
              team,
              logo,
              espn_athlete_id
            )
          `)
          .eq("week", viewedWeek);

      if (qbError) {
        setMessage(
          "Erreur QB : " + qbError.message
        );
        setLoading(false);
        return;
      }

      setQbPicks(qbData || []);

      /*
       * Ratings de cette semaine.
       */
      const { data: ratingsData, error: ratingsError } =
        await supabase
          .from("qb_ratings")
          .select("*")
          .eq("week", viewedWeek);

      if (ratingsError) {
        setMessage(
          "Erreur ratings : " + ratingsError.message
        );
        setLoading(false);
        return;
      }

      setQbRatings(ratingsData || []);

      /*
       * Moyennes saison.
       *
       * Pour une ancienne semaine, je limite la moyenne
       * aux semaines <= à celle consultée.
       *
       * Cela permet de revoir la semaine 5 telle qu'elle
       * se présentait à ce moment-là, sans que les ratings
       * futurs de semaines 6, 7, etc. modifient sa moyenne.
       */
      const { data: allRatings, error: averagesError } =
        await supabase
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
          .lte("week", viewedWeek);

      if (averagesError) {
        setMessage(
          "Erreur moyennes QB : " +
            averagesError.message
        );
      }

      const averages = {};

      (allRatings || []).forEach((row) => {
        if (row.passer_rating == null) return;

        const athleteId =
          row.actual_espn_athlete_id ||
          row.qbs?.espn_athlete_id;

        if (!athleteId) return;

        const key = String(athleteId);

        if (!averages[key]) {
          averages[key] = {
            total: 0,
            count: 0,
          };
        }

        averages[key].total += Number(
          row.passer_rating
        );

        averages[key].count += 1;
      });

      const formatted = {};

      Object.keys(averages).forEach(
        (athleteId) => {
          formatted[athleteId] =
            averages[athleteId].total /
            averages[athleteId].count;
        }
      );

      setQbSeasonAverages(formatted);

      setLoading(false);
    }

    loadWeekData();
  }, [viewedWeek]);

  const getTeamLogo = (teamName) => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() ===
        teamName?.toLowerCase().trim()
    );

    return team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo || null;
  };

  const currentWeekIndex =
    availableWeeks.indexOf(viewedWeek);

  const previousWeek =
    currentWeekIndex > 0
      ? availableWeeks[currentWeekIndex - 1]
      : null;

  const nextWeek =
    currentWeekIndex >= 0 &&
    currentWeekIndex < availableWeeks.length - 1
      ? availableWeeks[currentWeekIndex + 1]
      : null;

  const minWeek =
    availableWeeks.length > 0
      ? availableWeeks[0]
      : currentWeek || 1;

  const allUserIds = Array.from(
    new Set([
      ...players.map((player) => player.id),
      ...picks.map((pick) => pick.user_id),
      ...qbPicks.map((pick) => pick.user_id),
    ])
  );

  return (
    <main className="page">
      <section className="header-card">
        <h1>Tous les choix 👀</h1>

        <p>
          Semaine {viewedWeek || "..."}
        </p>
      </section>

      {currentWeek != null &&
        viewedWeek != null && (
          <WeekNavigator
            viewedWeek={viewedWeek}
            currentWeek={currentWeek}
            minWeek={minWeek}
            onPrevious={() => {
              if (previousWeek != null) {
                setViewedWeek(previousWeek);
              }
            }}
            onNext={() => {
              if (nextWeek != null) {
                setViewedWeek(nextWeek);
              }
            }}
          />
        )}

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {loading && (
        <section className="card">
          <p>Chargement des choix...</p>
        </section>
      )}

      {!loading && allUserIds.length === 0 && (
        <section className="card">
          <p>
            Aucun choix soumis pour la semaine{" "}
            {viewedWeek}.
          </p>
        </section>
      )}

      {!loading &&
        allUserIds.map((userId) => {
          const player = players.find(
            (player) => player.id === userId
          );

          /*
           * Ordre chronologique des matchs.
           */
          const weekGames = Array.from(
            new Map(
              picks
                .map((pick) => pick.games)
                .filter(Boolean)
                .sort(
                  (a, b) =>
                    new Date(
                      a.game_date || 0
                    ).getTime() -
                    new Date(
                      b.game_date || 0
                    ).getTime()
                )
                .map((game, index) => [
                  `${game.away_team}-${game.home_team}`,
                  index,
                ])
            )
          );

          const gameOrder =
            Object.fromEntries(weekGames);

          const playerPicks = picks
            .filter(
              (pick) =>
                pick.user_id === userId
            )
            .sort((a, b) => {
              const keyA =
                `${a.games?.away_team}-${a.games?.home_team}`;

              const keyB =
                `${b.games?.away_team}-${b.games?.home_team}`;

              return (
                (gameOrder[keyA] ?? 999) -
                (gameOrder[keyB] ?? 999)
              );
            });

          const playerQB = qbPicks.find(
            (qb) => qb.user_id === userId
          );

          const playerQbRating =
            qbRatings.find(
              (rating) =>
                rating.qb_id ===
                playerQB?.qb_id
            );

          /*
           * Si ESPN indique qu'un autre QB a réellement
           * joué, on affiche celui-là.
           */
          const displayedPlayerQB =
            playerQbRating?.actual_espn_athlete_id
              ? {
                  name:
                    playerQbRating.actual_qb_name ||
                    playerQB?.qbs?.name,

                  team:
                    playerQB?.qbs?.team,

                  espn_athlete_id:
                    playerQbRating.actual_espn_athlete_id,
                }
              : playerQB?.qbs;

          const qbWasReplaced =
            playerQbRating?.actual_espn_athlete_id &&
            String(
              playerQbRating.actual_espn_athlete_id
            ) !==
              String(
                playerQB?.qbs
                  ?.espn_athlete_id
              );

          const displayedPlayerQbAverage =
            qbSeasonAverages[
              String(
                playerQbRating?.actual_espn_athlete_id ||
                  playerQB?.qbs
                    ?.espn_athlete_id
              )
            ];

          return (
            <section
              key={userId}
              className="card"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 14,
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>
                    {displayName(player)}
                  </h2>

                  <p
                    style={{
                      margin: "4px 0 0 0",
                      color: "#94a3b8",
                    }}
                  >
                    Choix de la semaine{" "}
                    {viewedWeek}
                  </p>
                </div>
              </div>

              {/* QB */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "96px 1fr",
                  gap: 16,
                  alignItems: "center",
                  padding: 16,
                  borderRadius: 18,
                  background:
                    "rgba(34,197,94,0.08)",
                  border:
                    "1px solid rgba(34,197,94,0.20)",
                  marginBottom: 18,
                }}
              >
                {displayedPlayerQB ? (
                  <QBPhoto
                    qb={displayedPlayerQB}
                    size={92}
                  />
                ) : (
                  <div
                    style={{
                      width: 92,
                      height: 92,
                      borderRadius: 18,
                      background:
                        "rgba(148,163,184,0.16)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        "center",
                      fontWeight: 900,
                    }}
                  >
                    QB
                  </div>
                )}

                <div>
                  <p
                    style={{
                      margin: 0,
                      color: "#22c55e",
                      fontWeight: 900,
                    }}
                  >
                    QB
                  </p>

                  {displayedPlayerQB ? (
                    <>
                      <h2
                        style={{
                          margin:
                            "4px 0 2px 0",
                        }}
                      >
                        {
                          displayedPlayerQB.name
                        }
                      </h2>

                      <div
                        style={{
                          display: "flex",
                          alignItems:
                            "center",
                          gap: 8,
                          margin:
                            "0 0 4px 0",
                        }}
                      >
                        <TeamLogo
                          logo={getTeamLogo(
                            displayedPlayerQB.team
                          )}
                          name={
                            displayedPlayerQB.team
                          }
                          size={34}
                        />

                        <strong
                          style={{
                            color:
                              "#94a3b8",
                            fontSize: 16,
                          }}
                        >
                          {
                            displayedPlayerQB.team
                          }
                        </strong>
                      </div>

                      {qbWasReplaced && (
                        <p
                          style={{
                            margin:
                              "0 0 6px 0",
                            color:
                              "#facc15",
                            fontSize: 13,
                            fontWeight:
                              800,
                          }}
                        >
                          🔄 QB utilisé
                          automatiquement
                        </p>
                      )}

                      {playerQbRating?.passer_rating !=
                      null ? (
                        <p
                          style={{
                            margin:
                              "6px 0 0 0",
                            color:
                              "#94a3b8",

                            fontSize:
                              typeof window !==
                                "undefined" &&
                              window.innerWidth <
                                700
                                ? 14
                                : 16,
                          }}
                        >
                          Rating :{" "}
                          <strong
                            style={{
                              color:
                                ratingColor(
                                  playerQbRating.passer_rating
                                ),
                            }}
                          >
                            {Number(
                              playerQbRating.passer_rating
                            ).toFixed(1)}
                          </strong>

                          {" — "}

                          Moyenne :{" "}
                          <strong
                            style={{
                              color:
                                displayedPlayerQbAverage !=
                                null
                                  ? ratingColor(
                                      displayedPlayerQbAverage
                                    )
                                  : "#cbd5e1",
                            }}
                          >
                            {displayedPlayerQbAverage !=
                            null
                              ? displayedPlayerQbAverage.toFixed(
                                  1
                                )
                              : "--"}
                          </strong>
                        </p>
                      ) : (
                        <p
                          style={{
                            margin:
                              "6px 0 0 0",
                            color:
                              "#94a3b8",

                            fontSize:
                              typeof window !==
                                "undefined" &&
                              window.innerWidth <
                                700
                                ? 14
                                : 16,
                          }}
                        >
                          Moyenne :{" "}
                          <strong
                            style={{
                              color:
                                displayedPlayerQbAverage !=
                                null
                                  ? ratingColor(
                                      displayedPlayerQbAverage
                                    )
                                  : "#cbd5e1",
                            }}
                          >
                            {displayedPlayerQbAverage !=
                            null
                              ? displayedPlayerQbAverage.toFixed(
                                  1
                                )
                              : "--"}
                          </strong>
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="status-warning">
                      Aucun QB soumis
                    </p>
                  )}
                </div>
              </div>

              {/* MATCHS */}

              {playerPicks.length === 0 ? (
                <p className="status-warning">
                  Aucun choix de match soumis.
                </p>
              ) : (
                playerPicks.map((pick) => {
                  const game = pick.games;

                  if (!game) return null;

                  const hasScore =
                    game.home_score != null &&
                    game.away_score != null;

                  const realSpread =
                    hasScore
                      ? Math.abs(
                          game.home_score -
                            game.away_score
                        )
                      : null;

                  const realWinner =
                    hasScore
                      ? game.home_score >
                        game.away_score
                        ? game.home_team
                        : game.away_team
                      : null;

                  /*
                   * MATCH TERMINÉ
                   */
                  if (hasScore) {
                    const isMobile =
                      typeof window !==
                        "undefined" &&
                      window.innerWidth < 700;

                    return (
                      <div
                        key={pick.id}
                        style={{
                          padding:
                            "18px 0",
                          borderBottom:
                            "1px solid rgba(148,163,184,0.12)",
                        }}
                      >
                        <GameTimeBar
                          gameDate={
                            game.game_date
                          }
                        />

                        <div
                          style={{
                            display: "grid",

                            gridTemplateColumns:
                              isMobile
                                ? "1fr 100px 1fr"
                                : "80px 130px 80px 1fr",

                            gap: 12,
                            alignItems:
                              "center",

                            justifyItems:
                              isMobile
                                ? "center"
                                : "initial",
                          }}
                        >
                          <TeamLogo
                            logo={getTeamLogo(
                              game.away_team
                            )}
                            name={
                              game.away_team
                            }
                            size={70}
                          />

                          <div
                            style={{
                              fontSize:
                                isMobile
                                  ? 24
                                  : 30,
                              fontWeight:
                                900,
                              textAlign:
                                "center",
                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            {
                              game.away_score
                            }{" "}
                            -{" "}
                            {
                              game.home_score
                            }
                          </div>

                          <TeamLogo
                            logo={getTeamLogo(
                              game.home_team
                            )}
                            name={
                              game.home_team
                            }
                            size={70}
                          />

                          {!isMobile && (
                            <div
                              style={{
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                gap: 12,
                                justifyContent:
                                  "flex-end",
                              }}
                            >
                              <span
                                style={{
                                  fontSize:
                                    26,
                                }}
                              >
                                {getPickBadge(
                                  game,
                                  pick
                                )}
                              </span>

                              <div
                                style={{
                                  textAlign:
                                    "right",
                                }}
                              >
                                <p
                                  style={{
                                    margin:
                                      0,
                                    fontWeight:
                                      800,
                                  }}
                                >
                                  Choix :{" "}
                                  {
                                    pick.picked_team
                                  }{" "}
                                  par{" "}
                                  {
                                    pick.predicted_spread
                                  }
                                </p>

                                <p
                                  style={{
                                    margin:
                                      "4px 0 0 0",
                                    color:
                                      "#94a3b8",
                                  }}
                                >
                                  {
                                    realWinner
                                  }{" "}
                                  par{" "}
                                  {
                                    realSpread
                                  }
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        {isMobile && (
                          <div
                            style={{
                              marginTop:
                                10,
                              display:
                                "flex",
                              alignItems:
                                "center",
                              justifyContent:
                                "center",
                              gap: 10,
                              flexWrap:
                                "wrap",
                              fontSize:
                                14,
                              fontWeight:
                                700,
                              color:
                                "#cbd5e1",
                            }}
                          >
                            <span>
                              {getPickBadge(
                                game,
                                pick
                              )}
                            </span>

                            <span>
                              {
                                pick.picked_team
                              }{" "}
                              par{" "}
                              {
                                pick.predicted_spread
                              }
                            </span>

                            <span
                              style={{
                                color:
                                  "#94a3b8",
                              }}
                            >
                              {
                                realWinner
                              }{" "}
                              par{" "}
                              {
                                realSpread
                              }
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  /*
                   * MATCH SANS SCORE
                   */
                  return (
                    <div
                      key={pick.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "90px 50px 90px 1fr 40px",
                        gap: 12,
                        alignItems:
                          "center",
                        padding:
                          "14px 0",
                        borderBottom:
                          "1px solid rgba(148,163,184,0.12)",
                      }}
                    >
                      <div
                        style={{
                          gridColumn:
                            "1 / -1",
                        }}
                      >
                        <GameTimeBar
                          gameDate={
                            game.game_date
                          }
                        />
                      </div>

                      <div
                        style={{
                          width: 78,
                          height: 78,
                          borderRadius:
                            "50%",
                          background:
                            pick.picked_team ===
                            game.away_team
                              ? "white"
                              : "transparent",
                          display:
                            "flex",
                          alignItems:
                            "center",
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
                          size={66}
                        />
                      </div>

                      <strong
                        style={{
                          textAlign:
                            "center",
                          fontSize: 18,
                        }}
                      >
                        @
                      </strong>

                      <div
                        style={{
                          width: 78,
                          height: 78,
                          borderRadius:
                            "50%",
                          background:
                            pick.picked_team ===
                            game.home_team
                              ? "white"
                              : "transparent",
                          display:
                            "flex",
                          alignItems:
                            "center",
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
                          size={66}
                        />
                      </div>

                      <strong
                        style={{
                          fontSize: 22,
                        }}
                      >
                        par{" "}
                        {
                          pick.predicted_spread
                        }
                      </strong>

                      <span
                        style={{
                          fontSize: 28,
                        }}
                      >
                        ⚪
                      </span>
                    </div>
                  );
                })
              )}
            </section>
          );
        })}

      <BottomNav />
    </main>
  );
}
