"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function TousLesChoix() {
  const [picks, setPicks] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadPicks() {
      const { data, error } = await supabase
        .from("picks")
        .select(`
          id,
          picked_team,
          predicted_spread,
          user_id,
          games (
            week,
            away_team,
            home_team
          )
        `)
        .order("created_at", { ascending: true });

      if (error) {
        setMessage("Erreur : " + error.message);
        return;
      }

      setPicks(data || []);
    }

    loadPicks();
  }, []);

  const grouped = picks.reduce((acc, pick) => {
    const user = pick.user_id;
    if (!acc[user]) acc[user] = [];
    acc[user].push(pick);
    return acc;
  }, {});

  return (
    <main style={{ padding: 20 }}>
      <h1>Tous les choix</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      {message && <p>{message}</p>}

      {Object.keys(grouped).length === 0 && (
        <p>Aucun choix soumis pour le moment.</p>
      )}

      {Object.entries(grouped).map(([userId, userPicks]) => (
        <section
          key={userId}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 15,
            marginBottom: 20,
            maxWidth: 600,
          }}
        >
          <h2>Joueur : {userId}</h2>

          {userPicks.map((pick) => (
            <div key={pick.id} style={{ marginBottom: 12 }}>
              <strong>
                {pick.games?.away_team} @ {pick.games?.home_team}
              </strong>
              <br />
              Choix : {pick.picked_team} par {pick.predicted_spread}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
