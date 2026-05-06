"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function checkAdmin() {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUser = sessionData.session?.user ?? null;

      setUser(currentUser);

      if (!currentUser) return;

      const { data } = await supabase
        .from("users")
        .select("is_admin")
        .eq("id", currentUser.id)
        .single();

      if (data?.is_admin) {
        setIsAdmin(true);
      }
    }

    checkAdmin();
  }, []);

  const updateEspnScores = async () => {
    setMessage("Mise à jour ESPN en cours...");

    const { data: settingsData, error: settingsError } = await supabase
      .from("settings")
      .select("*")
      .single();

    if (settingsError) {
      setMessage("Erreur settings : " + settingsError.message);
      return;
    }

    const currentWeek = settingsData.current_week;
    const currentSeason = settingsData.current_season || 2026;

    const espnUrl =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?seasontype=2&week=${currentWeek}&dates=${currentSeason}`;

    const response = await fetch(espnUrl);
    const espnData = await response.json();

    if (!espnData.events) {
      setMessage("Aucun match trouvé dans ESPN.");
      return;
    }

    let updatedCount = 0;

    for (const event of espnData.events) {
      const externalGameId = event.id;

      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");

      if (!home || !away) continue;

      const homeScore = Number(home.score);
      const awayScore = Number(away.score);

      const completed = competition.status?.type?.completed === true;

      if (!completed) continue;

      const { error } = await supabase
        .from("games")
        .update({
          home_score: homeScore,
          away_score: awayScore,
        })
        .eq("external_game_id", externalGameId);

      if (!error) {
        updatedCount++;
      }
    }

    setMessage(`Scores ESPN mis à jour ✅ (${updatedCount} matchs)`);
  };

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

        if (game.home_score == null || game.away_score == null) return;

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

        scoresByUser[pick.user_id] =
          (scoresByUser[pick.user_id] || 0) + points;
      });

    const rows = Object.entries(scoresByUser).map(([userId, basePoints]) => {
      const qbPick = qbPicks.find((p) => p.user_id === userId);
      const qbRating = qbRatings.find((r) => r.qb_id === qbPick?.qb_id);

      const passerRating = Number(qbRating?.passer_rating || 0);
      const multiplier = passerRating > 0 ? passerRating / 100 : 1;

      return {
        user_id: userId,
        week: currentWeek,
        base_points: basePoints,
        multiplier: Number(multiplier.toFixed(3)),
        final_score: Number((basePoints * multiplier).toFixed(3)),
      };
    });

    if (rows.length === 0) {
      setMessage("Aucun score à calculer.");
      return;
    }

    const { error: upsertError } = await supabase
      .from("weekly_scores")
      .upsert(rows, {
        onConflict: "user_id,week",
      });

    if (upsertError) {
      setMessage("Erreur : " + upsertError.message);
      return;
    }

    setMessage("Classements calculés ✅");
  };

  if (!user) {
    return (
      <main style={{ padding: 20 }}>
        <h1>Admin</h1>
        <p>Connecte-toi.</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 20 }}>
        <h1>Accès refusé ❌</h1>
        <p>Tu n'es pas administrateur.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>Admin</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      <button onClick={updateEspnScores} style={{ padding: 12, marginRight: 10 }}>
        Mettre à jour les scores ESPN
      </button>

      <button onClick={calculateScores} style={{ padding: 12 }}>
        Calculer les classements
      </button>

      <p>{message}</p>
    </main>
  );
}
