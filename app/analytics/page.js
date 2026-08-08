"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "Joueur";
}

function statValue(row) {
  return Number(row?.final_score ?? row?.score ?? row?.total_score ?? row?.points ?? 0);
}

function StatCard({ icon, title, value, subtitle, color = "#22c55e" }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
      <p style={{ margin: 0, color: "#cbd5e1", fontWeight: 800 }}>{title}</p>
      <h2 style={{ margin: "8px 0", color, fontSize: 34 }}>{value}</h2>
      <p style={{ margin: 0, color: "#94a3b8" }}>{subtitle}</p>
    </div>
  );
}
function QBRecordCard({
  icon,
  title,
  qb,
  teams,
  color = "#22c55e",
  isAverage = false,
}) {
  const team = teams.find(
    (t) =>
      t.name?.toLowerCase().trim() ===
      qb?.team?.toLowerCase().trim()
  );

  const logo = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo || null;

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 10 }}>
        {icon}
      </div>

      <p
        style={{
          margin: "0 0 12px 0",
          color: "#cbd5e1",
          fontWeight: 800,
        }}
      >
        {title}
      </p>

      {!qb ? (
        <p style={{ color: "#94a3b8" }}>Aucune donnée</p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <strong
              style={{
                fontSize: 20,
                color: "#f8fafc",
              }}
            >
              {qb.name}
            </strong>

            {logo && (
              <img
                src={logo}
                alt={qb.team}
                style={{
                  width: 34,
                  height: 34,
                  objectFit: "contain",
                }}
              />
            )}
          </div>

          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              color,
              marginBottom: 8,
            }}
          >
            {qb.rating.toFixed(1)}
          </div>

          {isAverage ? (
  <p style={{ margin: "3px 0", color: "#94a3b8" }}>
    {qb.detail}
  </p>
) : (
  <>
    <p style={{ margin: "3px 0", color: "#94a3b8" }}>
      Semaine {qb.week}
    </p>

    <p style={{ margin: "3px 0", color: "#94a3b8" }}>
      Choisi par {qb.selectedBy}
    </p>
  </>
)}
        </>
      )}
    </div>
  );
}
function MiniRanking({ title, rows, valueLabel }) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>

      {rows.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Aucune donnée.</p>
      ) : (
        rows.slice(0, 5).map((row, index) => (
          <div
            key={row.userId || index}
            style={{
              display: "grid",
              gridTemplateColumns: "42px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 0",
              borderBottom: "1px solid rgba(148,163,184,0.12)",
            }}
          >
            <strong style={{ color: index < 3 ? "#22c55e" : "#94a3b8" }}>
              #{index + 1}
            </strong>

            <div>
              <strong>{row.name}</strong>
              <p style={{ margin: "3px 0 0 0", color: "#94a3b8" }}>
                {row.detail}
              </p>
            </div>

            <strong style={{ color: "#22c55e", fontSize: 22 }}>
              {row.value}
              {valueLabel}
            </strong>
          </div>
        ))
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
const [teams, setTeams] = useState([]);
  useEffect(() => {
    async function loadData() {
      setLoading(true);

const { data: teamsData } = await supabase
  .from("teams")
  .select("*");

setTeams(teamsData || []);

const { data: usersData } = await supabase
        .from("users")
        .select("id, email, display_name");

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
        setMessage("Erreur picks : " + picksError.message);
        setLoading(false);
        return;
      }

      const { data: weeklyScores } = await supabase
        .from("weekly_scores")
        .select("*");

      const { data: qbRatings } = await supabase
        .from("qb_ratings")
        .select("*");

      const { data: qbPicks } = await supabase
        .from("qb_picks")
        .select("*");

      const { data: qbs } = await supabase
        .from("qbs")
        .select("*");

      const users = usersData || [];
      const picks = (picksData || []).filter(
        (p) => p.games?.home_score != null && p.games?.away_score != null
      );

      const byUser = {};

      users.forEach((user) => {
        byUser[user.id] = {
          userId: user.id,
          name: displayName(user),
          totalPicks: 0,
          correctWinners: 0,
          exactMargins: 0,
          wrong: 0,
        };
      });

      picks.forEach((pick) => {
        const game = pick.games;
        const winner =
          game.home_score > game.away_score ? game.home_team : game.away_team;
        const realSpread = Math.abs(game.home_score - game.away_score);

        if (!byUser[pick.user_id]) {
          const user = users.find((u) => u.id === pick.user_id);
          byUser[pick.user_id] = {
            userId: pick.user_id,
            name: displayName(user),
            totalPicks: 0,
            correctWinners: 0,
            exactMargins: 0,
            wrong: 0,
          };
        }

        byUser[pick.user_id].totalPicks += 1;

        if (pick.picked_team === winner) {
          byUser[pick.user_id].correctWinners += 1;

          if (Number(pick.predicted_spread) === realSpread) {
            byUser[pick.user_id].exactMargins += 1;
          }
        } else {
          byUser[pick.user_id].wrong += 1;
        }
      });

      const userRows = Object.values(byUser).filter((u) => u.totalPicks > 0);

      const topExact = [...userRows]
        .sort((a, b) => b.exactMargins - a.exactMargins)
        .map((u) => ({
          ...u,
          value: u.exactMargins,
          detail: `${u.exactMargins} / ${u.totalPicks} choix`,
        }));

      const topCorrect = [...userRows]
        .sort((a, b) => b.correctWinners - a.correctWinners)
        .map((u) => ({
          ...u,
          value: u.correctWinners,
          detail: `${Math.round((u.correctWinners / u.totalPicks) * 100)} % de bons gagnants`,
        }));

      const weeklyRows = (weeklyScores || []).map((row) => {
        const user = users.find((u) => u.id === row.user_id);
        return {
          ...row,
          name: displayName(user),
          score: statValue(row),
        };
      });

      const bestWeek = [...weeklyRows].sort((a, b) => b.score - a.score)[0];
      const worstWeek = [...weeklyRows].sort((a, b) => a.score - b.score)[0];

      const totalPicks = userRows.reduce((sum, u) => sum + u.totalPicks, 0);
      const totalCorrect = userRows.reduce((sum, u) => sum + u.correctWinners, 0);
      const totalExact = userRows.reduce((sum, u) => sum + u.exactMargins, 0);

      const bestQb = [...(qbRatings || [])].sort(
        (a, b) => Number(b.passer_rating || 0) - Number(a.passer_rating || 0)
      )[0];

      const worstQb = [...(qbRatings || [])].sort(
        (a, b) => Number(a.passer_rating || 999) - Number(b.passer_rating || 999)
      )[0];

     function qbLabel(rating) {
  if (!rating) return null;

  const selectedQb = (qbs || []).find(
    (q) => q.id === rating.qb_id
  );

  const actualQb = rating.actual_espn_athlete_id
    ? (qbs || []).find(
        (q) =>
          String(q.espn_athlete_id) ===
          String(rating.actual_espn_athlete_id)
      )
    : null;

  const qbName =
    rating.actual_qb_name ||
    actualQb?.name ||
    selectedQb?.name ||
    "QB";

  const pick = (qbPicks || []).find(
    (p) =>
      p.qb_id === rating.qb_id &&
      p.week === rating.week
  );

  const user = users.find(
    (u) => u.id === pick?.user_id
  );

  return {
    name: qbName,
    team: actualQb?.team || selectedQb?.team || "",
    rating: Number(rating.passer_rating),
    week: rating.week,
    selectedBy: displayName(user),
  };
}
     const qbAverageRows = Object.values(
  (qbRatings || []).reduce((acc, rating) => {
    const selectedQb = (qbs || []).find(
      (q) => q.id === rating.qb_id
    );

    const athleteId =
      rating.actual_espn_athlete_id ||
      selectedQb?.espn_athlete_id;

    if (!athleteId) return acc;

    const key = String(athleteId);

    if (!acc[key]) {
      const actualQb = (qbs || []).find(
        (q) =>
          String(q.espn_athlete_id) ===
          String(athleteId)
      );

      acc[key] = {
        espn_athlete_id: key,
        name:
          rating.actual_qb_name ||
          actualQb?.name ||
          selectedQb?.name ||
          "QB",
        team:
          actualQb?.team ||
          selectedQb?.team ||
          "",
        total: 0,
        count: 0,
      };
    }

    acc[key].total += Number(
      rating.passer_rating || 0
    );

    acc[key].count += 1;

    return acc;
  }, {})
)
  .map((row) => ({
    name: row.name,
    team: row.team,
    rating: row.total / row.count,
    detail: `${row.count} utilisation${
      row.count > 1 ? "s" : ""
    }`,
  }))
  .sort((a, b) => b.rating - a.rating);

      setStats({
        bestWeek,
        worstWeek,
        totalPicks,
        totalCorrect,
        totalExact,
        topExact,
        topCorrect,
        bestQb: qbLabel(bestQb),
        worstQb: qbLabel(worstQb),
        qbAverageRows,
      });

      setLoading(false);
    }

    loadData();
  }, []);

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <section className="header-card">
        <h1>Statistiques avancées 📈</h1>
        <p>Records et statistiques de la saison.</p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {loading && (
        <section className="card">
          <p>Chargement des statistiques...</p>
        </section>
      )}

      {!loading && stats && (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Records de saison</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  typeof window !== "undefined" && window.innerWidth < 800
                    ? "1fr"
                    : "repeat(4, 1fr)",
                gap: 12,
              }}
            >
              <StatCard
                icon="🏆"
                title="Meilleur score semaine"
                value={stats.bestWeek ? `${stats.bestWeek.score.toFixed(3)}` : "--"}
                subtitle={
                  stats.bestWeek
                    ? `${stats.bestWeek.name} — Semaine ${stats.bestWeek.week}`
                    : "Aucune donnée"
                }
                color="#facc15"
              />

              <StatCard
                icon="🎯"
                title="Écarts exacts"
                value={stats.totalExact}
                subtitle="Total de la saison"
              />

              <StatCard
                icon="✅"
                title="Bons gagnants"
                value={stats.totalCorrect}
                subtitle={`${stats.totalPicks} choix calculés`}
                color="#3b82f6"
              />

              <StatCard
                icon="📉"
                title="Pire semaine"
                value={stats.worstWeek ? `${stats.worstWeek.score.toFixed(3)}` : "--"}
                subtitle={
                  stats.worstWeek
                    ? `${stats.worstWeek.name} — Semaine ${stats.worstWeek.week}`
                    : "Aucune donnée"
                }
                color="#ef4444"
              />
            </div>
          </section>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                typeof window !== "undefined" && window.innerWidth < 900
                  ? "1fr"
                  : "1fr 1fr",
              gap: 16,
            }}
          >
            <MiniRanking
              title="Top écarts exacts 🎯"
              rows={stats.topExact}
              valueLabel=""
            />

            <MiniRanking
              title="Top bons gagnants ✅"
              rows={stats.topCorrect}
              valueLabel=""
            />
          </div>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Records QB 🔥</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  typeof window !== "undefined" && window.innerWidth < 900
                    ? "1fr"
                    : "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <QBRecordCard
  icon="🔥"
  title="Meilleur QB utilisé"
  qb={stats.bestQb}
  teams={teams}
/>

<QBRecordCard
  icon="💀"
  title="Pire QB utilisé"
  qb={stats.worstQb}
  teams={teams}
  color="#ef4444"
/>

              <QBRecordCard
  icon="📊"
  title="Meilleure moyenne QB"
  qb={stats.qbAverageRows[0] || null}
  teams={teams}
  color="#38bdf8"
  isAverage={true}
/>
            </div>
          </section>

          <section className="card">
            <p style={{ margin: 0, color: "#94a3b8" }}>
              ⭐ Les statistiques se mettent à jour automatiquement après le calcul des scores.
            </p>
          </section>
        </>
      )}

      <BottomNav />
    </main>
  );
}
