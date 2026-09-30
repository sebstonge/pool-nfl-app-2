'use client';
// Display-only copy of the regular ranking cards. Scores come exclusively from publication.
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
            Moy. {row.average.toFixed(3)} / ronde
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


export default function ResultRows({rows,empty,isDesktop}) {
 if(!rows.length)return <p style={{color:'#94a3b8'}}>{empty}</p>;
 const display=rows.map(r=>({...r,score:Number(r.score),diff:Number(rows[0].score)-Number(r.score)}));
 const podium=display.slice(0,3),rest=display.slice(3);
 const Card=isDesktop?DesktopPodiumCard:PodiumCard;
 const Row=isDesktop?DesktopRankingRow:RankingRow;
 return <><div style={{display:'grid',gridTemplateColumns:'minmax(0, 1fr) minmax(0, 1.08fr) minmax(0, 1fr)',gap:8,alignItems:'end',marginBottom:12}}>
   <Card row={podium[1]}/><Card row={podium[0]} first/><Card row={podium[2]}/>
 </div>{rest.map((row,i)=><Row key={row.userId} row={row} mode="week" isLast={i===rest.length-1}/>)}</>;
}
