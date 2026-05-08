"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function shortName(email) {
  if (!email) return "Joueur";
  return email.split("@")[0];
}

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score ? game.home_team : game.away_team;

  const realSpread = Math.abs(game.home_score - game.away_score);

  if (pick.picked_team !== winner) return "❌";
  if (Number(pick.predicted_spread) === realSpread) return "✅";
  return "➖";
}

function getRealSpread(game) {
  if (game.home_score == null || game.away_score == null) return null;
  return Math.abs(game.home_score - game.away_score);
}

function TeamLogo({ logo, name }) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: 70,
          height: 70,
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
        width: 78,
        height: 78,
        objectFit: "contain",
      }}
    />
  );
}

export default function TousLesChoix() {
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
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
          qbs (
            name,
            team,
            logo
          )
        `)
        .eq("week", week);

      if (qbError) {
        setMessage("Erreur QB : " + qbError.message);
        return;
      }

      setQbPicks(qbData || []);
    }

    loadData();
  }, []);

  const getTeamLogo = (teamName) => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() === teamName?.toLowerCase().trim()
    );

    return team?.logo || null;
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

        return (
          <section key={userId} className="card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
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

              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{shortName(player?.email)}</h2>

                <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                  QB :{" "}
                  {playerQB?.qbs ? (
                    <strong style={{ color: "#60a5fa" }}>
                      {playerQB.qbs.name}
                    </strong>
                  ) : (
                    <span className="status-warning">Aucun QB soumis</span>
                  )}
                </p>
              </div>

              {playerQB?.qbs?.logo && (
                <img
                  src={playerQB.qbs.logo}
                  alt={playerQB.qbs.name}
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "contain",
                  }}
                />
              )}
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(148,163,184,0.18)",
              }}
            >
              {playerPicks.length === 0 ? (
                <p className="status-warning">
                  Aucun choix de match soumis.
                </p>
              ) : (
                playerPicks.map((pick) => {
                  const game = pick.games;
                  const realSpread = getRealSpread(game);

                  return (
                    <div
                      key={pick.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 150px 90px 1fr",
                        gap: 14,
                        alignItems: "center",
                        padding: "18px 0",
                        borderBottom:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <TeamLogo
                        logo={getTeamLogo(game.away_team)}
                        name={game.away_team}
                      />

                      <div
                        style={{
                          fontSize: 34,
                          fontWeight: 900,
                          textAlign: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {game.away_score != null && game.home_score != null
                          ? `${game.away_score} - ${game.home_score}`
                          : "vs"}
                      </div>

                      <TeamLogo
                        logo={getTeamLogo(game.home_team)}
                        name={game.home_team}
                      />

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 14,
                          justifyContent: "flex-end",
                        }}
                      >
                        <span style={{ fontSize: 32 }}>
                          {getPickBadge(game, pick)}
                        </span>

                        <div>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 18,
                              fontWeight: 800,
                            }}
                          >
                            Choix : {pick.picked_team} par{" "}
                            {pick.predicted_spread}
                          </p>

                          {realSpread != null && (
                            <p
                              style={{
                                margin: "4px 0 0 0",
                                color: "#94a3b8",
                              }}
                            >
                              Écart réel : {realSpread}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        );
      })}

      <BottomNav />
    </main>
  );
}
