"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Matchs() {
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
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

      {!user && (
        <section className="card">
          <p className="status-error">
            Connecte-toi pour sauvegarder tes choix.
          </p>
        </section>
      )}

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      <section className="card">
        <h2>À faire</h2>
        <p>
          {gamesToPick.length} match{gamesToPick.length > 1 ? "s" : ""} restant
          {gamesToPick.length > 1 ? "s" : ""}.
        </p>
      </section>

      {gamesToPick.length === 0 && (
        <section className="card">
          <h2>Tout est soumis ✅</h2>
          <p>Tu as fait tous tes choix pour les matchs admissibles.</p>
        </section>
      )}

      {gamesToPick.map((game) => {
        const pick = draftPicks[game.id] || {};

        return (
          <section key={game.id} className="card">
            <h2 style={{ marginTop: 0 }}>
              {game.away_team} @ {game.home_team}
            </h2>

            <p>Semaine {game.week}</p>

            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button
                onClick={() =>
                  updateDraftPick(game.id, "picked_team", game.away_team)
                }
                className={
                  pick.picked_team === game.away_team
                    ? "button"
                    : "button-secondary"
                }
              >
                {game.away_team}
              </button>

              <button
                onClick={() =>
                  updateDraftPick(game.id, "picked_team", game.home_team)
                }
                className={
                  pick.picked_team === game.home_team
                    ? "button"
                    : "button-secondary"
                }
              >
                {game.home_team}
              </button>
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
                <strong>
                  {game.away_team} @ {game.home_team}
                </strong>
                <p>
                  Ton choix : {pick.picked_team} par {pick.predicted_spread}
                </p>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
