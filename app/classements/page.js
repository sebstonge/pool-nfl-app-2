"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function displayName(user, fallbackId) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return fallbackId;
}

function initials(name) {
  return String(name || "Joueur").slice(0, 2).toUpperCase();
}

function medal(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function RankingRow({ row, mode }) {
  const movement =
    row.movement > 0
      ? `⬆️ +${row.movement}`
      : row.movement < 0
      ? `⬇️ ${row.movement}`
      : "➖";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "14px 0",
        borderBottom: "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
          fontSize: row.rank <= 3 ? 24 : 18,
        }}
      >
        {row.rank <= 3 ? medal(row.rank) : row.rank}
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>{row.name}</h3>

          {mode === "season" && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color:
                  row.movement > 0
                    ? "#22c55e"
                    : row.movement < 0
                    ? "#ef4444"
                    : "#94a3b8",
              }}
            >
              {movement}
            </span>
          )}
        </div>

        <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
          {mode === "season"
            ? `Moyenne : ${row.average.toFixed(3)}`
            : row.rank === 1
            ? "Meneur"
            : ""}
        </p>

        {mode === "season" && row.rank !== 1 && (
          <p style={{ margin: "4px 0 0 0", color: "#ef4444" }}>
            -{row.diff.toFixed(3)} du meneur
          </p>
        )}

        {mode === "week" && row.rank !== 1 && (
          <p style={{ margin: "4px 0 0 0", color: "#ef4444" }}>
            -{row.diff.toFixed(3)} du meneur
          </p>
        )}
      </div>

      <div
        style={{
          fontSize: 30,
          fontWeight: 900,
          color: "#22c55e",
          textAlign: "right",
        }}
      >
        {(mode === "season" ? row.total : row.score).toFixed(3)}
      </div>
    </div>
  );
}

function PodiumCard({ row, size = "small" }) {
  if (!row) return null;

  const isBig = size === "big";

  return (
    <div
      style={{
        padding: isBig ? 24 : 18,
        borderRadius: 24,
        background:
          row.rank === 1
            ? "linear-gradient(180deg, rgba(34,197,94,0.20), rgba(15,23,42,0.70))"
            : "rgba(15,23,42,0.72)",
        border:
          row.rank === 1
            ? "1px solid rgba(34,197,94,0.35)"
            : "1px solid rgba(148,163,184,0.16)",
        textAlign: "center",
        minHeight: isBig ? 230 : 190,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div style={{ fontSize: isBig ? 42 : 32 }}>
        {medal(row.rank)}
      </div>

      <h3
        style={{
          margin: "28px 0 8px 0",
          fontSize: isBig ? 24 : 18,
          lineHeight: 1.1,
          wordBreak: "break-word",
        }}
      >
        {row.name}
      </h3>

      <div
        style={{
          fontSize: isBig ? 42 : 30,
          fontWeight: 900,
          color: "#22c55e",
        }}
      >
        {(row.total ?? row.score).toFixed(3)}
      </div>
    </div>
  );
}

export default function ClassementsPage() {
  const [tab, setTab] = useState("week");
  const [week, setWeek] = useState(1);
  const [weekly, setWeekly] = useState([]);
  const [season, setSeason] = useState([]);

  useEffect(() => {
    async function loadData() {
      const { data: settings } = await supabase
        .from("settings")
        .select("*")
        .single();

      const currentWeek = settings?.current_week || 1;
      setWeek(currentWeek);

      const { data: users } = await supabase
        .from("users")
        .select("id, email, display_name");

      const { data: allScores } = await supabase
        .from("weekly_scores")
        .select("*")
        .order("week", { ascending: true });

      const getUserName = (userId) => {
        const user = users?.find((u) => u.id === userId);
        return displayName(user, userId);
      };

      const weekScores = (allScores || [])
        .filter((score) => score.week === currentWeek)
        .sort(
          (a, b) =>
            Number(b.final_score || 0) - Number(a.final_score || 0)
        );

      const weekLeader = Number(weekScores?.[0]?.final_score || 0);

      setWeekly(
        weekScores.map((score, index) => ({
          rank: index + 1,
          userId: score.user_id,
          name: getUserName(score.user_id),
          score: Number(score.final_score || 0),
          diff: weekLeader - Number(score.final_score || 0),
        }))
      );

      function buildSeasonRows(scores) {
        const grouped = {};

        for (const score of scores || []) {
          if (!grouped[score.user_id]) {
            grouped[score.user_id] = {
              userId: score.user_id,
              name: getUserName(score.user_id),
              total: 0,
              weeks: 0,
            };
          }

          grouped[score.user_id].total += Number(score.final_score || 0);
          grouped[score.user_id].weeks += 1;
        }

        return Object.values(grouped).sort((a, b) => b.total - a.total);
      }

      const seasonRows = buildSeasonRows(allScores || []);
      const previousSeasonRows = buildSeasonRows(
        (allScores || []).filter((score) => score.week < currentWeek)
      );

      const previousRanks = {};
      previousSeasonRows.forEach((row, index) => {
        previousRanks[row.userId] = index + 1;
      });

      const seasonLeader = Number(seasonRows?.[0]?.total || 0);

      setSeason(
        seasonRows.map((row, index) => {
          const currentRank = index + 1;
          const previousRank = previousRanks[row.userId] || currentRank;

          return {
            ...row,
            rank: currentRank,
            average: row.weeks > 0 ? row.total / row.weeks : 0,
            diff: seasonLeader - row.total,
            movement: previousRank - currentRank,
          };
        })
      );
    }

    loadData();
  }, []);

  const rows = tab === "week" ? weekly : season;
  const topThree = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <main className="page">
      <section className="header-card">
        <h1>Classements 🏆</h1>
        <p>Semaine {week} et saison complète</p>
      </section>

      <section
        className="card"
        style={{
          padding: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <button
          className={tab === "week" ? "button" : "button-secondary"}
          onClick={() => setTab("week")}
        >
          Semaine {week}
        </button>

        <button
          className={tab === "season" ? "button" : "button-secondary"}
          onClick={() => setTab("season")}
        >
          Saison complète
        </button>
      </section>

      {rows.length === 0 ? (
        <section className="card">
          <p>Aucun score pour le moment.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              Podium {tab === "week" ? `semaine ${week}` : "saison"}
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.25fr 1fr",
                gap: 12,
                alignItems: "end",
              }}
            >
              <PodiumCard row={topThree[1]} />
              <PodiumCard row={topThree[0]} size="big" />
              <PodiumCard row={topThree[2]} />
            </div>
          </section>

          {rows.length > 3 && (
            <section className="card">
              {rows.slice(3).map((row) => (
                <RankingRow
                  key={row.userId}
                  row={row}
                  mode={tab === "week" ? "week" : "season"}
                />
              ))}
            </section>
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}
