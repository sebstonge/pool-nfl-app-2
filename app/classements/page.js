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

<p
  style={{
    margin: "4px 0 0 0",
    color: "#f8fafc",
    fontWeight: 800,
    fontSize: 16,
  }}
>
  {(mode === "season" ? row.total : row.score).toFixed(3)} pts
</p>

{row.rank !== 1 && (
  <p
    style={{
      margin: "4px 0 0 0",
      color: "#ef4444",
      fontSize: 14,
    }}
  >
    -{row.diff.toFixed(3)} du meneur
  </p>
)}

{mode === "season" && (
  <p
    style={{
      margin: "4px 0 0 0",
      color: "#94a3b8",
      fontSize: 14,
    }}
  >
    Moy. {row.average.toFixed(3)} / semaine
  </p>
)}
{mode === "season" && row.badges?.length > 0 && (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8,
    }}
  >
    {row.badges.map((badge) => (
      <span
        key={badge}
        style={{
          padding: "5px 9px",
          borderRadius: 999,
          background: "rgba(148,163,184,0.14)",
          color: "#e2e8f0",
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {badge}
      </span>
    ))}
  </div>
)}
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
function buildRankProgression(weeklyScores, users) {
  const weeks = Array.from(
    new Set((weeklyScores || []).map((score) => score.week))
  ).sort((a, b) => a - b);

  const totalsByUser = {};
  const progression = {};

  weeks.forEach((week) => {
    (weeklyScores || [])
      .filter((score) => score.week === week)
      .forEach((score) => {
        if (!totalsByUser[score.user_id]) {
          totalsByUser[score.user_id] = 0;
        }

        totalsByUser[score.user_id] += Number(score.final_score || 0);
      });

    const ranked = Object.entries(totalsByUser)
      .map(([userId, total]) => {
        const user = users.find((u) => u.id === userId);

        return {
          userId,
          name: displayName(user),
          total,
        };
      })
      .sort((a, b) => b.total - a.total);

    ranked.forEach((row, index) => {
      if (!progression[row.userId]) {
        progression[row.userId] = {
          userId: row.userId,
          name: row.name,
          points: [],
        };
      }

      progression[row.userId].points.push({
        week,
        rank: index + 1,
      });
    });
  });

  return {
    weeks,
    rows: Object.values(progression),
  };
}

function RankProgressionChart({ progression }) {
  if (!progression?.weeks?.length || !progression?.rows?.length) {
    return (
      <section className="card">
        <h2>Progression au classement 📈</h2>
        <p style={{ color: "#94a3b8" }}>
          Aucun classement historique pour le moment.
        </p>
      </section>
    );
  }

  const weeks = progression.weeks;
  const rows = progression.rows.slice(0, 8);
  const maxRank = Math.max(...rows.flatMap((row) => row.points.map((p) => p.rank)));

  const width = 720;
  const height = 320;
  const paddingLeft = 46;
  const paddingRight = 20;
  const paddingTop = 24;
  const paddingBottom = 46;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const colors = [
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#f97316",
    "#ef4444",
    "#facc15",
    "#14b8a6",
    "#ec4899",
  ];

  const xForWeek = (week) => {
    const index = weeks.indexOf(week);
    if (weeks.length === 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (weeks.length - 1)) * chartWidth;
  };

  const yForRank = (rank) => {
    if (maxRank === 1) return paddingTop + chartHeight / 2;
    return paddingTop + ((rank - 1) / (maxRank - 1)) * chartHeight;
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Progression au classement 📈</h2>
      <p style={{ marginTop: -6, color: "#94a3b8" }}>
        Rang cumulatif par semaine
      </p>

      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: "100%",
            minWidth: 620,
            height: "auto",
          }}
        >
          {[...Array(maxRank)].map((_, index) => {
            const rank = index + 1;
            const y = yForRank(rank);

            return (
              <g key={rank}>
                <text
                  x={8}
                  y={y + 5}
                  fill="#cbd5e1"
                  fontSize="15"
                  fontWeight="800"
                >
                  #{rank}
                </text>

                <line
                  x1={paddingLeft}
                  x2={width - paddingRight}
                  y1={y}
                  y2={y}
                  stroke="rgba(148,163,184,0.12)"
                  strokeWidth="1"
                />
              </g>
            );
          })}

          {weeks.map((week) => {
            const x = xForWeek(week);

            return (
              <text
                key={week}
                x={x}
                y={height - 16}
                textAnchor="middle"
                fill="#cbd5e1"
                fontSize="14"
                fontWeight="800"
              >
                S{week}
              </text>
            );
          })}

          {rows.map((row, rowIndex) => {
            const color = colors[rowIndex % colors.length];

            const points = row.points
              .map((point) => `${xForWeek(point.week)},${yForRank(point.rank)}`)
              .join(" ");

            return (
              <g key={row.userId}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {row.points.map((point) => (
                  <circle
                    key={`${row.userId}-${point.week}`}
                    cx={xForWeek(point.week)}
                    cy={yForRank(point.rank)}
                    r="6"
                    fill={color}
                    stroke="#020617"
                    strokeWidth="2"
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 12,
        }}
      >
        {rows.map((row, index) => (
          <div
            key={row.userId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: colors[index % colors.length],
                display: "inline-block",
              }}
            />
            {row.name}
          </div>
        ))}
      </div>
    </section>
  );
}
export default function ClassementsPage() {
  const [tab, setTab] = useState("week");
  const [week, setWeek] = useState(1);
  const [weekly, setWeekly] = useState([]);
  const [season, setSeason] = useState([]);
const [rankProgression, setRankProgression] = useState(null);
  
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
const weeklyRankings = {};

(allScores || []).forEach((score) => {
  if (!weeklyRankings[score.week]) {
    weeklyRankings[score.week] = [];
  }

  weeklyRankings[score.week].push(score);
});

Object.keys(weeklyRankings).forEach((week) => {
  weeklyRankings[week] = weeklyRankings[week]
    .sort(
      (a, b) =>
        Number(b.final_score || 0) -
        Number(a.final_score || 0)
    )
    .map((score, index) => ({
      userId: score.user_id,
      rank: index + 1,
    }));
});
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
const rankProgression = buildRankProgression(
  allScores || [],
  users || []
);
      setSeason(
        seasonRows.map((row, index) => {
const currentRank = index + 1;
const previousRank = previousRanks[row.userId] || currentRank;
const movement = previousRank - currentRank;

const badges = [];
          const recentWeeks = Object.keys(weeklyRankings)
  .map(Number)
  .sort((a, b) => b - a)
  .slice(0, 3);

const recentRanks = recentWeeks.map((week) => {
  const found = weeklyRankings[week]?.find(
    (r) => r.userId === row.userId
  );

  return found?.rank || 999;
});

if (recentRanks.length === 3) {
  if (recentRanks.every((rank) => rank <= 3)) {
    badges.push("🔥 En feu");
  }

  if (recentRanks.every((rank) => rank > 3)) {
    badges.push("🧊 Glacé");
  }
}

if (movement <= -3) {
  badges.push("📉 Chute libre");
}
        return {
  ...row,
  rank: currentRank,
  average: row.weeks > 0 ? row.total / row.weeks : 0,
  diff: seasonLeader - row.total,
  movement: previousRank - currentRank,
  badges,
};
        })
      );
    setRankProgression(rankProgression);
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
{tab === "season" && rankProgression && (
  <RankProgressionChart progression={rankProgression} />
)}
      <BottomNav />
    </main>
  );
}
