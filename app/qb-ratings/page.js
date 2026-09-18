"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "—";
}

function realName(user) {
  return user?.real_name || "";
}

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;

  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function QBPhoto({ qb, size = 96 }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 22,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
          flexShrink: 0,
        }}
      >
        QB
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={qb.name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
      }}
    />
  );
}

function TeamLogo({ logo, name, size = 54 }) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
          flexShrink: 0,
        }}
      >
        {name?.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={logo}
      alt={name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
      }}
    />
  );
}

function PlayerIdentity({
  name,
  realName: secondaryName,
  compact = false,
}) {
  return (
    <div style={{ marginTop: compact ? 1 : 3 }}>
      <strong
        style={{
          display: "block",
          color: "#f8fafc",
          fontSize: compact ? 12 : 14,
          lineHeight: 1.15,
        }}
      >
        {name || "—"}
      </strong>

      {secondaryName && (
        <span
          style={{
            display: "block",
            marginTop: 2,
            color: "#64748b",
            fontSize: compact ? 10 : 12,
            fontWeight: 400,
            lineHeight: 1.2,
          }}
        >
          {secondaryName}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   CARTE RATING MOBILE / ORIGINALE
   ========================================================= */

function RatingMiniCard({
  label,
  type,
  rating,
  isMobile,
}) {
  const isBest = type === "best";

  if (!rating) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: "rgba(148,163,184,0.08)",
          border: "1px solid rgba(148,163,184,0.14)",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "#94a3b8",
            fontWeight: 900,
          }}
        >
          {label}
        </p>

        <h3 style={{ margin: "8px 0 0 0" }}>
          Aucun rating
        </h3>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 18,
        background: isBest
          ? "rgba(34,197,94,0.08)"
          : "rgba(239,68,68,0.08)",
        border: isBest
          ? "1px solid rgba(34,197,94,0.22)"
          : "1px solid rgba(239,68,68,0.22)",
      }}
    >
      <p
        style={{
          margin: 0,
          color: isBest ? "#22c55e" : "#ef4444",
          fontWeight: 900,
        }}
      >
        {label}
      </p>

      {isMobile ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(100px, 0.75fr) minmax(0, 1.25fr)",
            gap: 16,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <strong
              style={{
                display: "block",
                fontSize: 34,
                lineHeight: 1,
                color: isBest ? "#22c55e" : "#ef4444",
                fontWeight: 900,
                whiteSpace: "nowrap",
              }}
            >
              {Number(rating.passer_rating).toFixed(1)}
            </strong>
          </div>

          <div
            style={{
              minWidth: 0,
              paddingLeft: 14,
              borderLeft:
                "1px solid rgba(148,163,184,0.16)",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Semaine {rating.week}
            </p>

            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#94a3b8",
                }}
              >
                Choisi par
              </span>

              <PlayerIdentity
                name={rating.selected_by}
                realName={rating.selected_by_real_name}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <h2
            style={{
              margin: "6px 0",
              fontSize: 30,
              color: isBest ? "#22c55e" : "#ef4444",
            }}
          >
            {Number(rating.passer_rating).toFixed(1)}
          </h2>

          <div
            style={{
              marginTop: 6,
              color: "#94a3b8",
            }}
          >
            <p style={{ margin: 0 }}>
              Semaine {rating.week}
            </p>

            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#94a3b8",
                }}
              >
                Choisi par
              </span>

              <PlayerIdentity
                name={rating.selected_by}
                realName={rating.selected_by_real_name}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   BLOC RATING DESKTOP — PODIUM
   ========================================================= */

function DesktopPodiumRating({
  label,
  rating,
  type,
}) {
  const isBest = type === "best";
  const isWorst = type === "worst";

  const accent = isBest
    ? "#22c55e"
    : isWorst
    ? "#ef4444"
    : "#e2e8f0";

  const background = isBest
    ? "rgba(34,197,94,0.07)"
    : isWorst
    ? "rgba(239,68,68,0.07)"
    : "rgba(148,163,184,0.07)";

  const border = isBest
    ? "1px solid rgba(34,197,94,0.20)"
    : isWorst
    ? "1px solid rgba(239,68,68,0.20)"
    : "1px solid rgba(148,163,184,0.14)";

  return (
    <div
      style={{
        height: "100%",
        minWidth: 0,
        padding: "14px 16px",
        borderRadius: 16,
        background,
        border,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          color:
            type === "average"
              ? "#94a3b8"
              : accent,
          fontSize: 12,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: ".03em",
        }}
      >
        {label}
      </div>

      {type === "average" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 10,
            minWidth: 0,
          }}
        >
          <strong
            style={{
              color: accent,
              fontSize: 29,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {rating != null
              ? Number(rating).toFixed(1)
              : "--"}
          </strong>

          <span
            style={{
              color: "#94a3b8",
              fontSize: 11,
              lineHeight: 1.2,
            }}
          >
            Toutes les semaines
          </span>
        </div>
      ) : !rating ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 10,
          }}
        >
          <strong
            style={{
              color: "#64748b",
              fontSize: 29,
              lineHeight: 1,
            }}
          >
            --
          </strong>

          <span
            style={{
              color: "#64748b",
              fontSize: 11,
            }}
          >
            Aucun rating
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "auto auto minmax(0, 1fr)",
            gap: 12,
            alignItems: "center",
            marginTop: 10,
            minWidth: 0,
          }}
        >
          <strong
            style={{
              color: accent,
              fontSize: 29,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {Number(rating.passer_rating).toFixed(1)}
          </strong>

          <div
            style={{
              color: "#94a3b8",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Semaine {rating.week}
          </div>

          <div
            style={{
              minWidth: 0,
              paddingLeft: 12,
              borderLeft:
                "1px solid rgba(148,163,184,0.16)",
            }}
          >
            <span
              style={{
                display: "block",
                color: "#64748b",
                fontSize: 9,
                lineHeight: 1.1,
              }}
            >
              Choisi par
            </span>

            <strong
              style={{
                display: "block",
                marginTop: 2,
                color: "#f8fafc",
                fontSize: 11,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {rating.selected_by || "—"}
            </strong>

            {rating.selected_by_real_name && (
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  color: "#64748b",
                  fontSize: 9,
                  lineHeight: 1.15,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {rating.selected_by_real_name}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   TOP 3 — CARTE HORIZONTALE DESKTOP
   ========================================================= */

function DesktopPodiumQB({
  row,
  rank,
  teamLogo,
}) {
  const rankDisplay =
    rank === 1
      ? "🥇"
      : rank === 2
      ? "🥈"
      : "🥉";

  return (
    <section
      className="card"
      style={{
        padding: "18px 20px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "58px 110px minmax(190px, 0.85fr) minmax(0, 2.15fr)",
          gap: 16,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <div
          style={{
            alignSelf: "start",
            paddingTop: 5,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 31,
              lineHeight: 1,
            }}
          >
            {rankDisplay}
          </div>

          <strong
            style={{
              display: "block",
              marginTop: 5,
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            #{rank}
          </strong>
        </div>

        <QBPhoto
          qb={row.qb}
          size={105}
        />

        <div
          style={{
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#f8fafc",
              fontSize: 22,
              lineHeight: 1.1,
            }}
          >
            {row.qb.name}
          </h2>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 9,
              color: "#94a3b8",
            }}
          >
            <TeamLogo
              logo={teamLogo}
              name={row.qb.team}
              size={34}
            />

            <strong
              style={{
                fontSize: 13,
              }}
            >
              {row.qb.team}
            </strong>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(3, minmax(0, 1fr))",
            gap: 10,
            minWidth: 0,
          }}
        >
          <DesktopPodiumRating
            label="Meilleur"
            type="best"
            rating={row.best}
          />

          <DesktopPodiumRating
            label="Moyenne"
            type="average"
            rating={row.average}
          />

          <DesktopPodiumRating
            label="Pire"
            type="worst"
            rating={row.worst}
          />
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   QB #4+ — LIGNE DESKTOP COMPACTE
   ========================================================= */

function CompactRating({
  label,
  rating,
  type,
}) {
  const isBest = type === "best";
  const isWorst = type === "worst";

  const accent = isBest
    ? "#22c55e"
    : isWorst
    ? "#ef4444"
    : "#e2e8f0";

  return (
    <div
      style={{
        minWidth: 0,
        paddingLeft: 14,
        borderLeft:
          "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <div
        style={{
          color:
            type === "average"
              ? "#64748b"
              : accent,
          fontSize: 9,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>

      {type === "average" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginTop: 5,
            minWidth: 0,
          }}
        >
          <strong
            style={{
              color: accent,
              fontSize: 19,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {rating != null
              ? Number(rating).toFixed(1)
              : "--"}
          </strong>

          <span
            style={{
              color: "#64748b",
              fontSize: 9,
              whiteSpace: "nowrap",
            }}
          >
            Saison
          </span>
        </div>
      ) : !rating ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 5,
          }}
        >
          <strong
            style={{
              color: "#64748b",
              fontSize: 19,
              lineHeight: 1.1,
            }}
          >
            --
          </strong>

          <span
            style={{
              color: "#64748b",
              fontSize: 8,
            }}
          >
            Aucun rating
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "auto auto minmax(0, 1fr)",
            gap: 8,
            alignItems: "center",
            marginTop: 5,
            minWidth: 0,
          }}
        >
          <strong
            style={{
              color: accent,
              fontSize: 19,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {Number(rating.passer_rating).toFixed(1)}
          </strong>

          <span
            style={{
              color: "#94a3b8",
              fontSize: 9,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            S{rating.week}
          </span>

          <div
            style={{
              minWidth: 0,
              paddingLeft: 8,
              borderLeft:
                "1px solid rgba(148,163,184,0.14)",
            }}
          >
            <span
              style={{
                display: "block",
                color: "#64748b",
                fontSize: 8,
                lineHeight: 1.05,
              }}
            >
              Choisi par
            </span>

            <strong
              style={{
                display: "block",
                marginTop: 1,
                color: "#cbd5e1",
                fontSize: 10,
                lineHeight: 1.1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {rating.selected_by || "—"}
            </strong>

            {rating.selected_by_real_name && (
              <span
                style={{
                  display: "block",
                  marginTop: 1,
                  color: "#64748b",
                  fontSize: 8,
                  lineHeight: 1.05,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {rating.selected_by_real_name}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopCompactQB({
  row,
  rank,
  teamLogo,
  isLast,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "42px 72px minmax(180px, 0.9fr) minmax(135px, 0.72fr) minmax(110px, 0.58fr) minmax(135px, 0.72fr)",
        gap: 12,
        alignItems: "center",
        padding: "11px 4px",
        borderBottom: isLast
          ? "none"
          : "1px solid rgba(148,163,184,0.11)",
      }}
    >
      <strong
        style={{
          color: "#94a3b8",
          fontSize: 15,
          textAlign: "center",
        }}
      >
        #{rank}
      </strong>

      <QBPhoto
        qb={row.qb}
        size={68}
      />

      <div
        style={{
          minWidth: 0,
        }}
      >
        <strong
          style={{
            display: "block",
            color: "#f8fafc",
            fontSize: 15,
            lineHeight: 1.15,
          }}
        >
          {row.qb.name}
        </strong>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 5,
            color: "#94a3b8",
          }}
        >
          <TeamLogo
            logo={teamLogo}
            name={row.qb.team}
            size={24}
          />

          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {row.qb.team}
          </span>
        </div>
      </div>

      <CompactRating
        label="Meilleur"
        type="best"
        rating={row.best}
      />

      <CompactRating
        label="Moyenne"
        type="average"
        rating={row.average}
      />

      <CompactRating
        label="Pire"
        type="worst"
        rating={row.worst}
      />
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function QBRatingsPage() {
  const [rows, setRows] = useState([]);
  const [teams, setTeams] = useState([]);
  const [message, setMessage] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
    const updateResponsive = () => {
      setIsDesktop(window.innerWidth >= 900);
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
     DONNÉES — LOGIQUE EXISTANTE CONSERVÉE
     ========================================================= */

  useEffect(() => {
    async function loadData() {
      const { data: teamsData } =
        await supabase
          .from("teams")
          .select("*");

      setTeams(teamsData || []);

      const { data: usersData } =
        await supabase
          .from("users")
          .select(
            "id, email, display_name, real_name"
          );

      const {
        data: qbsData,
        error: qbsError,
      } = await supabase
        .from("qbs")
        .select("*")
        .order("team", {
          ascending: true,
        });

      if (qbsError) {
        setMessage(
          "Erreur QB : " +
            qbsError.message
        );

        return;
      }

      const {
        data: ratingsData,
        error: ratingsError,
      } = await supabase
        .from("qb_ratings")
        .select("*");

      if (ratingsError) {
        setMessage(
          "Erreur ratings : " +
            ratingsError.message
        );

        return;
      }

      const {
        data: qbPicksData,
        error: picksError,
      } = await supabase
        .from("qb_picks")
        .select("*");

      if (picksError) {
        setMessage(
          "Erreur picks QB : " +
            picksError.message
        );

        return;
      }

      const ratingsByActualQb = {};

      (ratingsData || []).forEach(
        (rating) => {
          if (
            rating.passer_rating == null
          ) {
            return;
          }

          const selectedQb =
            (qbsData || []).find(
              (qb) =>
                qb.id ===
                rating.qb_id
            );

          const actualAthleteId =
            rating.actual_espn_athlete_id ||
            selectedQb?.espn_athlete_id;

          if (!actualAthleteId) {
            return;
          }

          const key =
            String(actualAthleteId);

          if (!ratingsByActualQb[key]) {
            ratingsByActualQb[key] = [];
          }

          ratingsByActualQb[key].push(
            rating
          );
        }
      );

      const builtRows =
        Object.entries(
          ratingsByActualQb
        )
          .map(
            ([
              athleteId,
              qbRatings,
            ]) => {
              const firstRating =
                qbRatings[0];

              const selectedQb =
                (qbsData || []).find(
                  (qb) =>
                    qb.id ===
                    firstRating.qb_id
                );

              const actualQbFromDatabase =
                (qbsData || []).find(
                  (qb) =>
                    String(
                      qb.espn_athlete_id
                    ) ===
                    String(athleteId)
                );

              const actualQb =
                actualQbFromDatabase ||
                {
                  id:
                    `actual-${athleteId}`,

                  name:
                    firstRating.actual_qb_name ||
                    selectedQb?.name ||
                    "QB",

                  team:
                    selectedQb?.team ||
                    "",

                  espn_athlete_id:
                    athleteId,
                };

              const best =
                [...qbRatings].sort(
                  (a, b) =>
                    Number(
                      b.passer_rating
                    ) -
                    Number(
                      a.passer_rating
                    )
                )[0] || null;

              const worst =
                qbRatings.length > 1
                  ? [...qbRatings].sort(
                      (a, b) =>
                        Number(
                          a.passer_rating
                        ) -
                        Number(
                          b.passer_rating
                        )
                    )[0]
                  : null;

              const attachSelector =
                (rating) => {
                  if (!rating) {
                    return null;
                  }

                  const pick =
                    (qbPicksData || []).find(
                      (p) =>
                        p.qb_id ===
                          rating.qb_id &&
                        p.week ===
                          rating.week
                    );

                  const user =
                    (usersData || []).find(
                      (u) =>
                        u.id ===
                        pick?.user_id
                    );

                  return {
                    ...rating,

                    selected_by:
                      displayName(user),

                    selected_by_real_name:
                      realName(user),
                  };
                };

              const average =
                qbRatings.length > 0
                  ? qbRatings.reduce(
                      (
                        sum,
                        rating
                      ) =>
                        sum +
                        Number(
                          rating.passer_rating ||
                            0
                        ),
                      0
                    ) /
                    qbRatings.length
                  : null;

              return {
                qb: actualQb,

                best:
                  attachSelector(best),

                worst:
                  attachSelector(worst),

                average,
              };
            }
          )
          .sort((a, b) => {
            const aBest =
              Number(
                a.best?.passer_rating ||
                  0
              );

            const bBest =
              Number(
                b.best?.passer_rating ||
                  0
              );

            return bBest - aBest;
          });

      setRows(builtRows);
    }

    loadData();
  }, []);

  const getTeamLogo = (teamName) => {
    const team =
      teams.find(
        (t) =>
          t.name
            ?.toLowerCase()
            .trim() ===
          teamName
            ?.toLowerCase()
            .trim()
      );

    return team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo || null;
  };

  /* =========================================================
     AFFICHAGE
     ========================================================= */

  return (
    <main
      className="page"
      style={{
        maxWidth: isDesktop ? 1280 : 1100,

        width: isDesktop
          ? "calc(100% - 48px)"
          : undefined,

        margin: isDesktop
          ? "0 auto"
          : undefined,

        paddingTop: isDesktop
          ? 112
          : undefined,
      }}
    >
      {/* =====================================================
          HEADER
          ===================================================== */}

      <section
        className="header-card"
        style={
          isDesktop
            ? {
                padding: "26px 30px",
                marginBottom: 18,
              }
            : undefined
        }
      >
        <h1
          style={{
            fontSize: !isDesktop
              ? 44
              : undefined,

            lineHeight: 1.05,
            whiteSpace: "nowrap",
          }}
        >
          QB Ratings 📊
        </h1>

        <p>
          Ratings et moyenne de chaque QB cette saison.
        </p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {rows.length === 0 && (
        <section className="card">
          <p>
            Aucun rating QB pour le moment.
          </p>
        </section>
      )}

      {/* =====================================================
          DESKTOP
          ===================================================== */}

      {isDesktop && rows.length > 0 && (
        <>
          {/* =================================================
              PODIUM — TOP 3
              ================================================= */}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "4px 2px 12px",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 20,
                color: "#f8fafc",
              }}
            >
              Podium
            </h2>

            <span style={{ fontSize: 20 }}>
              🏆
            </span>
          </div>

          {rows
            .slice(0, 3)
            .map((row, index) => (
              <DesktopPodiumQB
                key={row.qb.id}
                row={row}
                rank={index + 1}
                teamLogo={getTeamLogo(
                  row.qb.team
                )}
              />
            ))}

          {/* =================================================
              AUTRES QB
              ================================================= */}

          {rows.length > 3 && (
            <section
              className="card"
              style={{
                padding: "16px 20px 8px",
                marginTop: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "0 4px 12px",
                  borderBottom:
                    "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 19,
                    }}
                  >
                    Classement QB
                  </h2>

                  <p
                    style={{
                      margin: "4px 0 0",
                      color: "#94a3b8",
                      fontSize: 11,
                    }}
                  >
                    Positions #4 à #{rows.length}
                  </p>
                </div>

                <span
                  style={{
                    color: "#64748b",
                    fontSize: 11,
                  }}
                >
                  Classés par meilleur rating
                </span>
              </div>

              {rows
                .slice(3)
                .map((row, index) => (
                  <DesktopCompactQB
                    key={row.qb.id}
                    row={row}
                    rank={index + 4}
                    teamLogo={getTeamLogo(
                      row.qb.team
                    )}
                    isLast={
                      index ===
                      rows.length - 4
                    }
                  />
                ))}
            </section>
          )}
        </>
      )}

      {/* =====================================================
          MOBILE — AFFICHAGE ORIGINAL
          ===================================================== */}

      {!isDesktop &&
        rows.map((row, index) => (
          <section
            key={row.qb.id}
            className="card"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "54px 110px 1fr",
                gap: 16,
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,

                  background:
                    index < 3
                      ? "#166534"
                      : "#1e293b",

                  color: "white",
                  fontWeight: 900,

                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                #{index + 1}
              </div>

              <QBPhoto
                qb={row.qb}
                size={104}
              />

              <div>
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  {row.qb.name}
                </h2>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 8,
                    color: "#94a3b8",
                  }}
                >
                  <TeamLogo
                    logo={getTeamLogo(
                      row.qb.team
                    )}
                    name={row.qb.team}
                    size={42}
                  />

                  <strong>
                    {row.qb.team}
                  </strong>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 10,
              }}
            >
              <RatingMiniCard
                label="Meilleur rating"
                type="best"
                rating={row.best}
                isMobile
              />

              <div
                style={{
                  padding: 12,
                  borderRadius: 18,
                  background:
                    "rgba(148,163,184,0.08)",
                  border:
                    "1px solid rgba(148,163,184,0.16)",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "#94a3b8",
                    fontWeight: 900,
                  }}
                >
                  Moyenne saison
                </p>

                <h2
                  style={{
                    margin: "6px 0",
                    fontSize: 30,
                    color: "#e2e8f0",
                  }}
                >
                  {row.average != null
                    ? row.average.toFixed(1)
                    : "--"}
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: "#94a3b8",
                  }}
                >
                  Toutes les semaines
                </p>
              </div>

              <RatingMiniCard
                label="Pire rating"
                type="worst"
                rating={row.worst}
                isMobile
              />
            </div>
          </section>
        ))}

      <BottomNav />
    </main>
  );
}
