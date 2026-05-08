"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function Import2025Page() {
  const [message, setMessage] = useState("");

  const importWeeks = async () => {
    setMessage("Import des semaines 1 à 6 en cours...");

    let total = 0;

    for (let week = 1; week <= 6; week++) {
      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
        `?seasontype=2&week=${week}&dates=2025`;

      const response = await fetch(url);
      const data = await response.json();

      for (const event of data.events || []) {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];

        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");

        if (!home || !away) continue;

        const homeTeam =
          home.team?.shortDisplayName ||
          home.team?.displayName ||
          home.team?.name;

        const awayTeam =
          away.team?.shortDisplayName ||
          away.team?.displayName ||
          away.team?.name;

        const completed = competition.status?.type?.completed === true;

        const { error } = await supabase.from("games").upsert(
          {
            external_game_id: event.id,
            week,
            season: 2025,
            home_team: homeTeam,
            away_team: awayTeam,
            game_date: event.date,
            home_score: completed ? Number(home.score) : null,
            away_score: completed ? Number(away.score) : null,
            is_pool_eligible: false,
          },
          { onConflict: "external_game_id" }
        );

        if (!error) total++;
      }
    }

    setMessage(`Import terminé ✅ ${total} matchs importés/mis à jour.`);
  };

  return (
    <main className="page">
      <section className="header-card">
        <h1>Import test 2025</h1>
        <p>Importe les vrais matchs ESPN des semaines 1 à 6.</p>
      </section>

      <section className="card">
        <button className="button" onClick={importWeeks}>
          Importer semaines 1 à 6 — 2025
        </button>

        {message && <p>{message}</p>}
      </section>
    </main>
  );
}
