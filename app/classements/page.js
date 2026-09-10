"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

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
        gridTemplateColumns: "46px minmax(0, 1fr)",
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

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <PlayerIdentity
            name={row.name}
            realName={row.realName}
          />

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
                marginTop: 1,
                whiteSpace: "nowrap",
              }}
            >
              {movement}
            </span>
          )}
        </div>

        <p
          style={{
            margin: "6px 0 0 0",
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

function PodiumCard({ row, first = false }) {
  if (!row) return <div />;

  return (
    <div
      style={{
        padding: first
          ? "18px 6px"
          : "14px 5px",
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
          podium={true}
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

function buildRankProgression(weeklyScores, users) {
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
        (score) => Number(score.week) === week
      )
      .forEach((score) => {
        if (!totalsByUser[score.user_id]) {
          totalsByUser[score.user_id] = 0;
        }

        totalsByUser[score.user_id] += Number(
          score.final_score || 0
        );
      });

    const ranked = Object.entries(totalsByUser)
      .map(([userId, total]) => {
        const user = users.find(
          (u) => u.id === userId
        );

        return {
          userId,
          name: displayName(user, userId),
          realName: realName(user),
          total,
        };
      })
      .sort((a, b) => b.total - a.total);

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

function RankProgressionChart({ progression }) {
  if (
    !progression?.weeks?.length ||
    !progression?.rows?.length
  ) {
    return (
      <section className="card">
        <h2
          style={{
            marginTop: 0,
            lineHeight: 1.15,
          }}
        >
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
   * On garde les 8 premiers joueurs affichés,
   * comme dans ta version actuelle.
   */
  const rows = progression.rows.slice(0, 8);

  const maxRank = Math.max(
    ...rows.flatMap((row) =>
      row.points.map((p) => p.rank)
    )
  );

  /*
   * Le SVG utilise un viewBox fixe,
   * mais il se redimensionne entièrement
   * selon la largeur disponible.
   *
   * IMPORTANT :
   * aucun minWidth
   * aucun overflow horizontal
   */
  const width = 760;
  const height = 340;

  const paddingLeft = 48;
  const paddingRight = 18;
  const paddingTop = 24;
  const paddingBottom = 48;

  const chartWidth =
    width - paddingLeft - paddingRight;

  const chartHeight =
    height - paddingTop - paddingBottom;

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

    /*
     * Avec une seule semaine,
     * on place S1 près du centre.
     */
    if (weeks.length === 1) {
      return paddingLeft + chartWidth / 2;
    }

    return (
      paddingLeft +
      (index / (weeks.length - 1)) * chartWidth
    );
  };

  const yForRank = (rank) => {
    if (maxRank === 1) {
      return paddingTop + chartHeight / 2;
    }

    return (
      paddingTop +
      ((rank - 1) / (maxRank - 1)) *
        chartHeight
    );
  };

  /*
   * Quand il y aura beaucoup de semaines,
   * on peut réduire le nombre de libellés
   * affichés pour éviter qu'ils se chevauchent.
   *
   * Les points/lignes demeurent présents
   * pour TOUTES les semaines.
   */
  const shouldShowWeekLabel = (index) => {
    if (weeks.length <= 10) return true;

    if (index === 0) return true;
    if (index === weeks.length - 1) return true;

    return index % 2 === 0;
  };

  return (
    <section className="card">
      <h2
        style={{
          marginTop: 0,
          lineHeight: 1.15,
        }}
      >
        Progression au classement 📈
      </h2>

      <p
        style={{
          marginTop: -6,
          color: "#94a3b8",
        }}
      >
        Rang cumulatif par semaine
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
            maxWidth: "100%",
          }}
        >
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
            }
          )}

          {weeks.map((week, index) => {
            if (!shouldShowWeekLabel(index)) {
              return null;
            }

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
                    strokeWidth="4"
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
          display: "grid",
          gridTemplateColumns:
            "repeat(2, minmax(0, 1fr))",
          gap: "10px 14px",
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
              color: "#cbd5e1",
              fontSize: 13,
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
              compact={true}
            />
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
  const [rankProgression, setRankProgression] =
    useState(null);

  useEffect(() => {
    async function loadData() {
      const { data: settings } = await supabase
        .from("settings")
        .select("*")
        .single();

      const currentWeek =
        Number(settings?.current_week) || 1;

      setWeek(currentWeek);

      const { data: users } = await supabase
        .from("users")
        .select(
          "id, email, display_name, real_name"
        );

      const { data: allScores } = await supabase
        .from("weekly_scores")
        .select("*")
        .order("week", {
          ascending: true,
        });

      const safeUsers = users || [];
      const safeScores = allScores || [];

      const getUser = (userId) =>
        safeUsers.find(
          (u) => u.id === userId
        );

      /* =====================================================
         CLASSEMENTS HEBDOMADAIRES
         ===================================================== */

      const weeklyRankings = {};

      safeScores.forEach((score) => {
        const scoreWeek = Number(score.week);

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
         CLASSEMENT DE LA SEMAINE ACTIVE
         ===================================================== */

      const weekScores = safeScores
        .filter(
          (score) =>
            Number(score.week) ===
            currentWeek
        )
        .sort(
          (a, b) =>
            Number(b.final_score || 0) -
            Number(a.final_score || 0)
        );

      const weekLeader = Number(
        weekScores?.[0]?.final_score || 0
      );

      setWeekly(
        weekScores.map((score, index) => {
          const user = getUser(
            score.user_id
          );

          const scoreValue = Number(
            score.final_score || 0
          );

          return {
            rank: index + 1,
            userId: score.user_id,
            name: displayName(
              user,
              score.user_id
            ),
            realName: realName(user),
            score: scoreValue,
            diff:
              weekLeader - scoreValue,
          };
        })
      );

      /* =====================================================
         CLASSEMENT SAISON
         ===================================================== */

      function buildSeasonRows(scores) {
        const grouped = {};

        for (const score of scores || []) {
          if (!grouped[score.user_id]) {
            const user = getUser(
              score.user_id
            );

            grouped[score.user_id] = {
              userId: score.user_id,
              name: displayName(
                user,
                score.user_id
              ),
              realName: realName(user),
              total: 0,
              weeks: 0,
            };
          }

          grouped[score.user_id].total +=
            Number(
              score.final_score || 0
            );

          grouped[score.user_id].weeks += 1;
        }

        return Object.values(
          grouped
        ).sort(
          (a, b) =>
            b.total - a.total
        );
      }

      /*
       * CLASSEMENT SAISON ACTUEL
       *
       * Toutes les semaines qui existent
       * présentement dans weekly_scores.
       */
      const seasonRows =
        buildSeasonRows(safeScores);

      /*
       * CLASSEMENT DE RÉFÉRENCE POUR LES FLÈCHES
       *
       * TRÈS IMPORTANT :
       * on exclut TOUJOURS la semaine active.
       *
       * Ainsi les flèches représentent :
       *
       * classement fin semaine précédente
       *                  VS
       * classement incluant semaine actuelle
       *
       * Elles ne dépendent PAS du nombre
       * de fois où le bouton Admin est utilisé.
       */
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
          previousRanks[row.userId] =
            index + 1;
        }
      );

      const seasonLeader = Number(
        seasonRows?.[0]?.total || 0
      );

      const progression =
        buildRankProgression(
          safeScores,
          safeUsers
        );

      setSeason(
        seasonRows.map((row, index) => {
          const currentRank =
            index + 1;

          /*
           * Semaine 1 :
           * aucun classement précédent.
           * Donc mouvement = 0.
           */
          const hasPreviousWeek =
            currentWeek > 1 &&
            previousRanks[row.userId] !=
              null;

          const previousRank =
            hasPreviousWeek
              ? previousRanks[row.userId]
              : currentRank;

          const movement =
            previousRank - currentRank;

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
                (a, b) =>
                  b - a
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
                  found?.rank || 999
                );
              }
            );

          if (
            recentRanks.length === 3
          ) {
            if (
              recentRanks.every(
                (rank) => rank <= 3
              )
            ) {
              badges.push(
                "🔥 En feu"
              );
            }

            if (
              recentRanks.every(
                (rank) => rank > 3
              )
            ) {
              badges.push(
                "🧊 Glacé"
              );
            }
          }

          if (movement <= -3) {
            badges.push(
              "📉 Chute libre"
            );
          }

          return {
            ...row,
            rank: currentRank,
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
        })
      );

      setRankProgression(
        progression
      );
    }

    loadData();
  }, []);

  const rows =
    tab === "week"
      ? weekly
      : season;

  const topThree =
    rows.slice(0, 3);

  return (
    <main className="page">
      <section className="header-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "nowrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize:
                "clamp(40px, 10vw, 64px)",
              fontWeight: 900,
              lineHeight: 1,
              color: "#f8fafc",
              letterSpacing: "-1.5px",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            Classements
          </div>

          <span
            style={{
              fontSize:
                "clamp(32px, 8vw, 48px)",
              lineHeight: 1,
              flexShrink: 0,
              transform:
                "translateY(1px)",
            }}
          >
            🏆
          </span>
        </div>

        <p
          style={{
            marginTop: 20,
            marginBottom: 0,
          }}
        >
          Semaine {week} et saison complète
        </p>
      </section>

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

      {rows.length === 0 ? (
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

                /*
                 * Les 3 cartes restent TOUJOURS
                 * dans la largeur disponible.
                 */
                gridTemplateColumns:
                  "minmax(0, 1fr) minmax(0, 1.12fr) minmax(0, 1fr)",

                gap:
                  "clamp(4px, 1.5vw, 10px)",

                alignItems: "end",
                width: "100%",
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              <PodiumCard
                row={topThree[1]}
              />

              <PodiumCard
                row={topThree[0]}
                first={true}
              />

              <PodiumCard
                row={topThree[2]}
              />
            </div>
          </section>

          {rows.length > 3 && (
            <section className="card">
              {rows
                .slice(3)
                .map((row) => (
                  <RankingRow
                    key={row.userId}
                    row={row}
                    mode={
                      tab === "week"
                        ? "week"
                        : "season"
                    }
                  />
                ))}
            </section>
          )}
        </>
      )}

      {tab === "season" &&
        rankProgression && (
          <RankProgressionChart
            progression={
              rankProgression
            }
          />
        )}

      <BottomNav />
    </main>
  );
}
