"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ClassementsPage() {
  const [weeklyScores, setWeeklyScores] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadScores() {
      const { data, error } = await supabase
        .from("weekly_scores")
        .select("*")
        .order("week", { ascending: true })
        .order("final_score", { ascending: false });

      if (error) {
        setMessage("Erreur : " + error.message);
        return;
      }

      setWeeklyScores(data || []);
    }

    loadScores();
  }, []);

  const weeklyGrouped = weeklyScores.reduce((acc, score) => {
    if (!acc[score.week]) acc[score.week] = [];
    acc[score.week].push(score);
    return acc;
  }, {});

  const generalTotals = weeklyScores.reduce((acc, score) => {
    if (!acc[score.user_id]) {
      acc[score.user_id] = {
        user_id: score.user_id,
        total: 0,
      };
    }

    acc[score.user_id].total += Number(score.final_score || 0);
    return acc;
  }, {});

  const generalRanking = Object.values(generalTotals).sort(
    (a, b) => b.total - a.total
  );

  return (
    <main style={{ padding: 20 }}>
      <h1>Classements</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      {message && <p>{message}</p>}

      <section style={{ marginBottom: 30 }}>
        <h2>Classement général</h2>

        {generalRanking.length === 0 && <p>Aucun score pour le moment.</p>}

        {generalRanking.map((player, index) => (
          <div
            key={player.user_id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              maxWidth: 600,
            }}
          >
            <strong>
              #{index + 1} — Joueur : {player.user_id}
            </strong>
            <br />
            Total : {player.total.toFixed(2)}
          </div>
        ))}
      </section>

      <section>
        <h2>Classement hebdomadaire</h2>

        {Object.entries(weeklyGrouped).map(([week, scores]) => (
          <div key={week} style={{ marginBottom: 30 }}>
            <h3>Semaine {week}</h3>

            {scores.map((score, index) => (
              <div
                key={score.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 10,
                  maxWidth: 600,
                }}
              >
                <strong>
                  #{index + 1} — Joueur : {score.user_id}
                </strong>
                <br />
                Points matchs : {score.base_points}
                <br />
                Multiplicateur QB : {score.multiplier}
                <br />
                Score final : {Number(score.final_score || 0).toFixed(2)}
              </div>
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}
