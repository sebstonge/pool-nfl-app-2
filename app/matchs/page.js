"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score ? game.home_team : game.away_team;

  const realSpread = Math.abs(game.home_score - game.away_score);

  if (pick.picked_team !== winner) return "❌";
  if (Number(pick.predicted_spread) === realSpread) return "✅";
  return "➖";
}

function TeamLogo({ logo, name, size = 66 }) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
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

function TeamButton({ teamName, teamLogo, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={selected ? "button" : "button-secondary"}
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        minHeight: 138,
      }}
    >
      <TeamLogo logo={teamLogo} name={teamName} />
      <strong>{teamName}</strong>
    </button>
  );
}

export default function Matchs() {
  const [user, setUser] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [games, setGames] = useState([]);
  const [teams, setTeams] = useState([]);
  const [savedPicks, setSavedPicks] = useState({});
  const [draftPicks, setDraftPicks] = useState({});
  const [message, setMessage] = useState("");

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

    const { data: gamesData } = await supabase
      .from("games")
      .select("*")
      .eq("is_pool_eligible", true)
      .eq("week", week)
      .order("game_date", { ascending: true });

    setGames(gamesData || []);

    const { data: teamsData } = await supabase
      .from("teams")
      .select("*");

    setTeams(teamsData || []);

    if (currentUser) {
      const { data: picksData } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", currentUser.id);

      const picksByGame = {};

      (picksData || []).forEach((pick) => {
        picksByGame[pick.game_id] = pick;
      });

      setSavedPicks(picksByGame);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const getTeamLogo = (teamName) => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() === teamName?.toLowerCase().trim()
    );

    return team?.logo || null;
  };

  const updateDraftPick = (gameId, field, value) => {
    setDraftPicks((prev) => ({
      ...prev,
      [gameId]: {
        ...prev[gameId],
        [field]: value,
      },
    }));
  };

  const savePick = async (game) => {
    if (!user) {
      setMessage("Connecte-toi avant de sauvegarder un choix.");
      return;
    }

    const pick = draftPicks[game.id];

    if (
      !pick?.picked_team ||
      pick.predicted_spread === undefined ||
      pick.predicted_spread === ""
    ) {
      setMessage("Choisis une équipe et un écart avant de sauvegarder.");
      return;
    }

    const { error } = await supabase.from("picks").upsert({
      user_id: user.id,
      game_id: game.id,
      picked_team: pick.picked_team,
      predicted_spread: Number(pick.predicted_spread),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setMessage("Erreur sauvegarde : " + error.message);
      return;
    }

    setMessage("Choix sauvegardé ✅");
    await loadData();
  };

  const gamesToPick = games.filter((game) => !savedPicks[game.id]);

  const submittedGames = games.filter((game) => savedPicks[game.id]);

  return (
    <main className="page">
      <section className="header-card">
        <h1>Mes choix ✅</h1>
        <p>Semaine {currentWeek || "..."}</p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {gamesToPick.length > 0 && (
        <section className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>À faire</h2>

              <p style={{ margin: "6px 0 0 0", color: "#94a3b8" }}>
                {gamesToPick.length} match
                {gamesToPick.length > 1 ? "s" : ""} à compléter
              </p>
            </div>

            <span className="badge badge-yellow">Ouvert</span>
          </div>
        </section>
      )}

      {gamesToPick.map((game) => {
        const pick = draftPicks[game.id] || {};

        return (
          <section key={game.id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <TeamLogo
                logo={getTeamLogo(game.away_team)}
                name={game.away_team}
              />

              <div style={{ textAlign: "center", flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {game.away_team} @ {game.home_team}
                </h2>

                <p style={{ margin: "6px 0 0 0", color: "#94a3b8" }}>
                  Choix ouverts
                </p>
              </div>

              <TeamLogo
                logo={getTeamLogo(game.home_team)}
                name={game.home_team}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <TeamButton
                teamName={game.away_team}
                teamLogo={getTeamLogo(game.away_team)}
                selected={pick.picked_team === game.away_team}
                onClick={() =>
                  updateDraftPick(game.id, "picked_team", game.away_team)
                }
              />

              <TeamButton
                teamName={game.home_team}
                teamLogo={getTeamLogo(game.home_team)}
                selected={pick.picked_team === game.home_team}
                onClick={() =>
                  updateDraftPick(game.id, "picked_team", game.home_team)
                }
              />
            </div>

            <input
              className="input"
              type="number"
              placeholder="Écart prédit"
              value={pick.predicted_spread ?? ""}
              onChange={(e) =>
                updateDraftPick(game.id, "predicted_spread", e.target.value)
              }
            />

            <button className="button" onClick={() => savePick(game)}>
              Soumettre ce choix
            </button>
          </section>
        );
      })}

      {submittedGames.length > 0 && (
        <>
          <section className="card">
            <h2 style={{ margin: 0 }}>Choix soumis ✅</h2>
          </section>

          {submittedGames.map((game) => {
            const pick = savedPicks[game.id];

            const realSpread =
              game.home_score != null && game.away_score != null
                ? Math.abs(game.home_score - game.away_score)
                : null;

            return (
              <section key={game.id} className="card">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 150px 90px 1fr",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <TeamLogo
                    logo={getTeamLogo(game.away_team)}
                    name={game.away_team}
                    size={78}
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
                    size={78}
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
              </section>
            );
          })}
        </>
      )}

      <BottomNav />
    </main>
  );
}
