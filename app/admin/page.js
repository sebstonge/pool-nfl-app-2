"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AdminPage() {
  const [message, setMessage] = useState("");

  const calculateScores = async () => {
    setMessage("Calcul en cours...");

    const { data: settingsData, error: settingsError } = await supabase
      .from("settings")
      .select("*")
      .single();

    if (settingsError) {
      setMessage("Erreur settings : " + settingsError.message);
      return;
    }

    const currentWeek = settingsData.current_week;

    const { data: picks, error: picksError } = await supabase
      .from("picks")
      .select(`
        *,
        games (
          week,
          home_team,
          away_team,
          home_score,
          away_score
        )
      `);

    if (picksError) {
      setMessage("Erreur picks : " + picksError.message);
      return;
    }

    const { data: qbPicks } = await supabase
      .from("qb_picks")
      .select("*")
      .eq("week", currentWeek);

    const { data: qbRatings } = await supabase
      .from("qb_ratings")
      .select("*")
      .eq("week", currentWeek);

    const scoresByUser = {};

    picks
      .filter((pick) => pick.games?.week === currentWeek)
      .forEach((pick) => {
        const game = pick.games;

        if (
          game.home_score === null ||
          game.away_score === null
        ) {
          return;
        }

        let winner = null;

        if (game.home_score > game.away_score) {
          winner = game.home_team;
        } else if (game.away_score > game.home_score) {
          winner = game.away_team;
        }

        const realSpread = Math.abs(game.home_score - game.away_score);

        let points = 0;

        if (pick.picked_team === winner) {
          points = 1;

          if (Number(pick.predicted_spread) === realSpread) {
            points = 2;
          }
        }

        if (!scoresByUser[pick.user_id]) {
          scoresByUser[pick.user_id] = 0;
        }

        scoresByUser[pick.user_id] += points;
      });

    const weeklyScoreRows = Object.entries(scoresByUser).map(
      ([userId, basePoints]) => {
        const qbPick = qbPicks.find((p) => p.user_id === userId);
        const qbRating = qbRatings.find(
          (r) => r.qb_id === qbPick?.qb_id
        );

        const passerRating = Number(qbRating?.passer_rating || 0);
        const multiplier = passerRating > 0 ? passerRating / 100 : 1;

        // 🔥 précision 3 décimales ici
        const finalScore = Number(
          (basePoints * multiplier).toFixed(3)
        );

        return {
          user_id: userId,
          week: currentWeek,
          base_points: basePoints,
          multiplier: Number(multiplier.toFixed(3)),
          final_score: finalScore,
        };
      }
    );

    const { error: upsertError } = await supabase
      .from("weekly_scores")
      .upsert(weeklyScoreRows, {
        onConflict: "user_id,week",
      });

    if (upsertError) {
      setMessage("Erreur : " + upsertError.message);
      return;
    }

    setMessage("Classements calculés ✅");
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>Admin</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      <button onClick={calculateScores} style={{ padding: 12 }}>
        Calculer les classements
      </button>

      <p>{message}</p>
    </main>
  );
}
