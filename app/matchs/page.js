"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Matchs() {
  const [games, setGames] = useState([]);

  useEffect(() => {
    async function fetchGames() {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("is_pool_eligible", true);

      if (error) {
        console.error(error);
      } else {
        setGames(data);
      }
    }

    fetchGames();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Matchs de la semaine</h1>

      {games.map((game) => (
        <div key={game.id} style={{ marginBottom: 20 }}>
          <strong>
            {game.away_team} @ {game.home_team}
          </strong>
        </div>
      ))}
    </main>
  );
}
