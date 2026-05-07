"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score ? game.home_team : game.away_team;

  const realSpread = Math.abs(game.home_score - game.away_score);

  if (pick.picked_team !== winner) return "🔴";
  if (Number(pick.predicted_spread) === realSpread) return "🟢";
  return "🟡";
}

function GameResultLine({ game }) {
  const hasScore = game.home_score != null && game.away_score != null;

  if (!hasScore) {
    return (
      <strong>
        {game.away_team} @ {game.home_team}
      </strong>
    );
  }

  const homeWon = game.home_score > game.away_score;
  const awayWon = game.away_score > game.home_score;
  const realSpread = Math.abs(game.home_score - game.away_score);

  return (
    <strong>
      {awayWon ? (
        <strong>{game.away_team} ({game.away_score})</strong>
      ) : (
        <span>{game.away_team} ({game.away_score})</span>
      )}{" "}
      @{" "}
      {homeWon ? (
        <strong>{game.home_team} ({game.home_score})</strong>
      ) : (
        <span>{game.home_team} ({game.home_score})</span>
      )}{" "}
      - par {realSpread}
    </strong>
  );
}

export default function TousLesChoix() {
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadData() {
      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      const week = settingsData?.current_week || 1;
      setCurrentWeek(week);

      const { data: usersData } = await supabase
        .from("users")
        .select("id, email")
        .order("email", { ascending: true });

      setPlayers(usersData || []);

      const { data: picksData, error: picksError } = await supabase
        .from("picks")
        .select(`
          id,
          user_id,
          picked_team,
          predicted_spread,
          games (
            week,
            away_team,
            home_team,
            away_score,
            home_score
          )
        `);

      if (picksError) {
        setMessage("Erreur choix : " + picksError.message);
        return;
      }

      const weekPicks = (picksData || []).filter(
        (pick) => pick.games?.week === week
      );

      setPicks(weekPicks);

      const { data: qbData, error: qbError } = await supabase
        .from("qb_picks")
        .select(`
          id,
          user_id,
          week,
          qbs (
            name,
            team,
            logo
          )
        `)
        .eq("week", week);

      if (qbError) {
        setMessage("Erreur QB : " + qbError.message);
        return;
      }

      setQbPicks(qbData || []);
    }

    loadData();
  }, []);

  const allUserIds = Array.from(
    new Set([
      ...players.map((p) => p.id),
      ...picks.map((p) => p.user_id),
      ...qbPicks.map((q) => q.user_id),
    ])
  );

  return (
    <main className="page">
      <section className="header-card">
        <h1>Tous les choix 👀</h1>
        <p>Semaine {currentWeek}</p>
      </section>

      <p>
        <a href="/">← Retour accueil</a>
      </p>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {allUserIds.length === 0 && (
        <section className="card">
          <p>Aucun choix soumis pour le moment.</p>
        </section>
      )}

      {allUserIds.map((userId) => {
        const player = players.find((p) => p.id === userId);
        const playerPicks = picks.filter((pick) => pick.user_id === userId);
        const playerQB = qbPicks.find((qb) => qb.user_id === userId);

        return (
          <section key={userId} className="card">
            <h2 style={{ marginTop: 0 }}>{player?.email || "Joueur"}</h2>

            <div style={{ marginBottom: 16 }}>
              <strong>QB :</strong>{" "}
              {playerQB?.qbs ? (
                <span>{playerQB.qbs.name}</span>
              ) : (
                <span className="status-warning">Aucun QB soumis</span>
              )}
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb" }} />

            {playerPicks.length === 0 ? (
              <p className="status-warning">Aucun choix de match soumis.</p>
            ) : (
              playerPicks.map((pick) => (
                <div key={pick.id} style={{ marginBottom: 14 }}>
                  <GameResultLine game={pick.games} />
                  <br />
                  <span>
                    {getPickBadge(pick.games, pick)} Choix :{" "}
                    {pick.picked_team} par {pick.predicted_spread}
                  </span>
                </div>
              ))
            )}
          </section>
        );
      })}
    </main>
  );
}
