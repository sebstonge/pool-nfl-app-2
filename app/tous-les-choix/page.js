"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function shortName(email) {
  if (!email) return "Joueur";
  return email.split("@")[0];
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
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score ? game.home_team : game.away_team;

  const realSpread = Math.abs(game.home_score - game.away_score);

  if (pick.picked_team !== winner) return "🔴";
  if (Number(pick.predicted_spread) === realSpread) return "🟢";
  return "🟡";
}

export default function TousLesChoix() {
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
  const [qbRatings, setQbRatings] = useState([]);
  const [teams, setTeams] = useState([]);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadData() {
      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      const week = settingsData?.current_week || 1;
      setCurrentWeek(week);

      const { data: teamsData } = await supabase.from("teams").select("*");
      setTeams(teamsData || []);

      const { data: usersData } = await supabase
        .from("users")
        .select("id, email")
        .order("email", { ascending: true });

      setPlayers(usersData || []);

      const { data: picksData, error: picksError } = await supabase
        .from("picks")
        .select(`
          id,
          user_id,
          picked_team,
          predicted_spread,
          games (
            week,
            away_team,
            home_team,
            away_score,
            home_score,
            game_date
          )
        `);

      if (picksError) {
        setMessage("Erreur choix : " + picksError.message);
        return;
      }

      setPicks((picksData || []).filter((pick) => pick.games?.week === week));

      const { data: qbData, error: qbError } = await supabase
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
        .eq("week", week);

      if (qbError) {
        setMessage("Erreur QB : " + qbError.message);
        return;
      }

      setQbPicks(qbData || []);

      const { data: ratingsData } = await supabase
        .from("qb_ratings")
        .select("*")
        .eq("week", week);

      setQbRatings(ratingsData || []);
    }

    loadData();
  }, []);

  const getTeamLogo = (teamName) => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() === teamName?.toLowerCase().trim()
    );

    return team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo || null;
  };

  const allUserIds = Array.from(
    new Set([
      ...players.map((p) => p.id),
      ...picks.map((p) => p.user_id),
      ...qbPicks.map((q) => q.user_id),
    ])
  );

  return (
    <main className="page">
      <section className="header-card">
        <h1>Tous les choix 👀</h1>
        <p>Semaine {currentWeek}</p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {allUserIds.length === 0 && (
        <section className="card">
          <p>Aucun choix soumis pour le moment.</p>
        </section>
      )}

      {allUserIds.map((userId) => {
        const player = players.find((p) => p.id === userId);
        const playerPicks = picks.filter((pick) => pick.user_id === userId);
        const playerQB = qbPicks.find((qb) => qb.user_id === userId);
        const playerQbRating = qbRatings.find(
          (rating) => rating.qb_id === playerQB?.qb_id
        );

        return (
          <section key={userId} className="card">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "58px 1fr",
                gap: 14,
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: "50%",
                  background: "#22c55e",
                  color: "#052e16",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 18,
                }}
              >
                {shortName(player?.email).slice(0, 2).toUpperCase()}
              </div>

              <div>
                <h2 style={{ margin: 0 }}>{shortName(player?.email)}</h2>
                <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                  Choix de la semaine {currentWeek}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "96px 1fr",
                gap: 16,
                alignItems: "center",
                padding: 16,
                borderRadius: 18,
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.20)",
                marginBottom: 18,
              }}
            >
              {playerQB?.qbs ? (
                <QBPhoto qb={playerQB.qbs} size={92} />
              ) : (
                <div
                  style={{
                    width: 92,
                    height: 92,
                    borderRadius: 18,
                    background: "rgba(148,163,184,0.16)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
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

                {playerQB?.qbs ? (
                  <>
                    <h2 style={{ margin: "4px 0 4px 0" }}>
                      {playerQB.qbs.name}
                    </h2>

                    <p style={{ margin: 0, color: "#94a3b8" }}>
                      {playerQB.qbs.team}
                      {playerQbRating?.passer_rating != null && (
                        <>
                          {" "}
                          — Rating :{" "}
                          <strong style={{ color: "#22c55e" }}>
                            {Number(playerQbRating.passer_rating).toFixed(1)}
                          </strong>
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="status-warning">Aucun QB soumis</p>
                )}
              </div>
            </div>

            {playerPicks.length === 0 ? (
              <p className="status-warning">Aucun choix de match soumis.</p>
            ) : (
              playerPicks.map((pick) => {
                const game = pick.games;

                const realSpread =
                  game.home_score != null && game.away_score != null
                    ? Math.abs(game.home_score - game.away_score)
                    : null;

                const hasScore =
                  game.home_score != null && game.away_score != null;

                return hasScore ? (
                  <div
                    key={pick.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 130px 80px 1fr",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 0",
                      borderBottom: "1px solid rgba(148,163,184,0.12)",
                    }}
                  >
                    <TeamLogo
                      logo={getTeamLogo(game.away_team)}
                      name={game.away_team}
                      size={70}
                    />

                    <div
                      style={{
                        fontSize: 30,
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
                      size={70}
                    />

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        justifyContent: "flex-end",
                      }}
                    >
                      <span style={{ fontSize: 30 }}>
                        {getPickBadge(game, pick)}
                      </span>

                      <div>
                        <p style={{ margin: 0, fontWeight: 800 }}>
                          Choix : {pick.picked_team} par{" "}
                          {pick.predicted_spread}
                        </p>

                        <p
                          style={{
                            margin: "4px 0 0 0",
                            color: "#94a3b8",
                          }}
                        >
                          Écart réel : {realSpread}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={pick.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "90px 50px 90px 1fr 40px",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 0",
                      borderBottom: "1px solid rgba(148,163,184,0.12)",
                    }}
                  >
                    <div
                      style={{
                        width: 78,
                        height: 78,
                        borderRadius: "50%",
                        background:
                          pick.picked_team === game.away_team
                            ? "white"
                            : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <TeamLogo
                        logo={getTeamLogo(game.away_team)}
                        name={game.away_team}
                        size={66}
                      />
                    </div>

                    <strong style={{ textAlign: "center", fontSize: 18 }}>
                      @
                    </strong>

                    <div
                      style={{
                        width: 78,
                        height: 78,
                        borderRadius: "50%",
                        background:
                          pick.picked_team === game.home_team
                            ? "white"
                            : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <TeamLogo
                        logo={getTeamLogo(game.home_team)}
                        name={game.home_team}
                        size={66}
                      />
                    </div>

                    <strong style={{ fontSize: 22 }}>
                      par {pick.predicted_spread}
                    </strong>

                    <span style={{ fontSize: 28 }}>⚪</span>
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
