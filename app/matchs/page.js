"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

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
        flexShrink: 0,
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

function QBPhoto({ qb }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  const isMobile =
    typeof window !== "undefined" &&
    window.innerWidth < 700;

  const imageSize = isMobile ? 108 : 140;
  const fallbackSize = isMobile ? 100 : 120;

  if (!src || error) {
    return (
      <div
        style={{
          width: fallbackSize,
          height: fallbackSize,
          borderRadius: isMobile ? 20 : 24,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: isMobile ? 24 : 28,
          margin: isMobile ? "0 auto" : 0,
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
        width: imageSize,
        height: imageSize,
        objectFit: "contain",
        display: "block",
        margin: isMobile ? "0 auto" : 0,
      }}
    />
  );
}

export default function Matchs() {
  const [user, setUser] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);

  const [games, setGames] = useState([]);
  const [teams, setTeams] = useState([]);
  const [qbs, setQbs] = useState([]);

  const [availableQbs, setAvailableQbs] = useState([]);
  const [selectedQbId, setSelectedQbId] = useState("");
  const [qbMenuOpen, setQbMenuOpen] = useState(false);

  const [existingQbPick, setExistingQbPick] = useState(null);
  const [qbRating, setQbRating] = useState(null);

  const [savedPicks, setSavedPicks] = useState({});
  const [draftPicks, setDraftPicks] = useState({});

  const [message, setMessage] = useState("");

  const [qbSeasonAverages, setQbSeasonAverages] =
    useState({});

  async function loadData() {
    const { data: sessionData } =
      await supabase.auth.getSession();

    const currentUser =
      sessionData.session?.user ?? null;

    setUser(currentUser);

    const { data: settingsData } =
      await supabase
        .from("settings")
        .select("*")
        .single();

    const week =
      settingsData?.current_week || 1;

    setCurrentWeek(week);

    const { data: teamsData } =
      await supabase
        .from("teams")
        .select("*");

    setTeams(teamsData || []);

    const { data: gamesData } =
      await supabase
        .from("games")
        .select("*")
        .eq("is_pool_eligible", true)
        .eq("week", week)
        .order("game_date", {
          ascending: true,
        });

    setGames(gamesData || []);

    const { data: qbsData } =
      await supabase
        .from("qbs")
        .select("*")
        .eq("active", true)
        .eq("is_active_starter", true)
        .order("name", {
          ascending: true,
        });

    setQbs(qbsData || []);

    if (!currentUser) return;

    const { data: picksData } =
      await supabase
        .from("picks")
        .select("*")
        .eq("user_id", currentUser.id);

    const picksByGame = {};

    (picksData || []).forEach((pick) => {
      picksByGame[pick.game_id] = pick;
    });

    setSavedPicks(picksByGame);

    const { data: myQbPick } =
      await supabase
        .from("qb_picks")
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
        .eq("user_id", currentUser.id)
        .eq("week", week)
        .maybeSingle();

    setExistingQbPick(myQbPick || null);

    if (myQbPick?.qb_id) {
      const { data: ratingData } =
        await supabase
          .from("qb_ratings")
          .select("*")
          .eq("qb_id", myQbPick.qb_id)
          .eq("week", week)
          .maybeSingle();

      setQbRating(ratingData || null);
    } else {
      setQbRating(null);
    }

    const { data: allRatings } =
      await supabase
        .from("qb_ratings")
        .select(`
          qb_id,
          passer_rating,
          actual_espn_athlete_id,
          qbs (
            espn_athlete_id
          )
        `);

    const averages = {};

    (allRatings || []).forEach((row) => {
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
        row.passer_rating || 0
      );

      averages[key].count += 1;
    });

    const formatted = {};

    Object.keys(averages).forEach((athleteId) => {
      formatted[athleteId] =
        averages[athleteId].total /
        averages[athleteId].count;
    });

    setQbSeasonAverages(formatted);

    const { data: takenThisWeek } =
      await supabase
        .from("qb_picks")
        .select("qb_id")
        .eq("week", week);

    const { data: myHistory } =
      await supabase
        .from("qb_history")
        .select("qb_id")
        .eq("user_id", currentUser.id);

    const takenIds = (
      takenThisWeek || []
    ).map((q) => q.qb_id);

    const usedIds = (
      myHistory || []
    ).map((q) => q.qb_id);

    setAvailableQbs(
      (qbsData || []).filter(
        (qb) =>
          !takenIds.includes(qb.id) &&
          !usedIds.includes(qb.id)
      )
    );
  }

  useEffect(() => {
    loadData();
  }, []);

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

  const selectedQb = qbs.find(
    (qb) => qb.id === selectedQbId
  );

  const displayedQb =
    qbRating?.actual_espn_athlete_id
      ? {
          name:
            qbRating.actual_qb_name ||
            existingQbPick?.qbs?.name,
          team:
            existingQbPick?.qbs?.team,
          espn_athlete_id:
            qbRating.actual_espn_athlete_id,
        }
      : existingQbPick?.qbs;

  const displayedQbAverage =
    qbSeasonAverages[
      String(
        qbRating?.actual_espn_athlete_id ||
          existingQbPick?.qbs?.espn_athlete_id
      )
    ];

  const updateDraftPick = (
    gameId,
    field,
    value
  ) => {
    setDraftPicks((prev) => ({
      ...prev,
      [gameId]: {
        ...prev[gameId],
        [field]: value,
      },
    }));
  };

  const submitEverything = async () => {
    if (!user) {
      setMessage(
        "Connecte-toi avant de soumettre."
      );
      return;
    }

    const gamesToPick = games.filter(
      (game) => !savedPicks[game.id]
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

    for (const game of gamesToPick) {
      const pick =
        draftPicks[game.id];

      if (
        !pick?.picked_team ||
        pick.predicted_spread === undefined ||
        pick.predicted_spread === ""
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

    if (!confirmation) return;

    if (!existingQbPick) {
      const { error: qbError } =
        await supabase
          .from("qb_picks")
          .insert({
            user_id: user.id,
            week: currentWeek,
            qb_id: selectedQbId,
          });

      if (qbError) {
        setMessage(
          "Erreur QB : " +
            qbError.message
        );
        return;
      }

      await supabase
        .from("qb_history")
        .insert({
          user_id: user.id,
          qb_id: selectedQbId,
        });
    }

    const pickRows = gamesToPick.map(
      (game) => ({
        user_id: user.id,
        game_id: game.id,
        picked_team:
          draftPicks[game.id]
            .picked_team,
        predicted_spread:
          Number(
            draftPicks[game.id]
              .predicted_spread
          ),
        updated_at:
          new Date().toISOString(),
      })
    );

    if (pickRows.length > 0) {
      const { error: picksError } =
        await supabase
          .from("picks")
          .upsert(pickRows, {
            onConflict:
              "user_id,game_id",
          });

      if (picksError) {
        setMessage(
          "Erreur choix : " +
            picksError.message
        );
        return;
      }
    }

    setMessage("Choix soumis ✅");

    await loadData();
  };

  const gamesToPick =
    games.filter(
      (game) =>
        !savedPicks[game.id]
    );

  const submittedGames =
    games.filter(
      (game) =>
        savedPicks[game.id]
    );

  const isMobile =
    typeof window !== "undefined" &&
    window.innerWidth < 700;

  return (
    <main className="page">
      <section className="header-card">
        <h1>Mes choix ✅</h1>

        <p>
          Semaine{" "}
          {currentWeek || "..."}
        </p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {/* QB */}

      <section className="card">
        {existingQbPick ? (
          <>
            <h2
              style={{
                color: "#22c55e",
              }}
            >
              QB soumis ✅
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  isMobile
                    ? "1fr"
                    : "150px 1fr",
                gap: isMobile
                  ? 12
                  : 18,
                alignItems: "center",
                textAlign: isMobile
                  ? "center"
                  : "left",
              }}
            >
              <QBPhoto
                qb={displayedQb}
              />

              <div
                style={{
                  minWidth: 0,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  {displayedQb?.name}
                </h2>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      isMobile
                        ? "center"
                        : "flex-start",
                    gap: 8,
                    marginTop: 6,
                    marginBottom: 6,
                  }}
                >
                  <TeamLogo
                    logo={getTeamLogo(
                      displayedQb?.team
                    )}
                    name={
                      displayedQb?.team
                    }
                    size={38}
                    plain={true}
                  />

                  <strong
                    style={{
                      color: "#94a3b8",
                      fontSize: 16,
                    }}
                  >
                    {displayedQb?.team}
                  </strong>
                </div>

                {qbRating?.actual_espn_athlete_id &&
                  String(
                    qbRating.actual_espn_athlete_id
                  ) !==
                    String(
                      existingQbPick
                        ?.qbs
                        ?.espn_athlete_id
                    ) && (
                    <p
                      style={{
                        margin:
                          "4px 0",
                        color:
                          "#facc15",
                        fontSize:
                          13,
                        fontWeight:
                          800,
                      }}
                    >
                      🔄 QB utilisé automatiquement
                    </p>
                  )}

                {qbRating?.passer_rating != null ? (
                  <p
                    style={{
                      fontSize:
                        isMobile
                          ? 15
                          : 22,
                      lineHeight:
                        1.5,
                      margin:
                        isMobile
                          ? "10px 0 0"
                          : undefined,
                    }}
                  >
                    Passer Rating :{" "}
                    <strong
                      style={{
                        color:
                          ratingColor(
                            qbRating.passer_rating
                          ),
                      }}
                    >
                      {Number(
                        qbRating.passer_rating
                      ).toFixed(1)}
                    </strong>

                    {isMobile ? (
                      <br />
                    ) : (
                      " — "
                    )}

                    Moyenne saison :{" "}
                    <strong
                      style={{
                        color:
                          "#cbd5e1",
                      }}
                    >
                      {displayedQbAverage != null
                        ? displayedQbAverage.toFixed(
                            1
                          )
                        : "--"}
                    </strong>
                  </p>
                ) : (
                  <p
                    style={{
                      color:
                        "#94a3b8",
                      fontSize:
                        isMobile
                          ? 15
                          : 18,
                    }}
                  >
                    Moyenne saison :{" "}
                    <strong
                      style={{
                        color:
                          "#cbd5e1",
                      }}
                    >
                      {displayedQbAverage != null
                        ? displayedQbAverage.toFixed(
                            1
                          )
                        : "--"}
                    </strong>
                  </p>
                )}
              </div>
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
                gridTemplateColumns:
                  isMobile
                    ? "1fr"
                    : "1fr 160px",
                gap: 18,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    position:
                      "relative",
                    minWidth: 0,
                  }}
                >
                  <button
                    type="button"
                    className="input"
                    onClick={() =>
                      setQbMenuOpen(
                        (prev) =>
                          !prev
                      )
                    }
                    style={{
                      width: "100%",
                      minWidth: 0,
                      display: "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "space-between",
                      cursor:
                        "pointer",
                      textAlign:
                        "left",
                      overflow:
                        "hidden",
                    }}
                  >
                    {selectedQb ? (
                      <span
                        style={{
                          display:
                            "flex",
                          alignItems:
                            "center",
                          gap: 8,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <strong
                          style={{
                            minWidth: 0,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                            fontSize:
                              isMobile
                                ? 14
                                : 16,
                          }}
                        >
                          {selectedQb.name}
                        </strong>

                        <img
                          src={getTeamLogo(
                            selectedQb.team
                          )}
                          alt={
                            selectedQb.team
                          }
                          style={{
                            width:
                              isMobile
                                ? 24
                                : 28,
                            height:
                              isMobile
                                ? 24
                                : 28,
                            objectFit:
                              "contain",
                            flexShrink: 0,
                          }}
                        />

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
                      </span>
                    ) : (
                      <span
                        style={{
                          minWidth: 0,
                          overflow:
                            "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        -- Sélectionner un QB --
                      </span>
                    )}

                    <span
                      style={{
                        marginLeft:
                          10,
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
                        position:
                          "absolute",
                        top:
                          "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        maxHeight:
                          isMobile
                            ? 330
                            : 360,
                        overflowY:
                          "auto",
                        borderRadius:
                          16,
                        background:
                          "#0f172a",
                        border:
                          "1px solid rgba(148,163,184,0.22)",
                        boxShadow:
                          "0 18px 40px rgba(0,0,0,0.35)",
                      }}
                    >
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
                              key={
                                qb.id
                              }
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
                                width:
                                  "100%",
                                minWidth: 0,
                                display:
                                  "grid",
                                gridTemplateColumns:
                                  "minmax(0, 1fr) 28px auto",
                                alignItems:
                                  "center",
                                padding:
                                  isMobile
                                    ? "11px 10px"
                                    : "12px 14px",
                                gap:
                                  isMobile
                                    ? 6
                                    : 8,
                                background:
                                  selectedQbId ===
                                  qb.id
                                    ? "rgba(34,197,94,0.12)"
                                    : "transparent",
                                border:
                                  "none",
                                borderBottom:
                                  "1px solid rgba(148,163,184,0.10)",
                                color:
                                  "#f8fafc",
                                cursor:
                                  "pointer",
                                textAlign:
                                  "left",
                              }}
                            >
                              <strong
                                style={{
                                  minWidth:
                                    0,
                                  overflow:
                                    "hidden",
                                  textOverflow:
                                    "ellipsis",
                                  whiteSpace:
                                    "nowrap",
                                  fontSize:
                                    isMobile
                                      ? 14
                                      : 16,
                                  lineHeight:
                                    1.15,
                                }}
                              >
                                {qb.name}
                              </strong>

                              <img
                                src={getTeamLogo(
                                  qb.team
                                )}
                                alt={
                                  qb.team
                                }
                                style={{
                                  width:
                                    isMobile
                                      ? 24
                                      : 28,
                                  height:
                                    isMobile
                                      ? 24
                                      : 28,
                                  objectFit:
                                    "contain",
                                }}
                              />

                              <span
                                style={{
                                  color:
                                    "#94a3b8",
                                  whiteSpace:
                                    "nowrap",
                                  fontSize:
                                    isMobile
                                      ? 12
                                      : 14,
                                }}
                              >
                                Moy.{" "}
                                {average !=
                                null
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

                <div
                  style={{
                    marginTop: 12,
                    padding: 14,
                    borderRadius: 18,
                    background:
                      "rgba(34,197,94,0.08)",
                    border:
                      "1px solid rgba(34,197,94,0.20)",
                    color:
                      "#cbd5e1",
                    fontSize:
                      isMobile
                        ? 14
                        : undefined,
                    lineHeight:
                      1.45,
                  }}
                >
                  ✅ Un QB ne peut être choisi qu’une seule fois par semaine et ne peut pas être réutilisé.
                </div>
              </div>

              <div
                style={{
                  textAlign:
                    "center",
                  paddingTop:
                    isMobile
                      ? 4
                      : 0,
                }}
              >
                {selectedQb ? (
                  <QBPhoto
                    qb={selectedQb}
                  />
                ) : (
                  <div
                    style={{
                      color:
                        "#94a3b8",
                      padding:
                        isMobile
                          ? "8px 0"
                          : 0,
                    }}
                  >
                    Aucun QB
                  </div>
                )}

                {selectedQb && (
                  <p
                    style={{
                      margin:
                        "6px 0 0",
                      fontWeight:
                        800,
                      fontSize:
                        isMobile
                          ? 14
                          : undefined,
                    }}
                  >
                    {selectedQb.team}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* MATCHS À CHOISIR */}

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
                      ? "1fr 40px 1fr 74px"
                      : "1fr 70px 1fr 120px",
                  alignItems: "center",
                  gap: 12,
                  padding: "24px 0",
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
                    background:
                      "transparent",
                    border: "none",
                    display: "flex",
                    justifyContent:
                      "center",
                    alignItems:
                      "center",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(
                      game.away_team
                    )}
                    alt={
                      game.away_team
                    }
                    style={{
                      width:
                        isMobile
                          ? 70
                          : 96,
                      height:
                        isMobile
                          ? 70
                          : 96,
                      objectFit:
                        "contain",
                      opacity:
                        awaySelected
                          ? 1
                          : 0.82,
                      transform:
                        awaySelected
                          ? "scale(1.08)"
                          : "scale(1)",
                      transition:
                        "0.2s ease",
                      filter:
                        awaySelected
                          ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                          : "none",
                    }}
                  />
                </button>

                <div
                  style={{
                    textAlign:
                      "center",
                    fontSize:
                      isMobile
                        ? 24
                        : 34,
                    fontWeight: 900,
                    color: "#ffffff",
                  }}
                >
                  @
                </div>

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
                    background:
                      "transparent",
                    border: "none",
                    display: "flex",
                    justifyContent:
                      "center",
                    alignItems:
                      "center",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(
                      game.home_team
                    )}
                    alt={
                      game.home_team
                    }
                    style={{
                      width:
                        isMobile
                          ? 70
                          : 96,
                      height:
                        isMobile
                          ? 70
                          : 96,
                      objectFit:
                        "contain",
                      opacity:
                        homeSelected
                          ? 1
                          : 0.82,
                      transform:
                        homeSelected
                          ? "scale(1.08)"
                          : "scale(1)",
                      transition:
                        "0.2s ease",
                      filter:
                        homeSelected
                          ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                          : "none",
                    }}
                  />
                </button>

                <div
                  style={{
                    display: "flex",
                    flexDirection:
                      "column",
                    alignItems:
                      "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize:
                        isMobile
                          ? 14
                          : 16,
                      color:
                        "#cbd5e1",
                      textAlign:
                        "center",
                    }}
                  >
                    Écart prédit
                  </span>

                  <input
                    type="number"
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
                      width:
                        isMobile
                          ? 54
                          : 72,
                      height:
                        isMobile
                          ? 54
                          : 72,
                      borderRadius:
                        18,
                      border:
                        "2px solid rgba(148,163,184,0.18)",
                      background:
                        "rgba(2,6,23,0.75)",
                      color:
                        "#ffffff",
                      fontSize:
                        isMobile
                          ? 18
                          : 24,
                      fontWeight: 800,
                      textAlign:
                        "center",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* SOUMISSION */}

      {(gamesToPick.length > 0 ||
        !existingQbPick) && (
        <section className="card">
          <button
            className="button"
            onClick={submitEverything}
            style={{
              width: "100%",
              fontSize:
                isMobile
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
            🔒 Tu ne pourras plus modifier après la soumission.
          </p>
        </section>
      )}

      {/* MATCHS SOUMIS */}

      {submittedGames.length > 0 && (
        <section className="card">
          <h2
            style={{
              color: "#22c55e",
            }}
          >
            Tes choix de matchs ✅
          </h2>

          {submittedGames.map((game) => {
            const pick =
              savedPicks[game.id];

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

            if (hasScore) {
              return (
                <div
                  key={game.id}
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
                      display:
                        "grid",
                      gridTemplateColumns:
                        isMobile
                          ? "1fr 100px 1fr"
                          : "80px 130px 80px 1fr",
                      gap: 12,
                      alignItems:
                        "center",
                      justifyItems:
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
                      size={70}
                      plain={true}
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
                      {game.away_score} - {game.home_score}
                    </div>

                    <TeamLogo
                      logo={getTeamLogo(
                        game.home_team
                      )}
                      name={
                        game.home_team
                      }
                      size={70}
                      plain={true}
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
                            {pick.picked_team} par{" "}
                            {pick.predicted_spread}
                          </p>

                          <p
                            style={{
                              margin:
                                "4px 0 0 0",
                              color:
                                "#94a3b8",
                            }}
                          >
                            {realWinner} par {realSpread}
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
                        {pick.picked_team} par{" "}
                        {pick.predicted_spread}
                      </span>

                      <span
                        style={{
                          color:
                            "#94a3b8",
                        }}
                      >
                        {realWinner} par {realSpread}
                      </span>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={game.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    isMobile
                      ? "1fr 40px 1fr 65px"
                      : "90px 50px 90px 1fr 40px",
                  gap: isMobile
                    ? 8
                    : 12,
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

                <TeamLogo
                  logo={getTeamLogo(
                    game.away_team
                  )}
                  name={
                    game.away_team
                  }
                  selected={
                    pick.picked_team ===
                    game.away_team
                  }
                  size={
                    isMobile
                      ? 64
                      : 78
                  }
                />

                <strong
                  style={{
                    textAlign:
                      "center",
                    fontSize: 18,
                  }}
                >
                  @
                </strong>

                <TeamLogo
                  logo={getTeamLogo(
                    game.home_team
                  )}
                  name={
                    game.home_team
                  }
                  selected={
                    pick.picked_team ===
                    game.home_team
                  }
                  size={
                    isMobile
                      ? 64
                      : 78
                  }
                />

                <strong
                  style={{
                    fontSize:
                      isMobile
                        ? 17
                        : 22,
                    whiteSpace:
                      "nowrap",
                  }}
                >
                  par {pick.predicted_spread}
                </strong>

                {!isMobile && (
                  <span
                    style={{
                      fontSize:
                        28,
                    }}
                  >
                    ⚪
                  </span>
                )}
              </div>
            );
          })}

          <p
            style={{
              color: "#94a3b8",
            }}
          >
            🔒 Choix soumis pour la semaine {currentWeek}.
          </p>
        </section>
      )}

      <BottomNav />
    </main>
  );
}
