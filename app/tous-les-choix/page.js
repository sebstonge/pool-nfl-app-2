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
          fontSize: compact ? 13 : 16,
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
            fontSize: compact ? 10 : 12,
            fontWeight: 400,
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
   HELPERS QB
   ========================================================= */

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function QBPhoto({ qb, size = 64 }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 16,
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
      alt={qb?.name || "QB"}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}

/* =========================================================
   LOGO ÉQUIPE
   ========================================================= */

function TeamLogo({
  logo,
  name,
  size = 66,
}) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          flexShrink: 0,
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
        flexShrink: 0,
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}

/* =========================================================
   MATCHS
   ========================================================= */

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

/* =========================================================
   NAVIGATION DES SEMAINES
   ========================================================= */

function WeekNavigator({
  viewedWeek,
  currentWeek,
  availableWeeks,
  onChange,
}) {
  const index = availableWeeks.indexOf(viewedWeek);

  const previousWeek =
    index > 0
      ? availableWeeks[index - 1]
      : null;

  const nextWeek =
    index >= 0 &&
    index < availableWeeks.length - 1
      ? availableWeeks[index + 1]
      : null;

  return (
    <section
      className="card"
      style={{ padding: 12 }}
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
            cursor:
              previousWeek != null
                ? "pointer"
                : "default",
          }}
        >
          ‹
        </button>

        <div style={{ textAlign: "center" }}>
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
            cursor:
              nextWeek != null
                ? "pointer"
                : "default",
          }}
        >
          ›
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   BLOC QB DE LA SEMAINE
   ========================================================= */

function QbWeekSection({
  qbPicks,
  qbRatings,
  players,
  qbSeasonAverages,
  getTeamLogo,
  isMobile,
}) {
  if (qbPicks.length === 0) {
    return (
      <section className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 26 }}>🏈</span>

          <div>
            <h2
              style={{
                margin: 0,
                color: "#22c55e",
              }}
            >
              QB de la semaine
            </h2>

            <p
              style={{
                margin: "5px 0 0",
                color: "#94a3b8",
              }}
            >
              Aucun QB soumis pour le moment.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              color: "#22c55e",
            }}
          >
            QB de la semaine 🏈
          </h2>

          <p
            style={{
              margin: "5px 0 0",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            {qbPicks.length} sélection
            {qbPicks.length > 1 ? "s" : ""} soumise
            {qbPicks.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "1fr"
            : "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {qbPicks.map((qbPick) => {
          const player = players.find(
            (p) => p.id === qbPick.user_id
          );

          const rating = qbRatings.find(
            (row) => row.qb_id === qbPick.qb_id
          );

          const displayedQb =
            rating?.actual_espn_athlete_id
              ? {
                  name:
                    rating.actual_qb_name ||
                    qbPick.qbs?.name,
                  team: qbPick.qbs?.team,
                  espn_athlete_id:
                    rating.actual_espn_athlete_id,
                }
              : qbPick.qbs;

          const qbWasReplaced =
            rating?.actual_espn_athlete_id &&
            String(
              rating.actual_espn_athlete_id
            ) !==
              String(
                qbPick.qbs?.espn_athlete_id
              );

          const average =
            qbSeasonAverages[
              String(
                rating?.actual_espn_athlete_id ||
                  qbPick.qbs?.espn_athlete_id
              )
            ];

          return (
            <div
              key={qbPick.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "64px minmax(0,1fr)",
                gap: 12,
                alignItems: "center",
                padding: 12,
                borderRadius: 16,
                background:
                  "rgba(15,23,42,0.72)",
                border:
                  "1px solid rgba(148,163,184,0.13)",
                minWidth: 0,
              }}
            >
              <QBPhoto
                qb={displayedQb}
                size={64}
              />

              <div style={{ minWidth: 0 }}>
                <PlayerIdentity
                  player={player}
                  compact={true}
                />

                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop:
                      "1px solid rgba(148,163,184,0.10)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <strong
                      style={{
                        color: "#f8fafc",
                        fontSize: 14,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayedQb?.name || "QB"}
                    </strong>

                    <TeamLogo
                      logo={getTeamLogo(
                        displayedQb?.team
                      )}
                      name={displayedQb?.team}
                      size={24}
                    />
                  </div>

                  {qbWasReplaced && (
                    <div
                      style={{
                        marginTop: 4,
                        color: "#facc15",
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      🔄 Remplacement automatique
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                      marginTop: 5,
                      color: "#94a3b8",
                      fontSize: 11,
                    }}
                  >
                    {rating?.passer_rating != null && (
                      <>
                        <span>Rating</span>

                        <strong
                          style={{
                            color: ratingColor(
                              rating.passer_rating
                            ),
                          }}
                        >
                          {Number(
                            rating.passer_rating
                          ).toFixed(1)}
                        </strong>

                        <span>·</span>
                      </>
                    )}

                    <span>Moy.</span>

                    <strong
                      style={{
                        color:
                          average != null
                            ? ratingColor(average)
                            : "#cbd5e1",
                      }}
                    >
                      {average != null
                        ? average.toFixed(1)
                        : "--"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* =========================================================
   CARTE D'UN MATCH
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

  const awayCount = gamePicks.filter(
    (pick) =>
      pick.picked_team === game.away_team
  ).length;

  const homeCount = gamePicks.filter(
    (pick) =>
      pick.picked_team === game.home_team
  ).length;

  /*
   * IMPORTANT :
   * premier choix soumis = premier affiché.
   *
   * Les picks sont enregistrés avec updated_at.
   * On trie donc du plus ancien au plus récent.
   */
  const sortedPicks = [...gamePicks].sort(
    (a, b) =>
      new Date(
        a.updated_at || 0
      ).getTime() -
      new Date(
        b.updated_at || 0
      ).getTime()
  );

  return (
    <section className="card">
      <GameTimeBar
        gameDate={game.game_date}
      />

      {/* ================= MATCH ================= */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0,1fr) auto minmax(0,1fr)",
          gap: isMobile ? 8 : 18,
          alignItems: "center",
          marginTop: 16,
        }}
      >
        {/* VISITEUR */}

        <div
          style={{
            textAlign: "center",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
            }}
          >
            <TeamLogo
              logo={getTeamLogo(
                game.away_team
              )}
              name={game.away_team}
              size={isMobile ? 62 : 82}
            />
          </div>

          <strong
            style={{
              display: "block",
              marginTop: 7,
              color: "#f8fafc",
              fontSize: isMobile ? 13 : 16,
              lineHeight: 1.15,
            }}
          >
            {game.away_team}
          </strong>
        </div>

        {/* CENTRE */}

        <div
          style={{
            textAlign: "center",
            minWidth: isMobile ? 62 : 100,
          }}
        >
          {hasScore ? (
            <>
              <strong
                style={{
                  display: "block",
                  color: "#f8fafc",
                  fontSize: isMobile ? 22 : 30,
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                }}
              >
                {game.away_score} - {game.home_score}
              </strong>

              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                FINAL
              </span>
            </>
          ) : (
            <strong
              style={{
                color: "#94a3b8",
                fontSize: isMobile ? 20 : 26,
              }}
            >
              @
            </strong>
          )}
        </div>

        {/* DOMICILE */}

        <div
          style={{
            textAlign: "center",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
            }}
          >
            <TeamLogo
              logo={getTeamLogo(
                game.home_team
              )}
              name={game.home_team}
              size={isMobile ? 62 : 82}
            />
          </div>

          <strong
            style={{
              display: "block",
              marginTop: 7,
              color: "#f8fafc",
              fontSize: isMobile ? 13 : 16,
              lineHeight: 1.15,
            }}
          >
            {game.home_team}
          </strong>
        </div>
      </div>

      {/* ================= CONSENSUS DISCRET ================= */}

      {gamePicks.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 16,
            padding: "8px 10px",
            borderRadius: 12,
            background:
              "rgba(148,163,184,0.06)",
            border:
              "1px solid rgba(148,163,184,0.10)",
            color: "#94a3b8",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          <span
            style={{
              color: "#64748b",
            }}
          >
            Choix du pool
          </span>

          <span>·</span>

          <span>
            {awayCount} {game.away_team}
          </span>

          <span>·</span>

          <span>
            {homeCount} {game.home_team}
          </span>
        </div>
      )}

      <div
        style={{
          height: 1,
          background:
            "rgba(148,163,184,0.12)",
          margin: "18px 0 4px",
        }}
      />

      {/* ================= PICKS ================= */}

      {sortedPicks.length === 0 ? (
        <p
          style={{
            margin: "14px 0 4px",
            color: "#64748b",
            textAlign: "center",
            fontSize: 13,
          }}
        >
          Aucun choix soumis pour ce match.
        </p>
      ) : (
        <div>
          {sortedPicks.map(
            (pick, index) => {
              const player = players.find(
                (p) =>
                  p.id === pick.user_id
              );

              const pickedAway =
                pick.picked_team ===
                game.away_team;

              return (
                <div
                  key={pick.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "minmax(0,1fr) auto"
                      : "minmax(180px,1fr) minmax(180px,1fr) 40px",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 2px",
                    borderBottom:
                      index <
                      sortedPicks.length - 1
                        ? "1px solid rgba(148,163,184,0.08)"
                        : "none",
                  }}
                >
                  {/* JOUEUR */}

                  <PlayerIdentity
                    player={player}
                    compact={isMobile}
                  />

                  {/* PICK */}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        isMobile
                          ? "flex-end"
                          : "flex-start",
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
                      size={isMobile ? 28 : 34}
                    />

                    <strong
                      style={{
                        color: "#f8fafc",
                        fontSize: isMobile
                          ? 13
                          : 15,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pick.picked_team} par{" "}
                      {pick.predicted_spread}
                    </strong>
                  </div>

                  {/* RÉSULTAT */}

                  {!isMobile && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 22,
                      }}
                    >
                      {getPickBadge(
                        game,
                        pick
                      )}
                    </div>
                  )}

                  {isMobile && (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        marginTop: -4,
                        color: "#64748b",
                        fontSize: 11,
                      }}
                    >
                      <span>
                        {getPickBadge(
                          game,
                          pick
                        )}
                      </span>

                      <span>
                        {pickedAway
                          ? "Visiteur"
                          : "Domicile"}
                      </span>
                    </div>
                  )}
                </div>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function TousLesChoix() {
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
  const [qbRatings, setQbRatings] = useState([]);
  const [teams, setTeams] = useState([]);
  const [weekGames, setWeekGames] = useState([]);

  const [currentWeek, setCurrentWeek] =
    useState(null);

  const [viewedWeek, setViewedWeek] =
    useState(null);

  const [availableWeeks, setAvailableWeeks] =
    useState([]);

  const [
    qbSeasonAverages,
    setQbSeasonAverages,
  ] = useState({});

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [isMobile, setIsMobile] =
    useState(false);

  /* =========================================================
     MOBILE
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
     DONNÉES GÉNÉRALES
     ========================================================= */

  useEffect(() => {
    async function loadBaseData() {
      setLoading(true);

      const { data: settingsData } =
        await supabase
          .from("settings")
          .select("*")
          .single();

      const activeWeek =
        settingsData?.current_week || 1;

      setCurrentWeek(activeWeek);
      setViewedWeek(activeWeek);

      const { data: teamsData } =
        await supabase
          .from("teams")
          .select("*");

      setTeams(teamsData || []);

      const { data: usersData } =
        await supabase
          .from("users")
          .select(
            "id, email, display_name, real_name"
          );

      setPlayers(usersData || []);

      const { data: weeksData } =
        await supabase
          .from("games")
          .select("week")
          .eq("is_pool_eligible", true);

      const weeks = Array.from(
        new Set(
          (weeksData || [])
            .map((game) =>
              Number(game.week)
            )
            .filter(
              (week) =>
                Number.isFinite(week) &&
                week <= activeWeek
            )
        )
      ).sort((a, b) => a - b);

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
     DONNÉES DE LA SEMAINE CONSULTÉE
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

      /* ---------------- MATCHS ---------------- */

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
        .eq("week", viewedWeek)
        .eq("is_pool_eligible", true)
        .order("game_date", {
          ascending: true,
        });

      if (gamesError) {
        setMessage(
          "Erreur matchs : " +
            gamesError.message
        );

        setLoading(false);
        return;
      }

      setWeekGames(gamesData || []);

      /* ---------------- PICKS ---------------- */

      const gameIds = (gamesData || []).map(
        (game) => game.id
      );

      let picksData = [];

      if (gameIds.length > 0) {
        const {
          data,
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

        picksData = data || [];
      }

      setPicks(picksData);

      /* ---------------- QB PICKS ---------------- */

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
        .eq("week", viewedWeek)
        .order("created_at", {
          ascending: true,
        });

      if (qbError) {
        setMessage(
          "Erreur QB : " +
            qbError.message
        );

        setLoading(false);
        return;
      }

      setQbPicks(qbData || []);

      /* ---------------- QB RATINGS ---------------- */

      const {
        data: ratingsData,
        error: ratingsError,
      } = await supabase
        .from("qb_ratings")
        .select("*")
        .eq("week", viewedWeek);

      if (ratingsError) {
        setMessage(
          "Erreur ratings : " +
            ratingsError.message
        );

        setLoading(false);
        return;
      }

      setQbRatings(ratingsData || []);

      /* ---------------- MOYENNES QB ---------------- */

      const { data: allRatings } =
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

      const averages = {};

      (allRatings || []).forEach(
        (row) => {
          if (
            row.passer_rating == null
          ) {
            return;
          }

          const athleteId =
            row.actual_espn_athlete_id ||
            row.qbs?.espn_athlete_id;

          if (!athleteId) return;

          const key =
            String(athleteId);

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
        }
      );

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
  }, [
    viewedWeek,
    currentWeek,
  ]);

  /* =========================================================
     LOGOS
     ========================================================= */

  const getTeamLogo = (teamName) => {
    const team = teams.find(
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
      : team?.logo || null;
  };

  /* =========================================================
     AFFICHAGE
     ========================================================= */

  return (
    <main className="page">
      {/* ================= HEADER ================= */}

      <section className="header-card">
        <h1>
          Tous les choix 👀
        </h1>

        <p>
          Compare les choix du pool, match par match.
        </p>
      </section>

      {/* ================= NAVIGATION ================= */}

      {currentWeek != null &&
        viewedWeek != null && (
          <WeekNavigator
            viewedWeek={viewedWeek}
            currentWeek={currentWeek}
            availableWeeks={availableWeeks}
            onChange={setViewedWeek}
          />
        )}

      {/* ================= MESSAGE ================= */}

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {/* ================= LOADING ================= */}

      {loading && (
        <section className="card">
          <p>
            Chargement des choix...
          </p>
        </section>
      )}

      {/* ================= CONTENU ================= */}

      {!loading && (
        <>
          {/* QB EN PREMIER */}

          <QbWeekSection
            qbPicks={qbPicks}
            qbRatings={qbRatings}
            players={players}
            qbSeasonAverages={
              qbSeasonAverages
            }
            getTeamLogo={getTeamLogo}
            isMobile={isMobile}
          />

          {/* MATCHS */}

          {weekGames.length === 0 ? (
            <section className="card">
              <p
                style={{
                  margin: 0,
                  color: "#94a3b8",
                }}
              >
                Aucun match du pool pour cette semaine.
              </p>
            </section>
          ) : (
            weekGames.map((game) => {
              const gamePicks =
                picks.filter(
                  (pick) =>
                    pick.game_id ===
                    game.id
                );

              return (
                <GamePicksCard
                  key={game.id}
                  game={game}
                  gamePicks={gamePicks}
                  players={players}
                  getTeamLogo={
                    getTeamLogo
                  }
                  isMobile={isMobile}
                />
              );
            })
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}
