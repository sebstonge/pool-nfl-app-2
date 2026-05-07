"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score ? game.home_team : game.away_team;

  const realSpread = Math.abs(game.home_score - game.away_score);

  if (pick.picked_team !== winner) return "🔴";
  if (Number(pick.predicted_spread) === realSpread) return "🟢";
  return "🟡";
}

function GameResultLine({ game }) {
  const hasScore = game.home_score != null && game.away_score != null;

  if (!hasScore) {
    return (
      <strong>
        {game.away_team} @ {game.home_team}
      </strong>
    );
  }

  const homeWon = game.home_score > game.away_score;
  const awayWon = game.away_score > game.home_score;
  const realSpread = Math.abs(game.home_score - game.away_score);

  return (
    <strong>
      {awayWon ? (
        <strong>{game.away_team} ({game.away_score})</strong>
      ) : (
        <span>{game.away_team} ({game.away_score})</span>
      )}{" "}
      @{" "}
      {homeWon ? (
        <strong>{game.home_team} ({game.home_score})</strong>
      ) : (
        <span>{game.home_team} ({game.home_score})</span>
      )}{" "}
      - par {realSpread}
    </strong>
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
        minHeight: 130,
      }}
    >
      {teamLogo ? (
        <img
          src={teamLogo}
          alt={teamName}
          style={{
            width: 62,
            height: 62,
            objectFit: "contain",
          }}
        />
      ) : (
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: 14,
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#111827",
            fontWeight: 800,
          }}
        >
          {teamName?.slice(0, 2)}
        </div>
      )}

      <strong>{teamName}</strong>
    </button>
  );
}

export default function Matchs() {
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
  const [teams, setTeams] = useState([]);
  const [savedPicks, setSavedPicks] = useState({});
  const [draftPicks, setDraftPicks] = useState({});
  const [message, setMessage] = useState("");

  async function loadData() {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUser = sessionData.session?.user ?? null;
    setUser(currentUser);

    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("*")
      .eq("is_pool_eligible", true)
      .order("game_date", { ascending: true });

    if (gamesError) {
      setMessage("Erreur matchs : " + gamesError.message);
      return;
    }

    setGames(gamesData || []);

    const { data: teamsData, error: teamsError } = await supabase
      .from("teams")
      .select("*");

    if (teamsError) {
      setMessage("Erreur équipes : " + teamsError.message);
      return;
    }

    setTeams(teamsData || []);

    if (currentUser) {
      const { data: picksData, error: picksError } = await supabase
        .from("picks")
        .select("*")
        .eq("user_id", currentUser.id);

      if (picksError) {
        setMessage("Erreur choix : " + picksError.message);
        return;
      }

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
    const team = teams.find((t) => t.name === teamName);
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
        <h1>Mes choix 📝</h1>
        <p>Choisis le gagnant et l’écart prédit.</p>
      </section>

      <p>
        <a href="/">← Retour accueil</a>
      </p>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {gamesToPick.length > 0 && (
        <section className="card">
          <h2>À faire</h2>
          <p>
            {gamesToPick.length} match{gamesToPick.length > 1 ? "s" : ""} à
            compléter.
          </p>
        </section>
      )}

      {gamesToPick.map((game) => {
        const pick = draftPicks[game.id] || {};

        return (
          <section key={game.id} className="card">
            <h2 style={{ marginTop: 0 }}>
              {game.away_team} @ {game.home_team}
            </h2>

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
            <h2>Choix soumis ✅</h2>
          </section>

          {submittedGames.map((game) => {
            const pick = savedPicks[game.id];

            return (
              <section key={game.id} className="card">
                <GameResultLine game={game} />
                <p>
                  {getPickBadge(game, pick)} Choix : {pick.picked_team} par{" "}
                  {pick.predicted_spread}
                </p>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
