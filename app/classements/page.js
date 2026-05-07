"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

function RankingCard({ title, players, scoreLabel }) {
  return (
    <section className="card" style={{ flex: 1 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>

      {players.length === 0 && <p>Aucun score pour le moment.</p>}

      {players.map((player, index) => {
        const medal =
          index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;

        return (
          <div
            key={player.user_id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 0",
              borderBottom:
                index === players.length - 1 ? "none" : "1px solid #e5e7eb",
            }}
          >
            <div>
              <strong style={{ fontSize: 18 }}>
                {medal} {player.email || "Joueur"}
              </strong>
              <p style={{ margin: "4px 0 0 0", color: "#6b7280" }}>
                {scoreLabel}
              </p>
            </div>

            <strong style={{ fontSize: 22 }}>
              {Number(player.score || 0).toFixed(3)}
            </strong>
          </div>
        );
      })}
    </section>
  );
}

export default function ClassementsPage() {
  const [weeklyScores, setWeeklyScores] = useState([]);
  const [players, setPlayers] = useState([]);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadScores() {
      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      const week = settingsData?.current_week || 1;
      setCurrentWeek(week);

      const { data: usersData } = await supabase
        .from("users")
        .select("id, email");

      setPlayers(usersData || []);

      const { data, error } = await supabase
        .from("weekly_scores")
        .select("*")
        .order("final_score", { ascending: false });

      if (error) {
        setMessage("Erreur : " + error.message);
        return;
      }

      setWeeklyScores(data || []);
    }

    loadScores();
  }, []);

  const getEmail = (userId) => {
    const player = players.find((p) => p.id === userId);
    return player?.email || userId;
  };

  const seasonTotals = weeklyScores.reduce((acc, score) => {
    if (!acc[score.user_id]) {
      acc[score.user_id] = {
        user_id: score.user_id,
        email: getEmail(score.user_id),
        score: 0,
      };
    }

    acc[score.user_id].score += Number(score.final_score || 0);
    return acc;
  }, {});

  const seasonRanking = Object.values(seasonTotals).sort(
    (a, b) => b.score - a.score
  );

  const weekRanking = weeklyScores
    .filter((score) => score.week === currentWeek)
    .map((score) => ({
      user_id: score.user_id,
      email: getEmail(score.user_id),
      score: Number(score.final_score || 0),
      base_points: score.base_points,
      multiplier: score.multiplier,
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <section className="header-card">
        <h1>Classements 🏆</h1>
        <p>Saison complète et semaine {currentWeek}</p>
      </section>

      <p>
        <a href="/">← Retour accueil</a>
      </p>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        <RankingCard
          title="Classement saison"
          players={seasonRanking}
          scoreLabel="Total saison"
        />

        <RankingCard
          title={`Classement semaine ${currentWeek}`}
          players={weekRanking}
          scoreLabel="Score hebdo"
        />
      </div>

      {weekRanking.length > 0 && (
        <section className="card" style={{ marginTop: 18 }}>
          <h2>Détails semaine {currentWeek}</h2>

          {weekRanking.map((player, index) => (
            <div
              key={player.user_id}
              style={{
                padding: "12px 0",
                borderBottom:
                  index === weekRanking.length - 1
                    ? "none"
                    : "1px solid #e5e7eb",
              }}
            >
              <strong>
                #{index + 1} — {player.email}
              </strong>
              <p style={{ margin: "6px 0 0 0", color: "#6b7280" }}>
                Points matchs : {player.base_points} | Multiplicateur QB :{" "}
                {Number(player.multiplier || 1).toFixed(3)} | Final :{" "}
                {Number(player.score || 0).toFixed(3)}
              </p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
