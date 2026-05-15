"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

function normalizeTeamName(name) {
  const map = {
    "Arizona Cardinals": "Cardinals",
    "Atlanta Falcons": "Falcons",
    "Baltimore Ravens": "Ravens",
    "Buffalo Bills": "Bills",
    "Carolina Panthers": "Panthers",
    "Chicago Bears": "Bears",
    "Cincinnati Bengals": "Bengals",
    "Cleveland Browns": "Browns",
    "Dallas Cowboys": "Cowboys",
    "Denver Broncos": "Broncos",
    "Detroit Lions": "Lions",
    "Green Bay Packers": "Packers",
    "Houston Texans": "Texans",
    "Indianapolis Colts": "Colts",
    "Jacksonville Jaguars": "Jaguars",
    "Kansas City Chiefs": "Chiefs",
    "Las Vegas Raiders": "Raiders",
    "Los Angeles Chargers": "Chargers",
    "Los Angeles Rams": "Rams",
    "Miami Dolphins": "Dolphins",
    "Minnesota Vikings": "Vikings",
    "New England Patriots": "Patriots",
    "New Orleans Saints": "Saints",
    "New York Giants": "Giants",
    "New York Jets": "Jets",
    "Philadelphia Eagles": "Eagles",
    "Pittsburgh Steelers": "Steelers",
    "San Francisco 49ers": "49ers",
    "Seattle Seahawks": "Seahawks",
    "Tampa Bay Buccaneers": "Buccaneers",
    "Tennessee Titans": "Titans",
    "Washington Commanders": "Commanders",
  };

  return map[name] || name;
}

function isPoolEligible(dateString) {
  const date = new Date(dateString);

  const day = date.getDay();
  const hour = date.getHours();

  // 0 = dimanche, 1 = lundi, 4 = jeudi, 6 = samedi

  if (day === 1) return true; // MNF
  if (day === 4) return true; // TNF / Thanksgiving
  if (day === 6) return true; // samedi / spécial

  if (day === 0 && hour < 12) return true; // international matin
  if (day === 0 && hour >= 19) return true; // SNF

  // Noël / matchs spéciaux en semaine
  if (![0, 1, 4, 6].includes(day)) return true;

  return false;
}

export default function Import2026Page() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState("");
  const [log, setLog] = useState([]);

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUser = sessionData.session?.user ?? null;

      setUser(currentUser);

      if (!currentUser) return;

      const { data: profile } = await supabase
        .from("users")
        .select("is_admin")
        .eq("id", currentUser.id)
        .maybeSingle();

      setIsAdmin(profile?.is_admin === true);
    }

    load();
  }, []);

  function addLog(text) {
    setLog((prev) => [text, ...prev]);
  }

  async function importSeason() {
    const confirmation = window.confirm(
      "Importer la saison 2026 complète? Les matchs existants avec le même ESPN ID seront mis à jour."
    );

    if (!confirmation) return;

    setMessage("Import en cours...");
    setLog([]);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    try {
      for (let week = 1; week <= 18; week++) {
        addLog(`Semaine ${week}...`);

        const url =
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
          `?seasontype=2&week=${week}&dates=2026`;

        const response = await fetch(url);

        if (!response.ok) {
          addLog(`Semaine ${week} : erreur ESPN ${response.status}`);
          continue;
        }

        const data = await response.json();
        const events = data.events || [];

        if (events.length === 0) {
          addLog(`Semaine ${week} : aucun match trouvé`);
          continue;
        }

        for (const event of events) {
          const competition = event.competitions?.[0];
          const competitors = competition?.competitors || [];

          const home = competitors.find((c) => c.homeAway === "home");
          const away = competitors.find((c) => c.homeAway === "away");

          if (!home || !away) {
            skipped++;
            continue;
          }

          const externalId = String(event.id);
          const gameDate = event.date || competition.date || null;

          const homeTeam = normalizeTeamName(home.team?.displayName);
          const awayTeam = normalizeTeamName(away.team?.displayName);

          const row = {
            week,
            away_team: awayTeam,
            home_team: homeTeam,
            game_date: gameDate,
            external_game_id: externalId,
            is_pool_eligible: isPoolEligible(gameDate),
            away_score: null,
            home_score: null,
          };

          const { data: existing } = await supabase
            .from("games")
            .select("id")
            .eq("external_game_id", externalId)
            .maybeSingle();

          if (existing?.id) {
            const { error } = await supabase
              .from("games")
              .update(row)
              .eq("id", existing.id);

            if (error) throw error;

            updated++;
          } else {
            const { error } = await supabase.from("games").insert(row);

            if (error) throw error;

            inserted++;
          }
        }

        addLog(`Semaine ${week} importée : ${events.length} matchs`);
      }

      await supabase
        .from("settings")
        .update({
          current_week: 1,
          current_season: 2026,
        })
        .neq("current_season", 9999);

      setMessage(
        `Import terminé ✅ Ajoutés : ${inserted}. Mis à jour : ${updated}. Ignorés : ${skipped}.`
      );
    } catch (error) {
      setMessage("Erreur import : " + error.message);
    }
  }

  if (!user) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Import 2026</h1>
          <p>Connecte-toi pour continuer.</p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Accès refusé</h1>
          <p>Admin seulement.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Import saison 2026 🏈</h1>
        <p>Import complet depuis ESPN, semaines 1 à 18.</p>
      </section>

      <section className="card">
        <button className="button" onClick={importSeason}>
          Importer saison 2026
        </button>

        {message && <p style={{ marginTop: 16 }}>{message}</p>}
      </section>

      {log.length > 0 && (
        <section className="card">
          <h2>Journal</h2>

          {log.map((item, index) => (
            <p key={index} style={{ margin: "6px 0", color: "#94a3b8" }}>
              {item}
            </p>
          ))}
        </section>
      )}
    </main>
  );
}
