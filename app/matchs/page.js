"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Matchs() {
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
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

      if (currentUser) {
        const { data: picksData } = await supabase
          .from("picks")
          .select("*")
          .eq("user_id", currentUser.id);

        const picksByGame = {};
        (picksData || []).forEach((pick) => {
          picksByGame[pick.game_id] = pick;
        });

        setPicks(picksByGame);
      }
    }

    load();
  }, []);

  const updateLocalPick = (gameId, field, value) => {
    setPicks((prev) => ({
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

    const pick = picks[game.id];

    if (!pick?.picked_team || pick.predicted_spread === undefined || pick.predicted_spread === "") {
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
    } else {
      setMessage("Choix sauvegardé ✅");
    }
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>Mes choix</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      {!user && (
        <p style={{ color: "darkred" }}>
          Mode lecture seulement : connecte-toi pour sauvegarder tes choix.
        </p>
      )}

      {message && <p>{message}</p>}

      {games.map((game) => {
        const pick = picks[game.id] || {};

        return (
          <div
            key={game.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 15,
              marginBottom: 15,
              maxWidth: 500,
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              {game.away_team} @ {game.home_team}
            </h2>

            <p>Semaine {game.week}</p>

            <div style={{ marginBottom: 10 }}>
              <button
                onClick={() =>
                  updateLocalPick(game.id, "picked_team", game.away_team)
                }
                style={{
                  padding: 10,
                  marginRight: 10,
                  fontWeight:
                    pick.picked_team === game.away_team ? "bold" : "normal",
                }}
              >
                {game.away_team}
              </button>

              <button
                onClick={() =>
                  updateLocalPick(game.id, "picked_team", game.home_team)
                }
                style={{
                  padding: 10,
                  fontWeight:
                    pick.picked_team === game.home_team ? "bold" : "normal",
                }}
              >
                {game.home_team}
              </button>
            </div>

            <input
              type="number"
              placeholder="Écart prédit"
              value={pick.predicted_spread ?? ""}
              onChange={(e) =>
                updateLocalPick(
                  game.id,
                  "predicted_spread",
                  e.target.value
                )
              }
              style={{ padding: 10, marginRight: 10, width: 130 }}
            />

            <button onClick={() => savePick(game)} style={{ padding: 10 }}>
              Sauvegarder
            </button>
          </div>
        );
      })}
    </main>
  );
}
