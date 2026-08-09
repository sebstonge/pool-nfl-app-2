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

  const realSpread = Math.abs(game.home_score - game.away_score);

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

function QBPhoto({ qb, mobile = false }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  const size = mobile ? 105 : 140;

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 24,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: mobile ? 22 : 28,
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

  const [qbSeasonAverages, setQbSeasonAverages] = useState({});

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const updateMobile = () => {
      setIsMobile(window.innerWidth < 700);
    };

    updateMobile();

    window.addEventListener("resize", updateMobile);

    return () => {
      window.removeEventListener("resize", updateMobile);
    };
  }, []);

  async function loadData() {
    const { data: sessionData } = await supabase.auth.getSession();

    const currentUser = sessionData.session?.user ?? null;

    setUser(currentUser);

    const { data: settingsData } = await supabase
      .from("settings")
      .select("*")
      .single();

    const week = settingsData?.current_week || 1;

    setCurrentWeek(week);

    const { data: teamsData } = await supabase
      .from("teams")
      .select("*");

    setTeams(teamsData || []);

    const { data: gamesData } = await supabase
      .from("games")
      .select("*")
      .eq("is_pool_eligible", true)
      .eq("week", week)
      .order("game_date", {
        ascending: true,
      });

    setGames(gamesData || []);

    const { data: qbsData } = await supabase
      .from("qbs")
      .select("*")
      .eq("active", true)
      .eq("is_active_starter", true)
      .order("name", {
        ascending: true,
      });

    setQbs(qbsData || []);

    if (!currentUser) return;

    const { data: picksData } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", currentUser.id);

    const picksByGame = {};

    (picksData || []).forEach((pick) => {
      picksByGame[pick.game_id] = pick;
    });

    setSavedPicks(picksByGame);

    const { data: myQbPick } = await supabase
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
      const { data: ratingData } = await supabase
        .from("qb_ratings")
        .select("*")
        .eq("qb_id", myQbPick.qb_id)
        .eq("week", week)
        .maybeSingle();

      setQbRating(ratingData || null);
    } else {
      setQbRating(null);
    }

    const { data: allRatings } = await supabase
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

      averages[key].total += Number(row.passer_rating || 0);
      averages[key].count += 1;
    });

    const formatted = {};

    Object.keys(averages).forEach((athleteId) => {
      formatted[athleteId] =
        averages[athleteId].total /
        averages[athleteId].count;
    });

    setQbSeasonAverages(formatted);

    const { data: takenThisWeek } = await supabase
      .from("qb_picks")
      .select("qb_id")
      .eq("week", week);

    const { data: myHistory } = await supabase
      .from("qb_history")
      .select("qb_id")
      .eq("user_id", currentUser.id);

    const takenIds = (takenThisWeek || []).map((q) => q.qb_id);
    const usedIds = (myHistory || []).map((q) => q.qb_id);

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
          team: existingQbPick?.qbs?.team,
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

  const updateDraftPick = (gameId, field, value) => {
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
      setMessage("Connecte-toi avant de soumettre.");
      return;
    }

    const gamesToPick = games.filter(
      (game) => !savedPicks[game.id]
    );

    if (!existingQbPick && !selectedQbId) {
      setMessage("Choisis un QB avant de soumettre.");
      return;
    }

    for (const game of gamesToPick) {
      const pick = draftPicks[game.id];

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

    const confirmation = window.confirm(
      "Confirmer la soumission? Le choix de QB est irréversible."
    );

    if (!confirmation) return;

    if (!existingQbPick) {
      const { error: qbError } = await supabase
        .from("qb_picks")
        .insert({
          user_id: user.id,
          week: currentWeek,
          qb_id: selectedQbId,
        });

      if (qbError) {
        setMessage("Erreur QB : " + qbError.message);
        return;
      }

      await supabase.from("qb_history").insert({
        user_id: user.id,
        qb_id: selectedQbId,
      });
    }

    const pickRows = gamesToPick.map((game) => ({
      user_id: user.id,
      game_id: game.id,
      picked_team: draftPicks[game.id].picked_team,
      predicted_spread: Number(
        draftPicks[game.id].predicted_spread
      ),
      updated_at: new Date().toISOString(),
    }));

    if (pickRows.length > 0) {
      const { error: picksError } = await supabase
        .from("picks")
        .upsert(pickRows, {
          onConflict: "user_id,game_id",
        });

      if (picksError) {
        setMessage("Erreur choix : " + picksError.message);
        return;
      }
    }

    setMessage("Choix soumis ✅");

    await loadData();
  };

  const gamesToPick = games.filter(
    (game) => !savedPicks[game.id]
  );

  const submittedGames = games.filter(
    (game) => savedPicks[game.id]
  );

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

      {/* ================= QB ================= */}

      <section className="card">
        {existingQbPick ? (
          <>
            <h2 style={{ color: "#22c55e" }}>
              QB soumis ✅
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "105px minmax(0, 1fr)"
                  : "150px minmax(0, 1fr)",
                gap: isMobile ? 12 : 18,
                alignItems: "center",
              }}
            >
              <QBPhoto
                qb={displayedQb}
                mobile={isMobile}
              />

              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: isMobile ? 21 : undefined,
                  }}
                >
                  {displayedQb?.name}
                </h2>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 6,
                    marginBottom: 6,
                  }}
                >
                  <TeamLogo
                    logo={getTeamLogo(displayedQb?.team)}
                    name={displayedQb?.team}
                    size={isMobile ? 30 : 38}
                    plain={true}
                  />

                  <strong
                    style={{
                      color: "#94a3b8",
                      fontSize: isMobile ? 14 : 16,
                    }}
                  >
                    {displayedQb?.team}
                  </strong>
                </div>

                {qbRating?.actual_espn_athlete_id &&
                  String(qbRating.actual_espn_athlete_id) !==
                    String(
                      existingQbPick?.qbs?.espn_athlete_id
                    ) && (
                    <p
                      style={{
                        margin: "4px 0",
                        color: "#facc15",
                        fontSize: 13,
                        fontWeight: 800,
                      }}
                    >
                      🔄 QB utilisé automatiquement
                    </p>
                  )}

                {qbRating?.passer_rating != null ? (
                  <p
                    style={{
                      fontSize: isMobile ? 15 : 22,
                      lineHeight: 1.5,
                    }}
                  >
                    Passer Rating :{" "}
                    <strong
                      style={{
                        color: ratingColor(
                          qbRating.passer_rating
                        ),
                      }}
                    >
                      {Number(
                        qbRating.passer_rating
                      ).toFixed(1)}
                    </strong>

                    {!isMobile && " — "}

                    {isMobile && <br />}

                    Moyenne saison :{" "}
                    <strong style={{ color: "#cbd5e1" }}>
                      {displayedQbAverage != null
                        ? displayedQbAverage.toFixed(1)
                        : "--"}
                    </strong>
                  </p>
                ) : (
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: isMobile ? 14 : 18,
                    }}
                  >
                    Moyenne saison :{" "}
                    <strong style={{ color: "#cbd5e1" }}>
                      {displayedQbAverage != null
                        ? displayedQbAverage.toFixed(1)
                        : "--"}
                    </strong>
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ color: "#22c55e" }}>
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
                  zIndex: qbMenuOpen ? 100 : 1,
                }}
              >
                {/* BOUTON DU MENU QB */}

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
                      setQbMenuOpen((prev) => !prev)
                    }
                    style={{
                      width: "100%",
                      minWidth: 0,
                      height: isMobile ? 58 : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      cursor: "pointer",
                      textAlign: "left",
                      overflow: "hidden",
                      paddingLeft: isMobile ? 14 : undefined,
                      paddingRight: isMobile ? 14 : undefined,
                    }}
                  >
                    {selectedQb ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        {/* NOM + LOGO ENSEMBLE */}

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
                              fontSize: isMobile ? 15 : 16,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {selectedQb.name}
                          </strong>

                          <img
                            src={getTeamLogo(selectedQb.team)}
                            alt={selectedQb.team}
                            style={{
                              width: isMobile ? 23 : 28,
                              height: isMobile ? 23 : 28,
                              objectFit: "contain",
                              flexShrink: 0,
                            }}
                          />
                        </div>

                        <span
                          style={{
                            color: "#94a3b8",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            fontSize: isMobile ? 13 : 14,
                          }}
                        >
                          Moy.{" "}
                          {qbSeasonAverages[
                            String(selectedQb.espn_athlete_id)
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
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: isMobile ? 15 : undefined,
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
                      {qbMenuOpen ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* MENU DÉROULANT */}

                  {qbMenuOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        zIndex: 9999,
                        maxHeight: isMobile ? 310 : 360,
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
                      {availableQbs.map((qb) => {
                        const average =
                          qbSeasonAverages[
                            String(qb.espn_athlete_id)
                          ];

                        return (
                          <button
                            key={qb.id}
                            type="button"
                            onClick={() => {
                              setSelectedQbId(qb.id);
                              setQbMenuOpen(false);
                            }}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: isMobile
                                ? "12px 14px"
                                : "12px 18px",
                              gap: 12,
                              background:
                                selectedQbId === qb.id
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
                            {/* NOM + LOGO COLLÉS */}

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                minWidth: 0,
                                flex: 1,
                                overflow: "hidden",
                              }}
                            >
                              <strong
                                style={{
                                  minWidth: 0,
                                  fontSize: isMobile ? 14 : 16,
                                  lineHeight: 1.15,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {qb.name}
                              </strong>

                              <img
                                src={getTeamLogo(qb.team)}
                                alt={qb.team}
                                style={{
                                  width: isMobile ? 22 : 28,
                                  height: isMobile ? 22 : 28,
                                  objectFit: "contain",
                                  flexShrink: 0,
                                }}
                              />
                            </div>

                            {/* MOYENNE À DROITE */}

                            <span
                              style={{
                                color: "#94a3b8",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                                fontSize: isMobile ? 12 : 14,
                              }}
                            >
                              Moy.{" "}
                              {average != null
                                ? average.toFixed(1)
                                : "--"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* EXPLICATION QB */}

                <div
                  style={{
                    marginTop: 12,
                    padding: isMobile ? 12 : 14,
                    borderRadius: 18,
                    background: "rgba(34,197,94,0.08)",
                    border:
                      "1px solid rgba(34,197,94,0.20)",
                    color: "#cbd5e1",
                    fontSize: isMobile ? 14 : undefined,
                    lineHeight: 1.45,
                  }}
                >
                  ✅ Un QB ne peut être choisi qu’une seule
                  fois par semaine et ne peut pas être
                  réutilisé.
                </div>
              </div>

              {/* PHOTO QB */}

              <div
                style={{
                  textAlign: "center",
                  display: isMobile && !selectedQb ? "none" : "flex",
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
                  <div style={{ color: "#94a3b8" }}>
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
            </div>
          </>
        )}
      </section>

      {/* ================= MATCHS À CHOISIR ================= */}

      {gamesToPick.length > 0 && (
        <section className="card">
          <h2 style={{ color: "#22c55e" }}>
            2. Choisis les matchs
          </h2>

          {gamesToPick.map((game) => {
            const pick = draftPicks[game.id] || {};

            const awaySelected =
              pick.picked_team === game.away_team;

            const homeSelected =
              pick.picked_team === game.home_team;

            return (
              <div
                key={game.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "minmax(0,1fr) 32px minmax(0,1fr) 64px"
                    : "1fr 70px 1fr 120px",
                  alignItems: "center",
                  gap: isMobile ? 6 : 12,
                  padding: "24px 0",
                  borderBottom:
                    "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <div style={{ gridColumn: "1 / -1" }}>
                  <GameTimeBar gameDate={game.game_date} />
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
                    background: "transparent",
                    border: "none",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    minWidth: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(game.away_team)}
                    alt={game.away_team}
                    style={{
                      width: isMobile ? 62 : 96,
                      height: isMobile ? 62 : 96,
                      maxWidth: "100%",
                      objectFit: "contain",
                      opacity: awaySelected ? 1 : 0.82,
                      transform: awaySelected
                        ? "scale(1.08)"
                        : "scale(1)",
                      transition: "0.2s ease",
                      filter: awaySelected
                        ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                        : "none",
                    }}
                  />
                </button>

                <div
                  style={{
                    textAlign: "center",
                    fontSize: isMobile ? 22 : 34,
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
                    background: "transparent",
                    border: "none",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: 0,
                    minWidth: 0,
                  }}
                >
                  <img
                    src={getTeamLogo(game.home_team)}
                    alt={game.home_team}
                    style={{
                      width: isMobile ? 62 : 96,
                      height: isMobile ? 62 : 96,
                      maxWidth: "100%",
                      objectFit: "contain",
                      opacity: homeSelected ? 1 : 0.82,
                      transform: homeSelected
                        ? "scale(1.08)"
                        : "scale(1)",
                      transition: "0.2s ease",
                      filter: homeSelected
                        ? "drop-shadow(0 0 12px rgba(255,255,255,0.35))"
                        : "none",
                    }}
                  />
                </button>

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
                      fontSize: isMobile ? 13 : 16,
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
                    value={pick.predicted_spread ?? ""}
                    onChange={(e) =>
                      updateDraftPick(
                        game.id,
                        "predicted_spread",
                        e.target.value
                      )
                    }
                    style={{
                      width: isMobile ? 50 : 72,
                      height: isMobile ? 50 : 72,
                      borderRadius: 18,
                      border:
                        "2px solid rgba(148,163,184,0.18)",
                      background: "rgba(2,6,23,0.75)",
                      color: "#ffffff",
                      fontSize: isMobile ? 18 : 24,
                      fontWeight: 800,
                      textAlign: "center",
                      outline: "none",
                      appearance: "textfield",
                      MozAppearance: "textfield",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ================= SOUMISSION ================= */}

      {(gamesToPick.length > 0 || !existingQbPick) && (
        <section className="card">
          <button
            className="button"
            onClick={submitEverything}
            style={{
              width: "100%",
              fontSize: isMobile ? 17 : 20,
            }}
          >
            Soumettre mon QB et mes choix
          </button>

          <p style={{ color: "#94a3b8" }}>
            🔒 Tu ne pourras plus modifier après la soumission.
          </p>
        </section>
      )}

      {/* ================= MATCHS SOUMIS ================= */}

      {submittedGames.length > 0 && (
        <section className="card">
          <h2 style={{ color: "#22c55e" }}>
            Tes choix de matchs ✅
          </h2>

          {submittedGames.map((game) => {
            const pick = savedPicks[game.id];

            const hasScore =
              game.home_score != null &&
              game.away_score != null;

            const realSpread = hasScore
              ? Math.abs(game.home_score - game.away_score)
              : null;

            const realWinner = hasScore
              ? game.home_score > game.away_score
                ? game.home_team
                : game.away_team
              : null;

            if (hasScore) {
              return (
                <div
                  key={game.id}
                  style={{
                    padding: "18px 0",
                    borderBottom:
                      "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <GameTimeBar gameDate={game.game_date} />

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile
                        ? "1fr 90px 1fr"
                        : "80px 130px 80px 1fr",
                      gap: isMobile ? 8 : 12,
                      alignItems: "center",
                      justifyItems: "center",
                    }}
                  >
                    <TeamLogo
                      logo={getTeamLogo(game.away_team)}
                      name={game.away_team}
                      size={isMobile ? 55 : 70}
                      plain={true}
                    />

                    <div
                      style={{
                        fontSize: isMobile ? 21 : 30,
                        fontWeight: 900,
                        textAlign: "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {game.away_score} - {game.home_score}
                    </div>

                    <TeamLogo
                      logo={getTeamLogo(game.home_team)}
                      name={game.home_team}
                      size={isMobile ? 55 : 70}
                      plain={true}
                    />

                    {!isMobile && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          justifyContent: "flex-end",
                        }}
                      >
                        <span style={{ fontSize: 26 }}>
                          {getPickBadge(game, pick)}
                        </span>

                        <div style={{ textAlign: "right" }}>
                          <p
                            style={{
                              margin: 0,
                              fontWeight: 800,
                            }}
                          >
                            Choix : {pick.picked_team} par{" "}
                            {pick.predicted_spread}
                          </p>

                          <p
                            style={{
                              margin: "4px 0 0 0",
                              color: "#94a3b8",
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
                        marginTop: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#cbd5e1",
                      }}
                    >
                      <span>{getPickBadge(game, pick)}</span>

                      <span>
                        {pick.picked_team} par{" "}
                        {pick.predicted_spread}
                      </span>

                      <span style={{ color: "#94a3b8" }}>
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
                  padding: "14px 0",
                  borderBottom:
                    "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <GameTimeBar gameDate={game.game_date} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "1fr 30px 1fr"
                      : "90px 50px 90px 1fr 40px",
                    gap: isMobile ? 6 : 12,
                    alignItems: "center",
                    justifyItems: "center",
                  }}
                >
                  <TeamLogo
                    logo={getTeamLogo(game.away_team)}
                    name={game.away_team}
                    selected={
                      pick.picked_team === game.away_team
                    }
                    size={isMobile ? 62 : 78}
                  />

                  <strong
                    style={{
                      textAlign: "center",
                      fontSize: isMobile ? 17 : 18,
                    }}
                  >
                    @
                  </strong>

                  <TeamLogo
                    logo={getTeamLogo(game.home_team)}
                    name={game.home_team}
                    selected={
                      pick.picked_team === game.home_team
                    }
                    size={isMobile ? 62 : 78}
                  />

                  {!isMobile && (
                    <>
                      <strong style={{ fontSize: 22 }}>
                        par {pick.predicted_spread}
                      </strong>

                      <span style={{ fontSize: 28 }}>
                        ⚪
                      </span>
                    </>
                  )}
                </div>

                {isMobile && (
                  <div
                    style={{
                      marginTop: 8,
                      textAlign: "center",
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    ⚪ {pick.picked_team} par{" "}
                    {pick.predicted_spread}
                  </div>
                )}
              </div>
            );
          })}

          <p style={{ color: "#94a3b8" }}>
            🔒 Choix soumis pour la semaine {currentWeek}.
          </p>
        </section>
      )}

      <BottomNav />
    </main>
  );
}
