"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function shortName(email) {
  if (!email) return "Joueur";
  return email.split("@")[0];
}

function getRankEmoji(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

export default function ClassementsPage() {
  const [weekly, setWeekly] = useState([]);
  const [season, setSeason] = useState([]);
  const [week, setWeek] = useState(1);

  useEffect(() => {
    async function loadData() {
      const { data: settings } = await supabase
        .from("settings")
        .select("*")
        .single();

      setWeek(settings?.current_week || 1);

      const { data: users } = await supabase
        .from("users")
        .select("*");

      const { data: weeklyScores } = await supabase
        .from("weekly_scores")
        .select("*")
        .eq("week", settings?.current_week || 1)
        .order("final_score", { ascending: false });

      const weeklyFormatted = (weeklyScores || []).map((row, index) => {
        const user = users?.find((u) => u.id === row.user_id);

        const leaderScore =
          weeklyScores?.[0]?.final_score || 0;

        return {
          rank: index + 1,
          name: shortName(user?.email || row.user_id),
          score: Number(row.final_score || 0),
          diff: Number(leaderScore - row.final_score || 0),
        };
      });

      setWeekly(weeklyFormatted);

      const grouped = {};

      for (const row of weeklyScores || []) {
        if (!grouped[row.user_id]) {
          grouped[row.user_id] = {
            total: 0,
            weeks: 0,
          };
        }

        grouped[row.user_id].total += Number(row.final_score || 0);
        grouped[row.user_id].weeks += 1;
      }

      const seasonRows = Object.entries(grouped).map(
        ([userId, stats]) => {
          const user = users?.find((u) => u.id === userId);

          return {
            userId,
            name: shortName(user?.email || userId),
            total: stats.total,
            avg: stats.total / stats.weeks,
          };
        }
      );

      seasonRows.sort((a, b) => b.total - a.total);

      const leaderSeason = seasonRows?.[0]?.total || 0;

      setSeason(
        seasonRows.map((row, index) => ({
          ...row,
          rank: index + 1,
          diff: Number(leaderSeason - row.total),
        }))
      );
    }

    loadData();
  }, []);

  return (
    <main className="page">
      <section className="header-card">
        <h1>Classements 🏆</h1>
        <p>Semaine {week} et saison complète</p>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        <section className="card">
          <h2 style={{ marginBottom: 18 }}>
            Classement semaine {week}
          </h2>

          {weekly.length === 0 ? (
            <p>Aucun score pour le moment.</p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                }}
              >
                {weekly.map((row) => (
                  <div
                    key={row.rank}
                    style={{
                      paddingBottom: 14,
                      borderBottom:
                        "1px solid rgba(148,163,184,0.12)",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "42px 1fr auto",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: "50%",
                          background:
                            row.rank === 1
                              ? "#16a34a"
                              : "rgba(148,163,184,0.16)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                        }}
                      >
                        {row.rank}
                      </div>

                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ fontSize: 18 }}>
                            {getRankEmoji(row.rank)}
                          </span>

                          <strong style={{ fontSize: 22 }}>
                            {row.name}
                          </strong>
                        </div>

                        <p
                          style={{
                            margin: "4px 0 0 0",
                            color: "#94a3b8",
                          }}
                        >
                          {row.rank === 1
                            ? "Meneur"
                            : `-${row.diff.toFixed(3)} du meneur`}
                        </p>
                      </div>

                      <div
                        style={{
                          fontSize: 42,
                          fontWeight: 900,
                          color: "#22c55e",
                        }}
                      >
                        {row.score.toFixed(3)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 18 }}>
            Classement saison
          </h2>

          {season.length === 0 ? (
            <p>Aucun score pour le moment.</p>
          ) : (
            <>
              <div
                style={{
                  marginBottom: 18,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: 18,
                    borderRadius: 20,
                    background:
                      "rgba(34,197,94,0.08)",
                    border:
                      "1px solid rgba(34,197,94,0.18)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "#94a3b8",
                    }}
                  >
                    Meneur
                  </p>

                  <h2
                    style={{
                      margin: "8px 0",
                    }}
                  >
                    {season[0]?.name}
                  </h2>

                  <div
                    style={{
                      fontSize: 48,
                      fontWeight: 900,
                      color: "#22c55e",
                    }}
                  >
                    {season[0]?.total.toFixed(3)}
                  </div>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 20,
                    background:
                      "rgba(34,197,94,0.08)",
                    border:
                      "1px solid rgba(34,197,94,0.18)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "#94a3b8",
                    }}
                  >
                    Écart avec 2e
                  </p>

                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 52,
                      fontWeight: 900,
                      color: "#22c55e",
                    }}
                  >
                    +
                    {(
                      (season[0]?.total || 0) -
                      (season[1]?.total || 0)
                    ).toFixed(3)}
                  </div>

                  <p
                    style={{
                      margin: 0,
                      color: "#94a3b8",
                    }}
                  >
                    sur {season[1]?.name || "—"}
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                }}
              >
                {season.map((row) => (
                  <div
                    key={row.userId}
                    style={{
                      paddingBottom: 14,
                      borderBottom:
                        "1px solid rgba(148,163,184,0.12)",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "42px 1fr auto",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: "50%",
                          background:
                            row.rank === 1
                              ? "#16a34a"
                              : "rgba(148,163,184,0.16)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                        }}
                      >
                        {row.rank}
                      </div>

                      <div>
                        <strong
                          style={{
                            fontSize: 22,
                          }}
                        >
                          {row.name}
                        </strong>

                        <p
                          style={{
                            margin: "4px 0 0 0",
                            color: "#94a3b8",
                          }}
                        >
                          Moyenne :{" "}
                          {row.avg.toFixed(3)}
                        </p>
                      </div>

                      <div
                        style={{
                          textAlign: "right",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 38,
                            fontWeight: 900,
                            color: "#22c55e",
                          }}
                        >
                          {row.total.toFixed(3)}
                        </div>

                        {row.rank !== 1 && (
                          <div
                            style={{
                              color: "#ef4444",
                              fontWeight: 700,
                            }}
                          >
                            -{row.diff.toFixed(3)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <BottomNav />
    </main>
  );
}
