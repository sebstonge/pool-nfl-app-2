"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

/* =========================================================
   HELPERS
   ========================================================= */

function displayName(user, fallbackId) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return fallbackId;
}

function realName(user) {
  return user?.real_name || "";
}

function medal(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

/* =========================================================
   IDENTITÉ JOUEUR
   ========================================================= */

function PlayerIdentity({
  name,
  realName: secondaryName,
  align = "left",
  compact = false,
  podium = false,
}) {
  return (
    <div
      style={{
        textAlign: align,
        minWidth: 0,
        width: "100%",
      }}
    >
      <strong
        style={{
          display: "block",
          fontSize: podium
            ? "clamp(11px, 3vw, 15px)"
            : compact
            ? 14
            : 18,
          lineHeight: 1.15,
          color: "#f8fafc",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {name}
      </strong>

      {secondaryName && (
        <span
          style={{
            display: "block",
            marginTop: 2,
            color: "#94a3b8",
            fontSize: podium
              ? "clamp(9px, 2.5vw, 12px)"
              : compact
              ? 11
              : 13,
            fontWeight: 400,
            lineHeight: 1.2,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {secondaryName}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   PODIUM MOBILE
   ========================================================= */

function PodiumCard({ row, first = false }) {
  if (!row) return <div />;

  return (
    <div
      style={{
        padding: first ? "18px 6px" : "14px 5px",
        borderRadius: 18,

        background:
          row.rank === 1
            ? "linear-gradient(180deg, rgba(34,197,94,0.20), rgba(15,23,42,0.70))"
            : "rgba(15,23,42,0.72)",

        border:
          row.rank === 1
            ? "1px solid rgba(34,197,94,0.35)"
            : "1px solid rgba(148,163,184,0.16)",

        textAlign: "center",

        minHeight: first ? 190 : 165,

        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",

        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: first
            ? "clamp(30px, 9vw, 42px)"
            : "clamp(25px, 7vw, 34px)",
          lineHeight: 1,
        }}
      >
        {medal(row.rank)}
      </div>

      <div
        style={{
          marginTop: first ? 18 : 14,
          marginBottom: 9,
          width: "100%",
          minWidth: 0,
        }}
      >
        <PlayerIdentity
          name={row.name}
          realName={row.realName}
          align="center"
          compact={!first}
          podium
        />
      </div>

      <div
        style={{
          fontSize: first
            ? "clamp(22px, 6vw, 34px)"
            : "clamp(19px, 5vw, 28px)",
          fontWeight: 900,
          color: "#22c55e",
          whiteSpace: "nowrap",
          letterSpacing: "-0.5px",
        }}
      >
        {(row.total ?? row.score).toFixed(3)}
      </div>
    </div>
  );
}

/* =========================================================
   LIGNE MOBILE
   ========================================================= */

function RankingRow({
  row,
  mode,
  isLast = false,
}) {
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
        gridTemplateColumns: "38px minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "11px 0",

        borderBottom: isLast
          ? "none"
          : "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <div
        style={{
          width: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
          fontSize: row.rank <= 3 ? 22 : 17,
        }}
      >
        {row.rank <= 3 ? medal(row.rank) : row.rank}
      </div>

      <div style={{ minWidth: 0 }}>
        <PlayerIdentity
          name={row.name}
          realName={row.realName}
          compact
        />

        {mode === "season" && (
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              fontWeight: 800,

              color:
                row.movement > 0
                  ? "#22c55e"
                  : row.movement < 0
                  ? "#ef4444"
                  : "#64748b",
            }}
          >
            {movement}
          </div>
        )}

        {mode === "season" &&
          row.badges?.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                marginTop: 6,
              }}
            >
              {row.badges.map((badge) => (
                <span
                  key={badge}
                  style={{
                    padding: "4px 7px",
                    borderRadius: 999,
                    background: "rgba(148,163,184,0.14)",
                    color: "#e2e8f0",
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
      </div>

      <div
        style={{
          textAlign: "right",
          minWidth: 100,
          paddingLeft: 6,
        }}
      >
        <div
          style={{
            color: "#f8fafc",
            fontWeight: 900,
            fontSize: 16,
            whiteSpace: "nowrap",
          }}
        >
          {(mode === "season"
            ? row.total
            : row.score
          ).toFixed(3)}{" "}
          pts
        </div>

        {row.rank !== 1 && (
          <div
            style={{
              marginTop: 3,
              color: "#ef4444",
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            -{row.diff.toFixed(3)} du meneur
          </div>
        )}

        {mode === "season" && (
          <div
            style={{
              marginTop: 3,
              color: "#94a3b8",
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            Moy. {row.average.toFixed(3)} / sem.
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   PODIUM DESKTOP COMPACT
   ========================================================= */

function DesktopPodiumCard({
  row,
  first = false,
}) {
  if (!row) {
    return <div />;
  }

  return (
    <div
      style={{
        minWidth: 0,

        minHeight: first ? 158 : 144,

        padding: first
          ? "18px 10px"
          : "15px 8px",

        borderRadius: 16,

        background:
          row.rank === 1
            ? "linear-gradient(180deg, rgba(34,197,94,0.18), rgba(15,23,42,0.65))"
            : "rgba(15,23,42,0.66)",

        border:
          row.rank === 1
            ? "1px solid rgba(34,197,94,0.32)"
            : "1px solid rgba(148,163,184,0.14)",

        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",

        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: first ? 36 : 30,
          lineHeight: 1,
        }}
      >
        {medal(row.rank)}
      </div>

      <div
        style={{
          width: "100%",
          minWidth: 0,
          marginTop: 10,
        }}
      >
        <strong
          style={{
            display: "block",
            color: "#f8fafc",
            fontSize: first ? 15 : 14,
            lineHeight: 1.15,
            overflowWrap: "anywhere",
          }}
        >
          {row.name}
        </strong>

        {row.realName && (
          <span
            style={{
              display: "block",
              marginTop: 3,
              color: "#94a3b8",
              fontSize: 10,
              lineHeight: 1.2,
              overflowWrap: "anywhere",
            }}
          >
            {row.realName}
          </span>
        )}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: 10,
          color: "#22c55e",
          fontSize: first ? 24 : 21,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {(row.total ?? row.score).toFixed(3)}
      </strong>
    </div>
  );
}

/* =========================================================
   LIGNE DESKTOP
   ========================================================= */

function DesktopRankingRow({
  row,
  mode,
  isLast = false,
}) {
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
        gridTemplateColumns: "30px minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",

        padding: "10px 2px",

        borderBottom: isLast
          ? "none"
          : "1px solid rgba(148,163,184,0.11)",
      }}
    >
      <strong
        style={{
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 14,
        }}
      >
        {row.rank}
      </strong>

      <div
        style={{
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          <strong
            style={{
              color: "#f8fafc",
              fontSize: 14,
              lineHeight: 1.15,
            }}
          >
            {row.name}
          </strong>

          {mode === "season" && (
            <span
              style={{
                color:
                  row.movement > 0
                    ? "#22c55e"
                    : row.movement < 0
                    ? "#ef4444"
                    : "#64748b",

                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {movement}
            </span>
          )}
        </div>

        {row.realName && (
          <div
            style={{
              marginTop: 2,
              color: "#94a3b8",
              fontSize: 10,
            }}
          >
            {row.realName}
          </div>
        )}

        {mode === "season" &&
          row.badges?.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 5,
              }}
            >
              {row.badges.map((badge) => (
                <span
                  key={badge}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 999,
                    background: "rgba(148,163,184,0.14)",
                    color: "#e2e8f0",
                    fontSize: 9,
                    fontWeight: 800,
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
      </div>

      <div
        style={{
          textAlign: "right",
          minWidth: 100,
        }}
      >
        <strong
          style={{
            display: "block",
            color: "#f8fafc",
            fontSize: 14,
            whiteSpace: "nowrap",
          }}
        >
          {(mode === "season"
            ? row.total
            : row.score
          ).toFixed(3)}{" "}
          pts
        </strong>

        {row.rank !== 1 && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              color: "#ef4444",
              fontSize: 9,
              whiteSpace: "nowrap",
            }}
          >
            -{row.diff.toFixed(3)}
          </span>
        )}

        {mode === "season" && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              color: "#64748b",
              fontSize: 9,
              whiteSpace: "nowrap",
            }}
          >
            Moy. {row.average.toFixed(3)}
          </span>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   PANNEAU DESKTOP COMPLET
   ========================================================= */

function DesktopRankingPanel({
  title,
  subtitle,
  rows,
  mode,
}) {
  const topThree = rows.slice(0, 3);
  const remaining = rows.slice(3);

  return (
    <section
      className="card"
      style={{
        padding: "20px",
        minWidth: 0,
        height: "100%",
      }}
    >
      {/* TITRE */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 21,
            }}
          >
            {title}
          </h2>

          <p
            style={{
              margin: "5px 0 0",
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            {subtitle}
          </p>
        </div>

        <span
          style={{
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          {mode === "week" ? "📅" : "🏆"}
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            color: "#94a3b8",
          }}
        >
          Aucun score pour le moment.
        </p>
      ) : (
        <>
          {/* PODIUM */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1fr) minmax(0, 1.08fr) minmax(0, 1fr)",
              gap: 8,
              alignItems: "end",
              marginBottom: 12,
            }}
          >
            <DesktopPodiumCard
              row={topThree[1]}
            />

            <DesktopPodiumCard
              row={topThree[0]}
              first
            />

            <DesktopPodiumCard
              row={topThree[2]}
            />
          </div>

          {/* POSITIONS 4+ */}

          {remaining.length > 0 && (
            <div
              style={{
                padding: "0 4px",
              }}
            >
              {remaining.map(
                (row, index) => (
                  <DesktopRankingRow
                    key={row.userId}
                    row={row}
                    mode={mode}
                    isLast={
                      index ===
                      remaining.length - 1
                    }
                  />
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* =========================================================
   PROGRESSION
   ========================================================= */

function buildRankProgression(
  weeklyScores,
  users
) {
  const weeks = Array.from(
    new Set(
      (weeklyScores || []).map((score) =>
        Number(score.week)
      )
    )
  ).sort((a, b) => a - b);

  const totalsByUser = {};
  const progression = {};

  weeks.forEach((week) => {
    (weeklyScores || [])
      .filter(
        (score) =>
          Number(score.week) === week
      )
      .forEach((score) => {
        if (!totalsByUser[score.user_id]) {
          totalsByUser[score.user_id] = 0;
        }

        totalsByUser[score.user_id] += Number(
          score.final_score || 0
        );
      });

    const ranked = Object.entries(
      totalsByUser
    )
      .map(([userId, total]) => {
        const user = users.find(
          (u) => u.id === userId
        );

        return {
          userId,
          name: displayName(
            user,
            userId
          ),
          realName: realName(user),
          total,
        };
      })
      .sort(
        (a, b) =>
          b.total - a.total
      );

    ranked.forEach((row, index) => {
      if (!progression[row.userId]) {
        progression[row.userId] = {
          userId: row.userId,
          name: row.name,
          realName: row.realName,
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

/* =========================================================
   GRAPHIQUE DE PROGRESSION
   ========================================================= */

function RankProgressionChart({
  progression,
  isDesktop,
}) {
  if (
    !progression?.weeks?.length ||
    !progression?.rows?.length
  ) {
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          Progression au classement 📈
        </h2>

        <p style={{ color: "#94a3b8" }}>
          Aucun classement historique pour le moment.
        </p>
      </section>
    );
  }

  const weeks = progression.weeks;

  /*
   * IMPORTANT :
   * On affiche maintenant TOUS les joueurs.
   * Plus aucun .slice(0, 8).
   */
  const rows = progression.rows;

  const maxRank = Math.max(
    rows.length,
    ...rows.flatMap((row) =>
      row.points.map((p) => p.rank)
    )
  );

  const width = isDesktop ? 1180 : 760;
  const height = isDesktop ? 520 : 400;

  const paddingLeft = isDesktop ? 58 : 48;
  const paddingRight = isDesktop ? 28 : 18;
  const paddingTop = 30;
  const paddingBottom = 52;

  const chartWidth =
    width -
    paddingLeft -
    paddingRight;

  const chartHeight =
    height -
    paddingTop -
    paddingBottom;

  /*
   * 13 couleurs distinctes pour les 13 joueurs.
   */
  const colors = [
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#f97316",
    "#ef4444",
    "#facc15",
    "#14b8a6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
    "#8b5cf6",
    "#fb7185",
    "#f59e0b",
  ];

  const xForWeek = (week) => {
    const index = weeks.indexOf(week);

    if (weeks.length === 1) {
      return (
        paddingLeft +
        chartWidth / 2
      );
    }

    return (
      paddingLeft +
      (index /
        (weeks.length - 1)) *
        chartWidth
    );
  };

  const yForRank = (rank) => {
    if (maxRank === 1) {
      return (
        paddingTop +
        chartHeight / 2
      );
    }

    return (
      paddingTop +
      ((rank - 1) /
        (maxRank - 1)) *
        chartHeight
    );
  };

  const shouldShowWeekLabel = (index) => {
    if (
      weeks.length <=
      (isDesktop ? 18 : 10)
    ) {
      return true;
    }

    if (index === 0) return true;
    if (index === weeks.length - 1) return true;

    return index % 2 === 0;
  };

  return (
    <section
      className="card"
      style={
        isDesktop
          ? {
              padding: "22px 26px",
            }
          : undefined
      }
    >
      <h2 style={{ marginTop: 0 }}>
        Progression au classement 📈
      </h2>

      <p
        style={{
          marginTop: -6,
          color: "#94a3b8",
        }}
      >
        Rang cumulatif par semaine · {rows.length} joueurs
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
          }}
        >
          {/* LIGNES HORIZONTALES */}

          {[...Array(maxRank)].map(
            (_, index) => {
              const rank = index + 1;
              const y = yForRank(rank);

              return (
                <g key={rank}>
                  <text
                    x={8}
                    y={y + 5}
                    fill="#cbd5e1"
                    fontSize={
                      isDesktop ? "14" : "13"
                    }
                    fontWeight="800"
                  >
                    #{rank}
                  </text>

                  <line
                    x1={paddingLeft}
                    x2={
                      width -
                      paddingRight
                    }
                    y1={y}
                    y2={y}
                    stroke="rgba(148,163,184,0.12)"
                    strokeWidth="1"
                  />
                </g>
              );
            }
          )}

          {/* SEMAINES */}

          {weeks.map((week, index) => {
            if (!shouldShowWeekLabel(index)) {
              return null;
            }

            return (
              <text
                key={week}
                x={xForWeek(week)}
                y={height - 16}
                textAnchor="middle"
                fill="#cbd5e1"
                fontSize={
                  isDesktop ? "14" : "13"
                }
                fontWeight="800"
              >
                S{week}
              </text>
            );
          })}

          {/* JOUEURS */}

          {rows.map((row, rowIndex) => {
            const color =
              colors[
                rowIndex % colors.length
              ];

            const points = row.points
              .map(
                (point) =>
                  `${xForWeek(
                    point.week
                  )},${yForRank(
                    point.rank
                  )}`
              )
              .join(" ");

            return (
              <g key={row.userId}>
                {row.points.length > 1 && (
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth={
                      isDesktop ? "3.5" : "3"
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {row.points.map((point) => (
                  <circle
                    key={`${row.userId}-${point.week}`}
                    cx={xForWeek(
                      point.week
                    )}
                    cy={yForRank(
                      point.rank
                    )}
                    r={isDesktop ? "5.5" : "5"}
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

      {/* LÉGENDE */}

      <div
        style={{
          display: "grid",

          gridTemplateColumns: isDesktop
            ? "repeat(4, minmax(0, 1fr))"
            : "repeat(2, minmax(0, 1fr))",

          gap: isDesktop
            ? "11px 18px"
            : "10px 14px",

          marginTop: 14,
        }}
      >
        {rows.map((row, index) => (
          <div
            key={row.userId}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background:
                  colors[
                    index % colors.length
                  ],
                display: "inline-block",
                marginTop: 4,
                flexShrink: 0,
              }}
            />

            <PlayerIdentity
              name={row.name}
              realName={row.realName}
              compact
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function ClassementsPage() {
  const [tab, setTab] =
    useState("week");

  const [week, setWeek] =
    useState(1);

  const [weekly, setWeekly] =
    useState([]);

  const [season, setSeason] =
    useState([]);

  const [
    rankProgression,
    setRankProgression,
  ] = useState(null);

  const [
    isDesktop,
    setIsDesktop,
  ] = useState(false);

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
    const updateResponsive = () => {
      setIsDesktop(
        window.innerWidth >= 900
      );
    };

    updateResponsive();

    window.addEventListener(
      "resize",
      updateResponsive
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateResponsive
      );
    };
  }, []);

  /* =========================================================
     DONNÉES
     ========================================================= */

  useEffect(() => {
    async function loadData() {
      const { data: settings } =
        await supabase
          .from("settings")
          .select("*")
          .single();

      const currentWeek =
        Number(
          settings?.current_week
        ) || 1;

      setWeek(currentWeek);

      const { data: users } =
        await supabase
          .from("users")
          .select(
            "id, email, display_name, real_name"
          );

      const { data: allScores } =
        await supabase
          .from("weekly_scores")
          .select("*")
          .order("week", {
            ascending: true,
          });

      const safeUsers =
        users || [];

      const safeScores =
        allScores || [];

      const getUser = (userId) =>
        safeUsers.find(
          (u) => u.id === userId
        );

      /* =====================================================
         CLASSEMENTS HEBDOMADAIRES
         ===================================================== */

      const weeklyRankings = {};

      safeScores.forEach((score) => {
        const scoreWeek =
          Number(score.week);

        if (!weeklyRankings[scoreWeek]) {
          weeklyRankings[scoreWeek] = [];
        }

        weeklyRankings[scoreWeek].push(score);
      });

      Object.keys(
        weeklyRankings
      ).forEach((weekKey) => {
        weeklyRankings[weekKey] =
          weeklyRankings[weekKey]
            .sort(
              (a, b) =>
                Number(
                  b.final_score || 0
                ) -
                Number(
                  a.final_score || 0
                )
            )
            .map((score, index) => ({
              userId: score.user_id,
              rank: index + 1,
            }));
      });

      /* =====================================================
         SEMAINE ACTIVE
         ===================================================== */

      const weekScores =
        safeScores
          .filter(
            (score) =>
              Number(score.week) ===
              currentWeek
          )
          .sort(
            (a, b) =>
              Number(
                b.final_score || 0
              ) -
              Number(
                a.final_score || 0
              )
          );

      const weekLeader =
        Number(
          weekScores?.[0]
            ?.final_score || 0
        );

      setWeekly(
        weekScores.map(
          (score, index) => {
            const user =
              getUser(
                score.user_id
              );

            const scoreValue =
              Number(
                score.final_score || 0
              );

            return {
              rank: index + 1,
              userId: score.user_id,

              name: displayName(
                user,
                score.user_id
              ),

              realName:
                realName(user),

              score:
                scoreValue,

              diff:
                weekLeader -
                scoreValue,
            };
          }
        )
      );

      /* =====================================================
         SAISON
         ===================================================== */

      function buildSeasonRows(scores) {
        const grouped = {};

        for (const score of scores || []) {
          if (!grouped[score.user_id]) {
            const user =
              getUser(
                score.user_id
              );

            grouped[score.user_id] = {
              userId:
                score.user_id,

              name: displayName(
                user,
                score.user_id
              ),

              realName:
                realName(user),

              total: 0,
              weeks: 0,
            };
          }

          grouped[
            score.user_id
          ].total += Number(
            score.final_score || 0
          );

          grouped[
            score.user_id
          ].weeks += 1;
        }

        return Object.values(
          grouped
        ).sort(
          (a, b) =>
            b.total - a.total
        );
      }

      const seasonRows =
        buildSeasonRows(
          safeScores
        );

      const previousSeasonRows =
        buildSeasonRows(
          safeScores.filter(
            (score) =>
              Number(score.week) <
              currentWeek
          )
        );

      const previousRanks = {};

      previousSeasonRows.forEach(
        (row, index) => {
          previousRanks[
            row.userId
          ] = index + 1;
        }
      );

      const seasonLeader =
        Number(
          seasonRows?.[0]
            ?.total || 0
        );

      const progression =
        buildRankProgression(
          safeScores,
          safeUsers
        );

      setSeason(
        seasonRows.map(
          (row, index) => {
            const currentRank =
              index + 1;

            const hasPreviousWeek =
              currentWeek > 1 &&
              previousRanks[
                row.userId
              ] != null;

            const previousRank =
              hasPreviousWeek
                ? previousRanks[
                    row.userId
                  ]
                : currentRank;

            const movement =
              previousRank -
              currentRank;

            const badges = [];

            const recentWeeks =
              Object.keys(
                weeklyRankings
              )
                .map(Number)
                .filter(
                  (weekNumber) =>
                    weekNumber <=
                    currentWeek
                )
                .sort(
                  (a, b) => b - a
                )
                .slice(0, 3);

            const recentRanks =
              recentWeeks.map(
                (weekNumber) => {
                  const found =
                    weeklyRankings[
                      weekNumber
                    ]?.find(
                      (r) =>
                        r.userId ===
                        row.userId
                    );

                  return (
                    found?.rank ||
                    999
                  );
                }
              );

            if (
              recentRanks.length === 3
            ) {
              if (
                recentRanks.every(
                  (rank) =>
                    rank <= 3
                )
              ) {
                badges.push(
                  "🔥 En feu"
                );
              }

              if (
                recentRanks.every(
                  (rank) =>
                    rank > 3
                )
              ) {
                badges.push(
                  "🧊 Glacé"
                );
              }
            }

            if (
              movement <= -3
            ) {
              badges.push(
                "📉 Chute libre"
              );
            }

            return {
              ...row,

              rank:
                currentRank,

              average:
                row.weeks > 0
                  ? row.total /
                    row.weeks
                  : 0,

              diff:
                seasonLeader -
                row.total,

              movement,

              badges,
            };
          }
        )
      );

      setRankProgression(
        progression
      );
    }

    loadData();
  }, []);

  const mobileRows =
    tab === "week"
      ? weekly
      : season;

  const mobileTopThree =
    mobileRows.slice(0, 3);

  /* =========================================================
     AFFICHAGE
     ========================================================= */

  return (
    <main
      className="page"
      style={
        isDesktop
          ? {
              maxWidth: 1280,
              width:
                "calc(100% - 48px)",
              margin: "0 auto",
              paddingTop: 112,
            }
          : undefined
      }
    >
      {/* =====================================================
          HEADER
          ===================================================== */}

      <section
        className="header-card"
        style={
          isDesktop
            ? {
                padding:
                  "24px 30px",
                marginBottom: 18,
              }
            : undefined
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
          }}
        >
          <h1
            style={{
              margin: 0,
            }}
          >
            Classements
          </h1>

          <span
            style={{
              fontSize: 36,
              lineHeight: 1,
            }}
          >
            🏆
          </span>
        </div>

        <p
          style={{
            marginBottom: 0,
          }}
        >
          Semaine {week} et saison complète
        </p>
      </section>

      {/* =====================================================
          DESKTOP
          ===================================================== */}

      {isDesktop ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",
              gap: 18,
              alignItems: "start",
            }}
          >
            <DesktopRankingPanel
              title={`Semaine ${week}`}
              subtitle="Classement hebdomadaire"
              rows={weekly}
              mode="week"
            />

            <DesktopRankingPanel
              title="Saison complète"
              subtitle="Classement cumulatif"
              rows={season}
              mode="season"
            />
          </div>

          {rankProgression && (
            <RankProgressionChart
              progression={
                rankProgression
              }
              isDesktop
            />
          )}
        </>
      ) : (
        <>
          {/* =================================================
              MOBILE — ONGLETS
              ================================================= */}

          <section
            className="card"
            style={{
              padding: 8,
              display: "grid",
              gridTemplateColumns:
                "1fr 1fr",
              gap: 8,
            }}
          >
            <button
              className={
                tab === "week"
                  ? "button"
                  : "button-secondary"
              }
              onClick={() =>
                setTab("week")
              }
            >
              Semaine {week}
            </button>

            <button
              className={
                tab === "season"
                  ? "button"
                  : "button-secondary"
              }
              onClick={() =>
                setTab("season")
              }
            >
              Saison complète
            </button>
          </section>

          {/* =================================================
              MOBILE — CLASSEMENT
              ================================================= */}

          {mobileRows.length === 0 ? (
            <section className="card">
              <p>
                Aucun score pour le moment.
              </p>
            </section>
          ) : (
            <>
              <section className="card">
                <h2
                  style={{
                    marginTop: 0,
                  }}
                >
                  Podium{" "}
                  {tab === "week"
                    ? `semaine ${week}`
                    : "saison"}
                </h2>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(0, 1fr) minmax(0, 1.12fr) minmax(0, 1fr)",
                    gap: "clamp(4px, 1.5vw, 10px)",
                    alignItems: "end",
                    width: "100%",
                    overflow: "hidden",
                  }}
                >
                  <PodiumCard
                    row={
                      mobileTopThree[1]
                    }
                  />

                  <PodiumCard
                    row={
                      mobileTopThree[0]
                    }
                    first
                  />

                  <PodiumCard
                    row={
                      mobileTopThree[2]
                    }
                  />
                </div>
              </section>

              {mobileRows.length >
                3 && (
                <section className="card">
                  {mobileRows
                    .slice(3)
                    .map(
                      (
                        row,
                        index
                      ) => (
                        <RankingRow
                          key={
                            row.userId
                          }
                          row={row}
                          mode={
                            tab ===
                            "week"
                              ? "week"
                              : "season"
                          }
                          isLast={
                            index ===
                            mobileRows.length -
                              4
                          }
                        />
                      )
                    )}
                </section>
              )}
            </>
          )}

          {/* Graphique mobile seulement dans Saison,
              comme avant */}

          {tab === "season" &&
            rankProgression && (
              <RankProgressionChart
                progression={
                  rankProgression
                }
                isDesktop={
                  false
                }
              />
            )}
        </>
      )}

      <BottomNav />
    </main>
  );
}
