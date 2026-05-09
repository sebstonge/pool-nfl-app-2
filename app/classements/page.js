"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function shortName(email) {
  if (!email) return "Joueur";
  return email.split("@")[0];
}

function medal(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return rank;
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

      const { data: users } = await supabase.from("users").select("id, email");

      const { data: allScores } = await supabase
        .from("weekly_scores")
        .select("*")
        .order("week", { ascending: true });

      const getName = (userId) => {
        const user = users?.find((u) => u.id === userId);
        return shortName(user?.email || userId);
      };

      const weekScores = (allScores || [])
        .filter((s) => s.week === currentWeek)
        .sort((a, b) => Number(b.final_score) - Number(a.final_score));

      const weekLeader = Number(weekScores?.[0]?.final_score || 0);

      setWeekly(
        weekScores.map((row, index) => ({
          rank: index + 1,
          userId: row.user_id,
          name: getName(row.user_id),
          score: Number(row.final_score || 0),
          diff: weekLeader - Number(row.final_score || 0),
        }))
      );

      const grouped = {};

      for (const row of allScores || []) {
        if (!grouped[row.user_id]) {
          grouped[row.user_id] = {
            userId: row.user_id,
            name: getName(row.user_id),
            total: 0,
            weeks: 0,
          };
        }

        grouped[row.user_id].total += Number(row.final_score || 0);
        grouped[row.user_id].weeks += 1;
      }

      const seasonRows = Object.values(grouped).sort(
        (a, b) => b.total - a.total
      );

      const seasonLeader = Number(seasonRows?.[0]?.total || 0);

      setSeason(
        seasonRows.map((row, index) => ({
          ...row,
          rank: index + 1,
          average: row.weeks > 0 ? row.total / row.weeks : 0,
          diff: seasonLeader - row.total,
        }))
      );
    }

    loadData();
  }, []);

  const rows = tab === "week" ? weekly : season;
  const leader = rows[0];
  const second = rows[1];

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
          {tab === "season" && (
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                className="card"
                style={{
                  marginBottom: 0,
                  border: "1px solid rgba(34,197,94,0.25)",
                  background: "rgba(34,197,94,0.08)",
                }}
              >
                <p style={{ margin: 0, color: "#94a3b8" }}>Meneur</p>
                <h2 style={{ margin: "8px 0" }}>{leader?.name}</h2>
                <div
                  style={{
                    fontSize: 44,
                    fontWeight: 900,
                    color: "#22c55e",
                  }}
                >
                  {leader?.total.toFixed(3)}
                </div>
              </div>

              <div
                className="card"
                style={{
                  marginBottom: 0,
                  border: "1px solid rgba(34,197,94,0.25)",
                  background: "rgba(34,197,94,0.08)",
                }}
              >
                <p style={{ margin: 0, color: "#94a3b8" }}>Écart avec 2e</p>
                <div
                  style={{
                    marginTop: 16,
                    fontSize: 44,
                    fontWeight: 900,
                    color: "#22c55e",
                  }}
                >
                  +
                  {(
                    Number(leader?.total || 0) - Number(second?.total || 0)
                  ).toFixed(3)}
                </div>
                <p style={{ margin: 0, color: "#94a3b8" }}>
                  sur {second?.name || "—"}
                </p>
              </div>
            </section>
          )}

          <section className="card">
            {rows.map((row) => (
              <div
                key={row.userId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "54px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "14px 0",
                  borderBottom: "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: "50%",
                    background:
                      row.rank === 1 ? "#16a34a" : "rgba(148,163,184,0.16)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                  }}
                >
                  {medal(row.rank)}
                </div>

                <div>
                  <h2 style={{ margin: 0 }}>{row.name}</h2>

                  <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                    {tab === "season"
                      ? `Moyenne : ${row.average.toFixed(3)}`
                      : row.rank === 1
                      ? "Meneur"
                      : `-${row.diff.toFixed(3)} du meneur`}
                  </p>

                  {tab === "season" && row.rank !== 1 && (
                    <p style={{ margin: "4px 0 0 0", color: "#ef4444" }}>
                      -{row.diff.toFixed(3)} du meneur
                    </p>
                  )}
                </div>

                <div
                  style={{
                    fontSize: 36,
                    fontWeight: 900,
                    color: "#22c55e",
                  }}
                >
                  {(tab === "season" ? row.total : row.score).toFixed(3)}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      <BottomNav />
    </main>
  );
}
