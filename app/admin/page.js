"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUser = sessionData.session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        const { data: adminData } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();

        setIsAdmin(adminData?.is_admin === true);
      }

      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      setSettings(settingsData);
    }

    load();
  }, []);

  async function loadSettings() {
    const { data } = await supabase.from("settings").select("*").single();
    setSettings(data);
    return data;
  }

  async function updateScoresFromEspn(currentWeek) {
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("*")
      .eq("week", currentWeek);

    if (gamesError) throw new Error("Games : " + gamesError.message);

    let updated = 0;

    for (const game of games || []) {
      if (!game.external_game_id) continue;

      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
        `?event=${game.external_game_id}`;

      const response = await fetch(url);
      const data = await response.json();

      const competition = data.header?.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");

      if (!home || !away) continue;

      const completed = competition.status?.type?.completed === true;

      if (!completed) continue;

      const { error } = await supabase
        .from("games")
        .update({
          home_score: Number(home.score),
          away_score: Number(away.score),
        })
        .eq("id", game.id);

      if (!error) updated++;
    }

    return updated;
  }

  async function updateQBRatingsFromEspn(currentWeek) {
    const { data: qbPicks, error: qbPicksError } = await supabase
      .from("qb_picks")
      .select(`
        *,
        qbs (
          id,
          name,
          team,
          espn_athlete_id
        )
      `)
      .eq("week", currentWeek);

    if (qbPicksError) throw new Error("QB picks : " + qbPicksError.message);

    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("*")
      .eq("week", currentWeek);

    if (gamesError) throw new Error("Games : " + gamesError.message);

    let updated = 0;
    const notFound = [];

    for (const pick of qbPicks || []) {
      const selectedQB = pick.qbs;

      if (!selectedQB?.team) {
        notFound.push(selectedQB?.name || "QB sans équipe");
        continue;
      }

      const qbTeam = selectedQB.team.toLowerCase();

      const game = (games || []).find((g) => {
        const home = (g.home_team || "").toLowerCase();
        const away = (g.away_team || "").toLowerCase();

        return home.includes(qbTeam) || away.includes(qbTeam);
      });

      if (!game?.external_game_id) {
        notFound.push(selectedQB.name);
        continue;
      }

      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
        `?event=${game.external_game_id}`;

      const response = await fetch(url);
      const summary = await response.json();

      const boxscoreTeams = summary.boxscore?.players || [];
      let passingAthletes = [];

      for (const teamBox of boxscoreTeams) {
        const teamName =
          teamBox.team?.shortDisplayName ||
          teamBox.team?.displayName ||
          teamBox.team?.name ||
          "";

        if (!teamName.toLowerCase().includes(qbTeam)) continue;

        const passingCategory = teamBox.statistics?.find(
          (category) =>
            category.name === "passing" ||
            category.displayName === "Passing"
        );

        if (!passingCategory) continue;

        const labels = passingCategory.labels || [];
        const ratingIndex = labels.findIndex((label) =>
          ["RTG", "RAT", "RATE"].includes(String(label).toUpperCase())
        );

        if (ratingIndex === -1) continue;

        passingAthletes = passingCategory.athletes
          .map((row) => ({
            id: row.athlete?.id,
            name: row.athlete?.displayName,
            rating: Number(row.stats?.[ratingIndex]),
          }))
          .filter((row) => !Number.isNaN(row.rating));
      }

      if (passingAthletes.length === 0) {
        notFound.push(selectedQB.name);
        continue;
      }

      let actualQB = passingAthletes[0];

      if (selectedQB.espn_athlete_id) {
        const exactMatch = passingAthletes.find(
          (athlete) => athlete.id === selectedQB.espn_athlete_id
        );

        if (exactMatch) actualQB = exactMatch;
      } else {
        const nameMatch = passingAthletes.find((athlete) =>
          athlete.name?.toLowerCase().includes(selectedQB.name.toLowerCase())
        );

        if (nameMatch) actualQB = nameMatch;
      }

      const { error } = await supabase.from("qb_ratings").upsert(
        {
          qb_id: selectedQB.id,
          week: currentWeek,
          passer_rating: actualQB.rating,
          actual_qb_name: actualQB.name,
          actual_espn_athlete_id: actualQB.id,
        },
        { onConflict: "qb_id,week" }
      );

      if (error) {
        notFound.push(`${selectedQB.name} (${error.message})`);
      } else {
        updated++;
      }
    }

    return { updated, notFound };
  }

  async function calculateScores(currentWeek) {
    const { data: picks, error: picksError } = await supabase.from("picks")
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

    if (picksError) throw new Error("Picks : " + picksError.message);

    const { data: qbPicks } = await supabase
      .from("qb_picks")
      .select("*")
      .eq("week", currentWeek);

    const { data: qbRatings } = await supabase
      .from("qb_ratings")
      .select("*")
      .eq("week", currentWeek);

    const scoresByUser = {};

    (picks || [])
      .filter((pick) => pick.games?.week === currentWeek)
      .forEach((pick) => {
        const game = pick.games;

        if (game.home_score == null || game.away_score == null) return;

        let winner = null;

        if (game.home_score > game.away_score) winner = game.home_team;
        if (game.away_score > game.home_score) winner = game.away_team;

        const realSpread = Math.abs(game.home_score - game.away_score);

        let points = 0;

        if (pick.picked_team === winner) {
          points = 1;
          if (Number(pick.predicted_spread) === realSpread) points = 2;
        }

        scoresByUser[pick.user_id] =
          (scoresByUser[pick.user_id] || 0) + points;
      });

    const rows = Object.entries(scoresByUser).map(([userId, basePoints]) => {
      const qbPick = (qbPicks || []).find((p) => p.user_id === userId);
      const qbRating = (qbRatings || []).find(
        (r) => r.qb_id === qbPick?.qb_id
      );

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

    if (rows.length === 0) return 0;

    const { error } = await supabase.from("weekly_scores").upsert(rows, {
      onConflict: "user_id,week",
    });

    if (error) throw new Error("Weekly scores : " + error.message);

    return rows.length;
  }

  const fullUpdate = async () => {
    try {
      setMessage("Mise à jour complète en cours...");

      const currentSettings = await loadSettings();
      const currentWeek = currentSettings.current_week;

      const scoresUpdated = await updateScoresFromEspn(currentWeek);
      const qbResult = await updateQBRatingsFromEspn(currentWeek);
      const rankingsCalculated = await calculateScores(currentWeek);

      let finalMessage =
        `Mise à jour complète ✅ ` +
        `Scores ESPN : ${scoresUpdated}. ` +
        `QB ratings : ${qbResult.updated}. ` +
        `Classements : ${rankingsCalculated}.`;

      if (qbResult.notFound.length > 0) {
        finalMessage += ` Non trouvés : ${qbResult.notFound.join(", ")}`;
      }

      setMessage(finalMessage);
    } catch (error) {
      setMessage("Erreur mise à jour : " + error.message);
    }
  };

  const nextWeek = async () => {
    const confirmation = window.confirm(
      "Passer à la semaine suivante? Assure-toi que les scores sont calculés."
    );

    if (!confirmation) return;

    const currentSettings = await loadSettings();
    const newWeek = Number(currentSettings.current_week || 1) + 1;

    const { error } = await supabase
      .from("settings")
      .update({ current_week: newWeek })
      .eq("id", 1);

    if (error) {
      setMessage("Erreur semaine suivante : " + error.message);
      return;
    }

    setSettings({
      ...currentSettings,
      current_week: newWeek,
    });

    setMessage(`Semaine active changée à ${newWeek} ✅`);
  };

  if (!user) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Admin ⚙️</h1>
          <p>Connecte-toi pour accéder à l’administration.</p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Accès refusé ❌</h1>
          <p>Tu n'es pas administrateur.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Admin ⚙️</h1>
        <p>
          Saison {settings?.current_season || "..."} — semaine{" "}
          {settings?.current_week || "..."}
        </p>
      </section>

      <p>
        <a href="/">← Retour accueil</a>
      </p>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      <section className="card">
        <h2>Mise à jour complète</h2>
        <p style={{ color: "#94a3b8" }}>
          Met à jour les scores ESPN, les passer ratings QB et les classements
          pour la semaine active.
        </p>

        <button className="button" onClick={fullUpdate}>
          Mettre à jour résultats + QB + classements
        </button>
      </section>

      <section className="card">
        <h2>Semaine active</h2>
        <p style={{ color: "#94a3b8" }}>
          À utiliser quand la semaine est terminée et validée.
        </p>

        <button className="button-secondary" onClick={nextWeek}>
          Passer à la semaine suivante
        </button>
      </section>

      <nav className="bottom-nav">
        <a href="/">
          <strong>🏠</strong>
          Accueil
        </a>
        <a href="/matchs">
          <strong>✅</strong>
          Mes choix
        </a>
        <a href="/qb">
          <strong>🎯</strong>
          QB
        </a>
        <a href="/classements">
          <strong>🏆</strong>
          Classements
        </a>
        <a href="/tous-les-choix">
          <strong>👀</strong>
          Choix
        </a>
      </nav>
    </main>
  );
}
