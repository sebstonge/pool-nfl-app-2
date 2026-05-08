"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function medal(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `#${index + 1}`;
}

function movement(currentRank, previousRank) {
  if (!previousRank) return "—";
  if (currentRank < previousRank) return `⬆️ +${previousRank - currentRank}`;
  if (currentRank > previousRank) return `⬇️ -${currentRank - previousRank}`;
  return "➡️";
}

function RankingCard({ title, players, type }) {
  const leaderScore = players[0]?.score || 0;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>

      {players.length === 0 && <p>Aucun score pour le moment.</p>}

      {players.map((player, index) => {
        const gapLeader = leaderScore - player.score;
        const previousPlayer = players[index - 1];
        const gapPrevious = previousPlayer
          ? previousPlayer.score - player.score
          : 0;

        return (
          <div
            key={player.user_id}
            style={{
              padding: "14px 0",
              borderBottom:
                index === players.length - 1 ? "none" : "1px solid #1e293b",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <strong style={{ fontSize: 18 }}>
                  {medal(index)} {player.email || "Joueur"}
                </strong>

                {type === "season" && (
                  <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                    Moyenne : {Number(player.average || 0).toFixed(3)} / semaine
                  </p>
                )}

                {type === "season" && (
                  <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                    Mouvement : {movement(index + 1, player.previousRank)}
                  </p>
                )}
              </div>

              <strong style={{ fontSize: 24, color: "#22c55e" }}>
                {Number(player.score || 0).toFixed(3)}
              </strong>
            </div>

            <p style={{ margin: "8px 0 0 0", color: "#94a3b8" }}>
              {index === 0
                ? "Meneur"
                : `À ${gapLeader.toFixed(3)} du meneur`}
              {index > 0 &&
                ` | ${gapPrevious.toFixed(3)} derrière la position précédente`}
            </p>
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
        .order("week", { ascending: true });

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

  const buildSeasonRanking = (scores) => {
    const totals = scores.reduce((acc, score) => {
      if (!acc[score.user_id]) {
        acc[score.user_id] = {
          user_id: score.user_id,
          email: getEmail(score.user_id),
          score: 0,
          weeksPlayed: 0,
        };
      }

      acc[score.user_id].score += Number(score.final_score || 0);
      acc[score.user_id].weeksPlayed += 1;

      return acc;
    }, {});

    return Object.values(totals)
      .map((player) => ({
        ...player,
        average:
          player.weeksPlayed > 0 ? player.score / player.weeksPlayed : 0,
      }))
      .sort((a, b) => b.score - a.score);
  };

  const seasonRankingRaw = buildSeasonRanking(weeklyScores);

  const previousSeasonRanking = buildSeasonRanking(
    weeklyScores.filter((score) => score.week < currentWeek)
  );

  const previousRanks = {};
  previousSeasonRanking.forEach((player, index) => {
    previousRanks[player.user_id] = index + 1;
  });

  const seasonRanking = seasonRankingRaw.map((player, index) => ({
    ...player,
    currentRank: index + 1,
    previousRank: previousRanks[player.user_id],
  }));

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <section className="header-card">
        <h1>Classements 🏆</h1>
        <p>Semaine {currentWeek} et saison complète</p>
      </section>

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
          title={`Classement semaine ${currentWeek}`}
          players={weekRanking}
          type="week"
        />

        <RankingCard
          title="Classement saison"
          players={seasonRanking}
          type="season"
        />
      </div>
      <BottomNav />
    </main>
  );
}
