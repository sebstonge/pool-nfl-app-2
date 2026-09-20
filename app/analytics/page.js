"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

/* =========================================================
   HELPERS
   ========================================================= */

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "Joueur";
}

function realName(user) {
  return user?.real_name || "";
}

function statValue(row) {
  return Number(
    row?.final_score ??
      row?.score ??
      row?.total_score ??
      row?.points ??
      0
  );
}

/* =========================================================
   IDENTITÉ JOUEUR
   ========================================================= */

function PlayerIdentity({
  name,
  realName: secondaryName,
  compact = false,
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <strong
        style={{
          display: "block",
          fontSize: compact ? 14 : 16,
          lineHeight: 1.15,
          color: "#f8fafc",
          overflow: "hidden",
          textOverflow: "ellipsis",
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
            fontSize: compact ? 11 : 13,
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
   CARTE STATISTIQUE
   ========================================================= */

function StatCard({
  icon,
  title,
  value,
  subtitle,
  color = "#22c55e",
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
        minWidth: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          fontSize: 30,
          marginBottom: 10,
        }}
      >
        {icon}
      </div>

      <p
        style={{
          margin: 0,
          color: "#cbd5e1",
          fontWeight: 800,
        }}
      >
        {title}
      </p>

      <h2
        style={{
          margin: "8px 0",
          color,
          fontSize: 34,
        }}
      >
        {value}
      </h2>

      <div
        style={{
          margin: 0,
          color: "#94a3b8",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

/* =========================================================
   CONSENSUS
   ========================================================= */

function ConsensusCard({
  icon,
  title,
  value,
  subtitle,
  color = "#38bdf8",
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background: "rgba(15,23,42,0.72)",
        border: "1px solid rgba(148,163,184,0.14)",
        minWidth: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          fontSize: 26,
          marginBottom: 8,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          color: "#94a3b8",
          fontSize: 12,
          fontWeight: 800,
          marginBottom: 5,
        }}
      >
        {title}
      </div>

      <strong
        style={{
          display: "block",
          color,
          fontSize: 26,
          lineHeight: 1.1,
        }}
      >
        {value}
      </strong>

      {subtitle && (
        <div
          style={{
            marginTop: 6,
            color: "#cbd5e1",
            fontSize: 13,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   CARTE RECORD QB
   ========================================================= */

function QBRecordCard({
  icon,
  title,
  qb,
  teams,
  color = "#22c55e",
  isDesktop = false,
}) {
  const team = teams.find(
    (t) =>
      t.name?.toLowerCase().trim() ===
      qb?.team?.toLowerCase().trim()
  );

  const logo = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo || null;

  const qbHeadshot =
    qb?.espn_athlete_id
      ? `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`
      : null;

  return (
    <div
      style={{
        padding: isDesktop
          ? "18px 22px"
          : 18,

        borderRadius: 22,

        background:
          "rgba(15,23,42,0.82)",

        border:
          "1px solid rgba(148,163,184,0.16)",

        minWidth: 0,
      }}
    >
      {!qb ? (
        <>
          <div
            style={{
              fontSize: 30,
              marginBottom: 10,
            }}
          >
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

          <p
            style={{
              color: "#94a3b8",
              marginBottom: 0,
            }}
          >
            Aucune donnée
          </p>
        </>
      ) : isDesktop ? (
        /* =====================================================
           DESKTOP — CARTE HORIZONTALE
           ===================================================== */

        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 27,
                lineHeight: 1,
              }}
            >
              {icon}
            </span>

            <strong
              style={{
                color: "#cbd5e1",
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              {title}
            </strong>
          </div>

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                "145px minmax(0, 1fr) minmax(175px, 0.7fr)",

              gap: 20,

              alignItems: "center",
            }}
          >
            {/* ===============================================
                PHOTO QB
                =============================================== */}

            <div
              style={{
                height: 150,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {qbHeadshot ? (
                <img
                  src={qbHeadshot}
                  alt={qb.name}
                  style={{
                    width: 145,
                    height: 150,
                    objectFit: "contain",
                    objectPosition: "center bottom",
                    display: "block",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 20,
                    background:
                      "rgba(148,163,184,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    fontWeight: 900,
                    fontSize: 22,
                  }}
                >
                  QB
                </div>
              )}
            </div>

            {/* ===============================================
                QB + RATING
                =============================================== */}

            <div
              style={{
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    color: "#f8fafc",
                    fontSize: 23,
                    lineHeight: 1.1,
                    fontWeight: 900,
                    overflowWrap: "anywhere",
                  }}
                >
                  {qb.name}
                </strong>

                {logo && (
                  <img
                    src={logo}
                    alt={qb.team}
                    style={{
                      width: 42,
                      height: 42,
                      objectFit: "contain",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>

              <div
                style={{
                  marginTop: 10,
                  color,
                  fontSize: 40,
                  lineHeight: 1,
                  fontWeight: 900,
                }}
              >
                {qb.rating.toFixed(1)}
              </div>

              <div
                style={{
                  marginTop: 9,
                  color: "#94a3b8",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                Semaine {qb.week}
              </div>
            </div>

            {/* ===============================================
                JOUEUR DU POOL
                =============================================== */}

            <div
              style={{
                minWidth: 0,
                paddingLeft: 20,
                borderLeft:
                  "1px solid rgba(148,163,184,0.18)",
              }}
            >
              <span
                style={{
                  display: "block",
                  marginBottom: 6,
                  color: "#94a3b8",
                  fontSize: 14,
                }}
              >
                Choisi par
              </span>

              <PlayerIdentity
                name={qb.selectedBy}
                realName={
                  qb.selectedByRealName
                }
              />
            </div>
          </div>
        </>
      ) : (
        /* =====================================================
           MOBILE — VERSION VERTICALE
           ===================================================== */

        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 28,
              }}
            >
              {icon}
            </span>

            <strong
              style={{
                color: "#cbd5e1",
                fontWeight: 800,
              }}
            >
              {title}
            </strong>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "100px minmax(0, 1fr)",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div
              style={{
                height: 110,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {qbHeadshot ? (
                <img
                  src={qbHeadshot}
                  alt={qb.name}
                  style={{
                    width: 100,
                    height: 110,
                    objectFit: "contain",
                    objectPosition:
                      "center bottom",
                    display: "block",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 90,
                    height: 90,
                    borderRadius: 18,
                    background:
                      "rgba(148,163,184,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    fontWeight: 900,
                  }}
                >
                  QB
                </div>
              )}
            </div>

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
                }}
              >
                <strong
                  style={{
                    fontSize: 19,
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
                      width: 32,
                      height: 32,
                      objectFit: "contain",
                    }}
                  />
                )}
              </div>

              <div
                style={{
                  marginTop: 7,
                  fontSize: 32,
                  lineHeight: 1,
                  fontWeight: 900,
                  color,
                }}
              >
                {qb.rating.toFixed(1)}
              </div>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "#94a3b8",
                }}
              >
                Semaine {qb.week}
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop:
                "1px solid rgba(148,163,184,0.12)",
            }}
          >
            <span
              style={{
                display: "block",
                color: "#94a3b8",
                fontSize: 12,
                marginBottom: 3,
              }}
            >
              Choisi par
            </span>

            <PlayerIdentity
              name={qb.selectedBy}
              realName={
                qb.selectedByRealName
              }
              compact
            />
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   MINI CLASSEMENT
   ========================================================= */

function MiniRanking({
  title,
  rows,
  valueLabel = "",
}) {
  return (
    <section
      className="card"
      style={{ height: "100%" }}
    >
      <h2 style={{ marginTop: 0 }}>
        {title}
      </h2>

      {rows.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>
          Aucune donnée.
        </p>
      ) : (
        rows.slice(0, 5).map((row, index) => (
          <div
            key={row.userId || index}
            style={{
              display: "grid",
              gridTemplateColumns:
                "42px minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 0",
              borderBottom:
                index ===
                Math.min(rows.length, 5) - 1
                  ? "none"
                  : "1px solid rgba(148,163,184,0.12)",
            }}
          >
            <strong
              style={{
                color:
                  index < 3
                    ? "#22c55e"
                    : "#94a3b8",
              }}
            >
              #{index + 1}
            </strong>

            <div style={{ minWidth: 0 }}>
              <PlayerIdentity
                name={row.name}
                realName={row.realName}
              />

              <p
                style={{
                  margin: "4px 0 0 0",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                {row.detail}
              </p>
            </div>

            <strong
              style={{
                color: "#22c55e",
                fontSize: 22,
              }}
            >
              {row.value}
              {valueLabel}
            </strong>
          </div>
        ))
      )}
    </section>
  );
}

/* =========================================================
   HISTORIQUE PERSONNEL
   ========================================================= */

function PersonalHistory({
  weeks,
  totalScore,
  bestWeek,
  worstWeek,
  isDesktop,
}) {
  const average =
    weeks.length > 0
      ? totalScore / weeks.length
      : 0;

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          👤 Mon historique
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              isDesktop
                ? "repeat(4, minmax(0, 1fr))"
                : "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <ConsensusCard
            icon="🏆"
            title="Score total"
            value={totalScore.toFixed(3)}
            subtitle="Saison"
            color="#facc15"
          />

          <ConsensusCard
            icon="📊"
            title="Moyenne / semaine"
            value={average.toFixed(3)}
            subtitle={`${weeks.length} semaine${
              weeks.length > 1 ? "s" : ""
            }`}
          />

          <ConsensusCard
            icon="🔥"
            title="Meilleure semaine"
            value={
              bestWeek
                ? bestWeek.score.toFixed(3)
                : "--"
            }
            subtitle={
              bestWeek
                ? `Semaine ${bestWeek.week}`
                : "Aucune donnée"
            }
            color="#22c55e"
          />

          <ConsensusCard
            icon="📉"
            title="Pire semaine"
            value={
              worstWeek
                ? worstWeek.score.toFixed(3)
                : "--"
            }
            subtitle={
              worstWeek
                ? `Semaine ${worstWeek.week}`
                : "Aucune donnée"
            }
            color="#ef4444"
          />
        </div>
      </section>
    </>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function AnalyticsPage() {
  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [stats, setStats] =
    useState(null);

  const [teams, setTeams] =
    useState([]);

  const [currentUser, setCurrentUser] =
    useState(null);

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
      setLoading(true);
      setMessage("");

      const {
        data: sessionData,
      } =
        await supabase.auth.getSession();

      const authUser =
        sessionData.session?.user ||
        null;

      setCurrentUser(authUser);

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
        data: picksData,
        error: picksError,
      } = await supabase
        .from("picks")
        .select(`
          id,
          user_id,
          picked_team,
          predicted_spread,
          games (
            id,
            week,
            away_team,
            home_team,
            away_score,
            home_score
          )
        `);

      if (picksError) {
        setMessage(
          "Erreur picks : " +
            picksError.message
        );
        setLoading(false);
        return;
      }

      const { data: weeklyScores } =
        await supabase
          .from("weekly_scores")
          .select("*");

      const { data: qbRatings } =
        await supabase
          .from("qb_ratings")
          .select("*");

      const { data: qbPicks } =
        await supabase
          .from("qb_picks")
          .select("*");

      const { data: qbs } =
        await supabase
          .from("qbs")
          .select("*");

      const users = usersData || [];

      const completedPicks =
        (picksData || []).filter(
          (p) =>
            p.games?.home_score != null &&
            p.games?.away_score != null
        );

      /* =====================================================
         STATS PAR JOUEUR
         ===================================================== */

      const byUser = {};

      users.forEach((user) => {
        byUser[user.id] = {
          userId: user.id,
          name: displayName(user),
          realName: realName(user),
          totalPicks: 0,
          correctWinners: 0,
          exactMargins: 0,
          wrong: 0,
        };
      });

      completedPicks.forEach((pick) => {
        const game = pick.games;

        const winner =
          game.home_score > game.away_score
            ? game.home_team
            : game.away_team;

        const realSpread =
          Math.abs(
            game.home_score -
              game.away_score
          );

        if (!byUser[pick.user_id]) {
          const user = users.find(
            (u) =>
              u.id === pick.user_id
          );

          byUser[pick.user_id] = {
            userId: pick.user_id,
            name: displayName(user),
            realName: realName(user),
            totalPicks: 0,
            correctWinners: 0,
            exactMargins: 0,
            wrong: 0,
          };
        }

        byUser[pick.user_id].totalPicks += 1;

        if (pick.picked_team === winner) {
          byUser[
            pick.user_id
          ].correctWinners += 1;

          if (
            Number(
              pick.predicted_spread
            ) === realSpread
          ) {
            byUser[
              pick.user_id
            ].exactMargins += 1;
          }
        } else {
          byUser[pick.user_id].wrong += 1;
        }
      });

      const userRows =
        Object.values(byUser).filter(
          (u) => u.totalPicks > 0
        );

      const topExact =
        [...userRows]
          .sort(
            (a, b) =>
              b.exactMargins -
              a.exactMargins
          )
          .map((u) => ({
            ...u,
            value: u.exactMargins,
            detail: `${u.exactMargins} / ${u.totalPicks} choix`,
          }));

      const topCorrect =
        [...userRows]
          .sort(
            (a, b) =>
              b.correctWinners -
              a.correctWinners
          )
          .map((u) => ({
            ...u,
            value: u.correctWinners,
            detail: `${Math.round(
              (u.correctWinners /
                u.totalPicks) *
                100
            )} % de bons gagnants`,
          }));

      /* =====================================================
         SCORES HEBDOMADAIRES
         ===================================================== */

      const weeklyRows =
        (weeklyScores || []).map(
          (row) => {
            const user =
              users.find(
                (u) =>
                  u.id ===
                  row.user_id
              );

            return {
              ...row,
              name: displayName(user),
              realName:
                realName(user),
              score: statValue(row),
            };
          }
        );

      const bestWeek =
        [...weeklyRows].sort(
          (a, b) =>
            b.score - a.score
        )[0];

      const worstWeek =
        [...weeklyRows].sort(
          (a, b) =>
            a.score - b.score
        )[0];

      const totalPicks =
        userRows.reduce(
          (sum, u) =>
            sum + u.totalPicks,
          0
        );

      const totalCorrect =
        userRows.reduce(
          (sum, u) =>
            sum +
            u.correctWinners,
          0
        );

      const totalExact =
        userRows.reduce(
          (sum, u) =>
            sum +
            u.exactMargins,
          0
        );

      /* =====================================================
         CONSENSUS DU POOL
         ===================================================== */

      const gamesMap = {};

      completedPicks.forEach((pick) => {
        const game = pick.games;

        const gameKey =
          game.id ||
          `${game.week}-${game.away_team}-${game.home_team}`;

        if (!gamesMap[gameKey]) {
          gamesMap[gameKey] = {
            game,
            picks: [],
          };
        }

        gamesMap[gameKey].picks.push(
          pick
        );
      });

      let consensusWins = 0;
      let consensusLosses = 0;

      const consensusByWeek = {};

      Object.values(gamesMap).forEach(
        ({ game, picks }) => {
          const counts = {};

          picks.forEach((pick) => {
            counts[pick.picked_team] =
              (counts[
                pick.picked_team
              ] || 0) + 1;
          });

          const sorted =
            Object.entries(counts).sort(
              (a, b) => b[1] - a[1]
            );

          if (!sorted.length) {
            return;
          }

          const consensusTeam =
            sorted[0][0];

          const winner =
            game.home_score >
            game.away_score
              ? game.home_team
              : game.away_team;

          const week =
            game.week;

          if (!consensusByWeek[week]) {
            consensusByWeek[week] = {
              week,
              wins: 0,
              losses: 0,
            };
          }

          if (
            consensusTeam === winner
          ) {
            consensusWins += 1;
            consensusByWeek[
              week
            ].wins += 1;
          } else {
            consensusLosses += 1;
            consensusByWeek[
              week
            ].losses += 1;
          }
        }
      );

      const consensusGames =
        consensusWins +
        consensusLosses;

      const consensusPct =
        consensusGames > 0
          ? (consensusWins /
              consensusGames) *
            100
          : 0;

      const consensusWeeks =
        Object.values(
          consensusByWeek
        ).map((row) => ({
          ...row,
          pct:
            row.wins +
              row.losses >
            0
              ? (row.wins /
                  (row.wins +
                    row.losses)) *
                100
              : 0,
        }));

      const bestConsensusWeek =
        [...consensusWeeks].sort(
          (a, b) =>
            b.pct - a.pct
        )[0];

      const worstConsensusWeek =
        [...consensusWeeks].sort(
          (a, b) =>
            a.pct - b.pct
        )[0];

      /* =====================================================
         QB
         ===================================================== */

      const bestQb =
        [...(qbRatings || [])].sort(
          (a, b) =>
            Number(
              b.passer_rating || 0
            ) -
            Number(
              a.passer_rating || 0
            )
        )[0];

      const worstQb =
        [...(qbRatings || [])].sort(
          (a, b) =>
            Number(
              a.passer_rating || 999
            ) -
            Number(
              b.passer_rating || 999
            )
        )[0];

      function qbLabel(rating) {
        if (!rating) return null;

        const selectedQb =
          (qbs || []).find(
            (q) =>
              q.id === rating.qb_id
          );

        const actualQb =
          rating.actual_espn_athlete_id
            ? (qbs || []).find(
                (q) =>
                  String(
                    q.espn_athlete_id
                  ) ===
                  String(
                    rating.actual_espn_athlete_id
                  )
              )
            : null;

        const qbName =
          rating.actual_qb_name ||
          actualQb?.name ||
          selectedQb?.name ||
          "QB";

        const pick =
          (qbPicks || []).find(
            (p) =>
              p.qb_id ===
                rating.qb_id &&
              p.week ===
                rating.week
          );

        const user =
          users.find(
            (u) =>
              u.id ===
              pick?.user_id
          );

        return {
          name: qbName,
          team:
            actualQb?.team ||
            selectedQb?.team ||
            "",
          rating: Number(
            rating.passer_rating
          ),
          week: rating.week,
          selectedBy:
            displayName(user),
          selectedByRealName:
            realName(user),
        };
      }

      /* =====================================================
         HISTORIQUE PERSONNEL
         ===================================================== */

      const myWeeklyRows =
        authUser
          ? weeklyRows
              .filter(
                (row) =>
                  row.user_id ===
                  authUser.id
              )
              .sort(
                (a, b) =>
                  Number(a.week) -
                  Number(b.week)
              )
          : [];

      const myTotalScore =
        myWeeklyRows.reduce(
          (sum, row) =>
            sum + row.score,
          0
        );

      const myBestWeek =
        [...myWeeklyRows].sort(
          (a, b) =>
            b.score - a.score
        )[0];

      const myWorstWeek =
        [...myWeeklyRows].sort(
          (a, b) =>
            a.score - b.score
        )[0];

      const myQbPicks =
        authUser
          ? (qbPicks || [])
              .filter(
                (pick) =>
                  pick.user_id ===
                  authUser.id
              )
              .sort(
                (a, b) =>
                  Number(a.week) -
                  Number(b.week)
              )
              .map((pick) => {
                const qb =
                  (qbs || []).find(
                    (q) =>
                      q.id ===
                      pick.qb_id
                  );

                const rating =
                  (qbRatings || []).find(
                    (r) =>
                      r.qb_id ===
                        pick.qb_id &&
                      r.week ===
                        pick.week
                  );

                const actualQb =
                  rating?.actual_espn_athlete_id
                    ? (qbs || []).find(
                        (q) =>
                          String(
                            q.espn_athlete_id
                          ) ===
                          String(
                            rating.actual_espn_athlete_id
                          )
                      )
                    : null;

                return {
                  week: pick.week,
                  qbName:
                    qb?.name ||
                    "QB",
                  team:
                    qb?.team || "",
                  rating:
                    rating?.passer_rating !=
                    null
                      ? Number(
                          rating.passer_rating
                        )
                      : null,
                  actualQbName:
                    rating?.actual_qb_name ||
                    actualQb?.name ||
                    null,
                };
              })
          : [];

      setStats({
        bestWeek,
        worstWeek,
        totalPicks,
        totalCorrect,
        totalExact,
        topExact,
        topCorrect,

        consensusWins,
        consensusLosses,
        consensusPct,
        bestConsensusWeek,
        worstConsensusWeek,

        bestQb:
          qbLabel(bestQb),

        worstQb:
          qbLabel(worstQb),

        myWeeklyRows,
        myTotalScore,
        myBestWeek,
        myWorstWeek,
        myQbPicks,
      });

      setLoading(false);
    }

    loadData();
  }, []);

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
                padding: "28px 32px",
                marginBottom: 20,
              }
            : undefined
        }
      >
        <h1
          style={
            isDesktop
              ? {
                  marginBottom: 6,
                }
              : undefined
          }
        >
          Statistiques avancées 📈
        </h1>

        <p>
          Records et statistiques de la saison.
        </p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {loading && (
        <section className="card">
          <p>
            Chargement des statistiques...
          </p>
        </section>
      )}

      {!loading && stats && (
        <>
          {/* =================================================
              RECORDS DE SAISON
              ================================================= */}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              Records de saison
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  isDesktop
                    ? "repeat(4, minmax(0, 1fr))"
                    : "1fr",
                gap: 12,
              }}
            >
              <StatCard
                icon="🏆"
                title="Meilleur score semaine"
                value={
                  stats.bestWeek
                    ? stats.bestWeek.score.toFixed(
                        3
                      )
                    : "--"
                }
                subtitle={
                  stats.bestWeek ? (
                    <>
                      <PlayerIdentity
                        name={
                          stats.bestWeek
                            .name
                        }
                        realName={
                          stats.bestWeek
                            .realName
                        }
                        compact
                      />

                      <div
                        style={{
                          marginTop: 5,
                        }}
                      >
                        Semaine{" "}
                        {
                          stats.bestWeek
                            .week
                        }
                      </div>
                    </>
                  ) : (
                    "Aucune donnée"
                  )
                }
                color="#facc15"
              />

              <StatCard
                icon="🎯"
                title="Écarts exacts"
                value={
                  stats.totalExact
                }
                subtitle="Total de la saison"
              />

              <StatCard
                icon="✅"
                title="Bons gagnants"
                value={
                  stats.totalCorrect
                }
                subtitle={`${stats.totalPicks} choix calculés`}
                color="#3b82f6"
              />

              <StatCard
                icon="📉"
                title="Pire semaine"
                value={
                  stats.worstWeek
                    ? stats.worstWeek.score.toFixed(
                        3
                      )
                    : "--"
                }
                subtitle={
                  stats.worstWeek ? (
                    <>
                      <PlayerIdentity
                        name={
                          stats.worstWeek
                            .name
                        }
                        realName={
                          stats.worstWeek
                            .realName
                        }
                        compact
                      />

                      <div
                        style={{
                          marginTop: 5,
                        }}
                      >
                        Semaine{" "}
                        {
                          stats.worstWeek
                            .week
                        }
                      </div>
                    </>
                  ) : (
                    "Aucune donnée"
                  )
                }
                color="#ef4444"
              />
            </div>
          </section>

          {/* =================================================
              CONSENSUS DU POOL
              ================================================= */}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              🧠 Consensus du pool
            </h2>

            <p
              style={{
                marginTop: -4,
                marginBottom: 16,
                color: "#94a3b8",
              }}
            >
              Performance du choix majoritaire du pool.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  isDesktop
                    ? "repeat(4, minmax(0, 1fr))"
                    : "repeat(2, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              <ConsensusCard
                icon="👥"
                title="Fiche"
                value={`${stats.consensusWins}-${stats.consensusLosses}`}
                subtitle="Consensus gagnant / perdant"
              />

              <ConsensusCard
                icon="🎯"
                title="Taux de réussite"
                value={`${stats.consensusPct.toFixed(
                  1
                )} %`}
                subtitle="Choix majoritaire"
                color="#22c55e"
              />

              <ConsensusCard
                icon="🔥"
                title="Meilleure semaine"
                value={
                  stats.bestConsensusWeek
                    ? `${stats.bestConsensusWeek.pct.toFixed(
                        0
                      )} %`
                    : "--"
                }
                subtitle={
                  stats.bestConsensusWeek
                    ? `Semaine ${stats.bestConsensusWeek.week} · ${stats.bestConsensusWeek.wins}-${stats.bestConsensusWeek.losses}`
                    : "Aucune donnée"
                }
                color="#facc15"
              />

              <ConsensusCard
                icon="🧊"
                title="Pire semaine"
                value={
                  stats.worstConsensusWeek
                    ? `${stats.worstConsensusWeek.pct.toFixed(
                        0
                      )} %`
                    : "--"
                }
                subtitle={
                  stats.worstConsensusWeek
                    ? `Semaine ${stats.worstConsensusWeek.week} · ${stats.worstConsensusWeek.wins}-${stats.worstConsensusWeek.losses}`
                    : "Aucune donnée"
                }
                color="#ef4444"
              />
            </div>
          </section>

          {/* =================================================
              TOP JOUEURS
              ================================================= */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                isDesktop
                  ? "repeat(2, minmax(0, 1fr))"
                  : "1fr",
              gap: isDesktop ? 18 : 16,
              alignItems: "stretch",
            }}
          >
            <MiniRanking
              title="Top écarts exacts 🎯"
              rows={stats.topExact}
            />

            <MiniRanking
              title="Top bons gagnants ✅"
              rows={stats.topCorrect}
            />
          </div>

                 {/* =================================================
              RECORDS QB
              ================================================= */}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              Records QB 🔥
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  isDesktop
                    ? "repeat(2, minmax(0, 1fr))"
                    : "1fr",
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
            </div>
          </section>

          {/* =================================================
              MON HISTORIQUE
              ================================================= */}

          {currentUser && (
            <>
              <PersonalHistory
                weeks={
                  stats.myWeeklyRows
                }
                totalScore={
                  stats.myTotalScore
                }
                bestWeek={
                  stats.myBestWeek
                }
                worstWeek={
                  stats.myWorstWeek
                }
                isDesktop={
                  isDesktop
                }
              />

              {/* =============================================
                  MES SEMAINES + MES QB
                  ============================================= */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    isDesktop
                      ? "repeat(2, minmax(0, 1fr))"
                      : "1fr",
                  gap:
                    isDesktop
                      ? 18
                      : 16,
                  alignItems: "start",
                }}
              >
                {/* ===========================================
                    MES SEMAINES
                    =========================================== */}

                <section className="card">
                  <h2
                    style={{
                      marginTop: 0,
                    }}
                  >
                    📅 Mes semaines
                  </h2>

                  {stats.myWeeklyRows
                    .length === 0 ? (
                    <p
                      style={{
                        color:
                          "#94a3b8",
                      }}
                    >
                      Aucun score calculé.
                    </p>
                  ) : (
                    stats.myWeeklyRows.map(
                      (row, index) => (
                        <div
                          key={
                            row.id ||
                            `${row.week}-${index}`
                          }
                          style={{
                            display:
                              "grid",
                            gridTemplateColumns:
                              "auto minmax(0, 1fr) auto",
                            gap: 12,
                            alignItems:
                              "center",
                            padding:
                              "13px 0",
                            borderBottom:
                              index ===
                              stats
                                .myWeeklyRows
                                .length -
                                1
                                ? "none"
                                : "1px solid rgba(148,163,184,0.12)",
                          }}
                        >
                          <strong
                            style={{
                              color:
                                "#94a3b8",
                              minWidth:
                                34,
                            }}
                          >
                            S{row.week}
                          </strong>

                          <span
                            style={{
                              color:
                                "#cbd5e1",
                            }}
                          >
                            Score de la semaine
                          </span>

                          <strong
                            style={{
                              color:
                                "#22c55e",
                              fontSize:
                                18,
                            }}
                          >
                            {row.score.toFixed(
                              3
                            )}
                          </strong>
                        </div>
                      )
                    )
                  )}
                </section>

                {/* ===========================================
                    MES QB UTILISÉS
                    =========================================== */}

                <section className="card">
                  <h2
                    style={{
                      marginTop: 0,
                    }}
                  >
                    🏈 Mes QB utilisés
                  </h2>

                  {stats.myQbPicks
                    .length === 0 ? (
                    <p
                      style={{
                        color:
                          "#94a3b8",
                      }}
                    >
                      Aucun QB utilisé.
                    </p>
                  ) : (
                    stats.myQbPicks.map(
                      (row, index) => (
                        <div
                          key={`${row.week}-${row.qbName}-${index}`}
                          style={{
                            display:
                              "grid",
                            gridTemplateColumns:
                              "42px minmax(0, 1fr) auto",
                            gap: 12,
                            alignItems:
                              "center",
                            padding:
                              "13px 0",
                            borderBottom:
                              index ===
                              stats
                                .myQbPicks
                                .length -
                                1
                                ? "none"
                                : "1px solid rgba(148,163,184,0.12)",
                          }}
                        >
                          <strong
                            style={{
                              color:
                                "#94a3b8",
                            }}
                          >
                            S{row.week}
                          </strong>

                          <div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  }}
>
  {(() => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() ===
        row.team?.toLowerCase().trim()
    );

    const logo = team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo || null;

    return logo ? (
      <img
        src={logo}
        alt={row.team || row.qbName}
        style={{
          width: 34,
          height: 34,
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
    ) : null;
  })()}

  <div
    style={{
      minWidth: 0,
    }}
  >
    <strong
      style={{
        display: "block",
        color: "#f8fafc",
      }}
    >
      {row.qbName}
    </strong>

    {row.actualQbName &&
      row.actualQbName !== row.qbName && (
        <span
          style={{
            display: "block",
            marginTop: 3,
            color: "#facc15",
            fontSize: 12,
          }}
        >
          Rating obtenu par{" "}
          {row.actualQbName}
        </span>
      )}
  </div>
</div>

                          <strong
                            style={{
                              color:
                                row.rating !=
                                null
                                  ? "#22c55e"
                                  : "#64748b",
                              fontSize:
                                18,
                            }}
                          >
                            {row.rating !=
                            null
                              ? row.rating.toFixed(
                                  1
                                )
                              : "--"}
                          </strong>
                        </div>
                      )
                    )
                  )}
                </section>
              </div>
            </>
          )}

          {/* =================================================
              INFO
              ================================================= */}

          <section
            className="card"
            style={
              isDesktop
                ? {
                    padding:
                      "16px 20px",
                  }
                : undefined
            }
          >
            <p
              style={{
                margin: 0,
                color: "#94a3b8",
              }}
            >
              ⭐ Les statistiques se mettent à jour automatiquement après le calcul des scores.
            </p>
          </section>
        </>
      )}

      <BottomNav />
    </main>
  );
}
