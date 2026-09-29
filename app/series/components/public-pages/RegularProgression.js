'use client';
// SVG layout copied from app/classements/page.js. Points must be official cumulative ranks.
import {ROUNDS} from '../playoff-tree/treeData.mjs';
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

function RankProgressionChart({
  progression,
  isDesktop,
  playerCount = 0,
}) {
  const weeks = progression.weeks;

  const rows = progression.rows;

  const maxRank = Math.max(
    playerCount,
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
        Rang cumulatif par ronde · {playerCount} joueurs
      </p>

      {!rows.length && <p style={{color:"#94a3b8"}}>En attente des classements officiels. Aucune courbe disponible.</p>}
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

          {weeks.map((week, index) => {
            if (!shouldShowWeekLabel(index)) {
              return null;
            }

            return (
              <text
                key={week}
                x={xForWeek(week)}
                y={height - 16}
                textAnchor={index===0?"start":index===weeks.length-1?"end":"middle"}
                fill="#cbd5e1"
                fontSize={
                  isDesktop ? "14" : "13"
                }
                fontWeight="800"
              >
                {ROUNDS.find(r=>r.key===week)?.title || week}
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


export default RankProgressionChart;
