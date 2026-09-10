"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

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

function PlayerIdentity({
  name,
  realName: secondaryName,
  align = "left",
  compact = false,
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
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
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 10 }}>
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

      <div style={{ color: "#94a3b8" }}>
        {subtitle}
      </div>
    </div>
  );
}

function PersonalStatCard({
  icon,
  title,
  value,
  subtitle,
  color = "#22c55e",
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background: "rgba(15,23,42,0.72)",
        border: "1px solid rgba(148,163,184,0.13)",
      }}
    >
      <div
        style={{
          fontSize: 22,
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
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 5,
          color,
          fontSize: 25,
          fontWeight: 900,
        }}
      >
        {value}
      </div>

      {subtitle && (
        <div
          style={{
            marginTop: 4,
            color: "#64748b",
            fontSize: 11,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function QBRecordCard({
  icon,
  title,
  qb,
  teams,
  color = "#22c55e",
  isAverage = false,
}) {
  const team = teams.find(
    (t) =>
      t.name?.toLowerCase().trim() ===
      qb?.team?.toLowerCase().trim()
  );

  const logo = team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo || null;

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 22,
        background: "rgba(15,23,42,0.82)",
        border: "1px solid rgba(148,163,184,0.16)",
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 10 }}>
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

      {!qb ? (
        <p style={{ color: "#94a3b8" }}>
          Aucune donnée
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <strong
              style={{
                fontSize: 20,
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
                  width: 34,
                  height: 34,
                  objectFit: "contain",
                }}
              />
            )}
          </div>

          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              color,
              marginBottom: 8,
            }}
          >
            {qb.rating.toFixed(1)}
          </div>

          {isAverage ? (
            <p
              style={{
                margin: "3px 0",
                color: "#94a3b8",
              }}
            >
              {qb.detail}
            </p>
          ) : (
            <>
              <p
                style={{
                  margin: "3px 0",
                  color: "#94a3b8",
                }}
              >
                Semaine {qb.week}
              </p>

              <div style={{ marginTop: 6 }}>
                <span
                  style={{
                    display: "block",
                    color: "#94a3b8",
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                >
                  Choisi par
                </span>

                <PlayerIdentity
                  name={qb.selectedBy}
                  realName={qb.selectedByRealName}
                  compact={true}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MiniRanking({ title, rows, valueLabel }) {
  return (
    <section className="card">
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
              gridTemplateColumns: "42px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 0",
              borderBottom:
                "1px solid rgba(148,163,184,0.12)",
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

            <div>
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

function ConsensusCard({ consensus }) {
  const total =
    consensus.wins + consensus.losses;

  const percentage =
    total > 0
      ? (consensus.wins / total) * 100
      : 0;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>
        🧠 Consensus du pool
      </h2>

      <p
        style={{
          color: "#94a3b8",
          marginTop: -4,
        }}
      >
        Performance du choix majoritaire du pool.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            typeof window !== "undefined" &&
            window.innerWidth < 800
              ? "1fr 1fr"
              : "repeat(4, 1fr)",
          gap: 12,
          marginTop: 18,
        }}
      >
        <PersonalStatCard
          icon="🏈"
          title="Fiche"
          value={`${consensus.wins}–${consensus.losses}`}
          subtitle={`${total} matchs`}
        />

        <PersonalStatCard
          icon="📊"
          title="Réussite"
          value={
            total > 0
              ? `${percentage.toFixed(1)} %`
              : "--"
          }
          color="#38bdf8"
        />

        <PersonalStatCard
          icon="🔥"
          title="Meilleure semaine"
          value={
            consensus.bestWeek
              ? `${consensus.bestWeek.wins}–${consensus.bestWeek.losses}`
              : "--"
          }
          subtitle={
            consensus.bestWeek
              ? `Semaine ${consensus.bestWeek.week}`
              : ""
          }
          color="#facc15"
        />

        <PersonalStatCard
          icon="📉"
          title="Pire semaine"
          value={
            consensus.worstWeek
              ? `${consensus.worstWeek.wins}–${consensus.worstWeek.losses}`
              : "--"
          }
          subtitle={
            consensus.worstWeek
              ? `Semaine ${consensus.worstWeek.week}`
              : ""
          }
          color="#ef4444"
        />
      </div>
    </section>
  );
}

function PersonalHistory({
  history,
  qbHistory,
  teams,
}) {
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
              typeof window !== "undefined" &&
              window.innerWidth < 800
                ? "1fr 1fr"
                : "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <PersonalStatCard
            icon="🏆"
            title="Score total"
            value={history.total.toFixed(3)}
          />

          <PersonalStatCard
            icon="📊"
            title="Moyenne / semaine"
            value={
              history.count > 0
                ? history.average.toFixed(3)
                : "--"
            }
            color="#38bdf8"
          />

          <PersonalStatCard
            icon="🔥"
            title="Meilleure semaine"
            value={
              history.best
                ? history.best.score.toFixed(3)
                : "--"
            }
            subtitle={
              history.best
                ? `Semaine ${history.best.week}`
                : ""
            }
            color="#facc15"
          />

          <PersonalStatCard
            icon="📉"
            title="Pire semaine"
            value={
              history.worst
                ? history.worst.score.toFixed(3)
                : "--"
            }
            subtitle={
              history.worst
                ? `Semaine ${history.worst.week}`
                : ""
            }
            color="#ef4444"
          />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          📅 Mes semaines
        </h2>

        {history.weeks.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>
            Aucune semaine calculée.
          </p>
        ) : (
          history.weeks.map((row, index) => (
            <div
              key={row.week}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(90px, 1fr) auto",
                gap: 12,
                alignItems: "center",
                padding: "13px 0",
                borderBottom:
                  index <
                  history.weeks.length - 1
                    ? "1px solid rgba(148,163,184,0.12)"
                    : "none",
              }}
            >
              <div>
                <strong
                  style={{
                    color: "#f8fafc",
                    fontSize: 15,
                  }}
                >
                  Semaine {row.week}
                </strong>

                {row.basePoints != null && (
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: 11,
                      marginTop: 3,
                    }}
                  >
                    {row.basePoints} pts ×{" "}
                    {row.multiplier != null
                      ? Number(
                          row.multiplier
                        ).toFixed(3)
                      : "--"}
                  </div>
                )}
              </div>

              <strong
                style={{
                  color: "#22c55e",
                  fontSize: 20,
                }}
              >
                {row.score.toFixed(3)}
              </strong>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          🏈 Mes QB utilisés
        </h2>

        <p
          style={{
            color: "#94a3b8",
            marginTop: -4,
          }}
        >
          Tes choix de QB depuis le début de la saison.
        </p>

        {qbHistory.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>
            Aucun QB utilisé.
          </p>
        ) : (
          qbHistory.map((row, index) => {
            const team = teams.find(
              (t) =>
                t.name
                  ?.toLowerCase()
                  .trim() ===
                row.team
                  ?.toLowerCase()
                  .trim()
            );

            const logo = team?.espn_abbr
              ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
              : team?.logo || null;

            return (
              <div
                key={`${row.week}-${row.qbId}`}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "55px minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "13px 0",
                  borderBottom:
                    index < qbHistory.length - 1
                      ? "1px solid rgba(148,163,184,0.12)"
                      : "none",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {logo ? (
                    <img
                      src={logo}
                      alt={row.team}
                      style={{
                        width: 44,
                        height: 44,
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <span>🏈</span>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: "block",
                      color: "#f8fafc",
                      fontSize: 15,
                    }}
                  >
                    {row.selectedName}
                  </strong>

                  <div
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      marginTop: 3,
                    }}
                  >
                    Semaine {row.week}
                    {row.actualName &&
                    row.actualName !==
                      row.selectedName
                      ? ` · QB utilisé : ${row.actualName}`
                      : ""}
                  </div>
                </div>

                <strong
                  style={{
                    color:
                      row.rating != null
                        ? "#22c55e"
                        : "#64748b",
                    fontSize: 18,
                  }}
                >
                  {row.rating != null
                    ? row.rating.toFixed(1)
                    : "--"}
                </strong>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

export default function AnalyticsPage() {
  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [stats, setStats] =
    useState(null);

  const [teams, setTeams] =
    useState([]);

  const [personalHistory, setPersonalHistory] =
    useState(null);

  const [personalQbs, setPersonalQbs] =
    useState([]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setMessage("");

      const {
        data: authData,
      } = await supabase.auth.getUser();

      const currentUser =
        authData?.user || null;

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
          game_id,
          picked_team,
          predicted_spread,
          games (
            id,
            week,
            is_pool_eligible,
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

      const {
        data: weeklyScores,
      } = await supabase
        .from("weekly_scores")
        .select("*");

      const {
        data: qbRatings,
      } = await supabase
        .from("qb_ratings")
        .select("*");

      const {
        data: qbPicks,
      } = await supabase
        .from("qb_picks")
        .select("*");

      const {
        data: qbs,
      } = await supabase
        .from("qbs")
        .select("*");

      const users = usersData || [];

      /*
       * Seulement les matchs officiels,
       * terminés et admissibles au pool.
       */
      const picks = (picksData || []).filter(
        (p) =>
          p.games?.is_pool_eligible === true &&
          p.games?.home_score != null &&
          p.games?.away_score != null
      );

      /* =====================================================
         STATS GÉNÉRALES
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

      picks.forEach((pick) => {
        const game = pick.games;

        if (
          Number(game.home_score) ===
          Number(game.away_score)
        ) {
          return;
        }

        const winner =
          Number(game.home_score) >
          Number(game.away_score)
            ? game.home_team
            : game.away_team;

        const realSpread = Math.abs(
          Number(game.home_score) -
            Number(game.away_score)
        );

        if (!byUser[pick.user_id]) {
          const user = users.find(
            (u) => u.id === pick.user_id
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

        if (
          pick.picked_team === winner
        ) {
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
            detail:
              `${u.exactMargins} / ${u.totalPicks} choix`,
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
            detail:
              `${Math.round(
                (u.correctWinners /
                  u.totalPicks) *
                  100
              )} % de bons gagnants`,
          }));

      const weeklyRows =
        (weeklyScores || []).map(
          (row) => {
            const user = users.find(
              (u) =>
                u.id === row.user_id
            );

            return {
              ...row,
              name: displayName(user),
              realName: realName(user),
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
            sum + u.correctWinners,
          0
        );

      const totalExact =
        userRows.reduce(
          (sum, u) =>
            sum + u.exactMargins,
          0
        );

      /* =====================================================
         CONSENSUS DU POOL
         ===================================================== */

      const gamesById = {};

      picks.forEach((pick) => {
        if (!gamesById[pick.game_id]) {
          gamesById[pick.game_id] = {
            game: pick.games,
            picks: [],
          };
        }

        gamesById[
          pick.game_id
        ].picks.push(pick);
      });

      const consensusByWeek = {};

      let consensusWins = 0;
      let consensusLosses = 0;

      Object.values(
        gamesById
      ).forEach(({ game, picks: gamePicks }) => {
        if (
          !game ||
          gamePicks.length === 0 ||
          Number(game.home_score) ===
            Number(game.away_score)
        ) {
          return;
        }

        const homeCount =
          gamePicks.filter(
            (p) =>
              p.picked_team ===
              game.home_team
          ).length;

        const awayCount =
          gamePicks.filter(
            (p) =>
              p.picked_team ===
              game.away_team
          ).length;

        /*
         * Historique incomplet avec égalité :
         * on ignore le match.
         */
        if (homeCount === awayCount) {
          return;
        }

        const consensusTeam =
          homeCount > awayCount
            ? game.home_team
            : game.away_team;

        const winner =
          Number(game.home_score) >
          Number(game.away_score)
            ? game.home_team
            : game.away_team;

        const week =
          Number(game.week);

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
          consensusWins++;
          consensusByWeek[
            week
          ].wins++;
        } else {
          consensusLosses++;
          consensusByWeek[
            week
          ].losses++;
        }
      });

      const consensusWeeks =
        Object.values(
          consensusByWeek
        ).filter(
          (row) =>
            row.wins +
              row.losses >
            0
        );

      const sortedConsensusWeeks =
        [...consensusWeeks].sort(
          (a, b) => {
            const pctA =
              a.wins /
              (a.wins +
                a.losses);

            const pctB =
              b.wins /
              (b.wins +
                b.losses);

            if (pctB !== pctA) {
              return pctB - pctA;
            }

            return (
              b.wins - a.wins
            );
          }
        );

      const consensusBestWeek =
        sortedConsensusWeeks[0] ||
        null;

      const consensusWorstWeek =
        sortedConsensusWeeks.length > 0
          ? sortedConsensusWeeks[
              sortedConsensusWeeks.length -
                1
            ]
          : null;

      /* =====================================================
         RECORDS QB
         ===================================================== */

      const validRatings =
        (qbRatings || []).filter(
          (row) =>
            row.passer_rating != null &&
            Number.isFinite(
              Number(
                row.passer_rating
              )
            )
        );

      const bestQb =
        [...validRatings].sort(
          (a, b) =>
            Number(
              b.passer_rating
            ) -
            Number(
              a.passer_rating
            )
        )[0];

      const worstQb =
        [...validRatings].sort(
          (a, b) =>
            Number(
              a.passer_rating
            ) -
            Number(
              b.passer_rating
            )
        )[0];

      function qbLabel(rating) {
        if (!rating) return null;

        const selectedQb =
          (qbs || []).find(
            (q) =>
              q.id ===
              rating.qb_id
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
              Number(p.week) ===
                Number(
                  rating.week
                )
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

      const qbAverageRows =
        Object.values(
          validRatings.reduce(
            (acc, rating) => {
              const selectedQb =
                (qbs || []).find(
                  (q) =>
                    q.id ===
                    rating.qb_id
                );

              const athleteId =
                rating.actual_espn_athlete_id ||
                selectedQb
                  ?.espn_athlete_id;

              if (!athleteId) {
                return acc;
              }

              const key =
                String(athleteId);

              if (!acc[key]) {
                const actualQb =
                  (qbs || []).find(
                    (q) =>
                      String(
                        q.espn_athlete_id
                      ) ===
                      key
                  );

                acc[key] = {
                  name:
                    rating.actual_qb_name ||
                    actualQb?.name ||
                    selectedQb?.name ||
                    "QB",
                  team:
                    actualQb?.team ||
                    selectedQb?.team ||
                    "",
                  total: 0,
                  count: 0,
                };
              }

              acc[key].total +=
                Number(
                  rating.passer_rating
                );

              acc[key].count +=
                1;

              return acc;
            },
            {}
          )
        )
          .map((row) => ({
            name: row.name,
            team: row.team,
            rating:
              row.total /
              row.count,
            detail:
              `${row.count} utilisation${
                row.count > 1
                  ? "s"
                  : ""
              }`,
          }))
          .sort(
            (a, b) =>
              b.rating -
              a.rating
          );

      /* =====================================================
         HISTORIQUE PERSONNEL
         ===================================================== */

      if (currentUser) {
        const myWeeks =
          weeklyRows
            .filter(
              (row) =>
                row.user_id ===
                currentUser.id
            )
            .map((row) => ({
              week: Number(
                row.week
              ),
              score:
                Number(row.score),
              basePoints:
                row.base_points !=
                null
                  ? Number(
                      row.base_points
                    )
                  : null,
              multiplier:
                row.multiplier !=
                null
                  ? Number(
                      row.multiplier
                    )
                  : null,
            }))
            .sort(
              (a, b) =>
                a.week - b.week
            );

        const myTotal =
          myWeeks.reduce(
            (sum, row) =>
              sum + row.score,
            0
          );

        const myAverage =
          myWeeks.length > 0
            ? myTotal /
              myWeeks.length
            : 0;

        const myBest =
          myWeeks.length > 0
            ? [...myWeeks].sort(
                (a, b) =>
                  b.score -
                  a.score
              )[0]
            : null;

        const myWorst =
          myWeeks.length > 0
            ? [...myWeeks].sort(
                (a, b) =>
                  a.score -
                  b.score
              )[0]
            : null;

        setPersonalHistory({
          weeks: myWeeks,
          total: myTotal,
          average: myAverage,
          count:
            myWeeks.length,
          best: myBest,
          worst: myWorst,
        });

        /*
         * Historique des QB :
         * le nom principal demeure le QB SÉLECTIONNÉ.
         * Si un remplaçant a réellement joué,
         * il est indiqué séparément.
         */
        const myQbPicks =
          (qbPicks || [])
            .filter(
              (pick) =>
                pick.user_id ===
                currentUser.id
            )
            .sort(
              (a, b) =>
                Number(a.week) -
                Number(b.week)
            );

        const myQbRows =
          myQbPicks.map(
            (pick) => {
              const selectedQb =
                (qbs || []).find(
                  (q) =>
                    q.id ===
                    pick.qb_id
                );

              const rating =
                validRatings.find(
                  (r) =>
                    r.qb_id ===
                      pick.qb_id &&
                    Number(
                      r.week
                    ) ===
                      Number(
                        pick.week
                      )
                );

              return {
                week:
                  Number(
                    pick.week
                  ),
                qbId:
                  pick.qb_id,
                selectedName:
                  selectedQb?.name ||
                  "QB",
                actualName:
                  rating?.actual_qb_name ||
                  selectedQb?.name ||
                  "QB",
                team:
                  selectedQb?.team ||
                  "",
                rating:
                  rating?.passer_rating !=
                  null
                    ? Number(
                        rating.passer_rating
                      )
                    : null,
              };
            }
          );

        setPersonalQbs(
          myQbRows
        );
      } else {
        setPersonalHistory(null);
        setPersonalQbs([]);
      }

      setStats({
        bestWeek,
        worstWeek,
        totalPicks,
        totalCorrect,
        totalExact,
        topExact,
        topCorrect,
        bestQb:
          qbLabel(bestQb),
        worstQb:
          qbLabel(worstQb),
        qbAverageRows,

        consensus: {
          wins:
            consensusWins,
          losses:
            consensusLosses,
          bestWeek:
            consensusBestWeek,
          worstWeek:
            consensusWorstWeek,
        },
      });

      setLoading(false);
    }

    loadData();
  }, []);

  return (
    <main
      className="page"
      style={{
        maxWidth: 1100,
      }}
    >
      <section className="header-card">
        <h1>
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
          {/* RECORDS SAISON */}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              Records de saison
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  typeof window !== "undefined" &&
                  window.innerWidth < 800
                    ? "1fr"
                    : "repeat(4, 1fr)",
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
                          stats.bestWeek.name
                        }
                        realName={
                          stats.bestWeek.realName
                        }
                        compact={true}
                      />

                      <div
                        style={{
                          marginTop: 5,
                        }}
                      >
                        Semaine{" "}
                        {
                          stats.bestWeek.week
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
                          stats.worstWeek.name
                        }
                        realName={
                          stats.worstWeek.realName
                        }
                        compact={true}
                      />

                      <div
                        style={{
                          marginTop: 5,
                        }}
                      >
                        Semaine{" "}
                        {
                          stats.worstWeek.week
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

          {/* CONSENSUS */}

          <ConsensusCard
            consensus={
              stats.consensus
            }
          />

          {/* RANKINGS */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                typeof window !== "undefined" &&
                window.innerWidth < 900
                  ? "1fr"
                  : "1fr 1fr",
              gap: 16,
            }}
          >
            <MiniRanking
              title="Top écarts exacts 🎯"
              rows={
                stats.topExact
              }
              valueLabel=""
            />

            <MiniRanking
              title="Top bons gagnants ✅"
              rows={
                stats.topCorrect
              }
              valueLabel=""
            />
          </div>

          {/* RECORDS QB */}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>
              Records QB 🔥
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  typeof window !== "undefined" &&
                  window.innerWidth < 900
                    ? "1fr"
                    : "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <QBRecordCard
                icon="🔥"
                title="Meilleur QB utilisé"
                qb={
                  stats.bestQb
                }
                teams={teams}
              />

              <QBRecordCard
                icon="💀"
                title="Pire QB utilisé"
                qb={
                  stats.worstQb
                }
                teams={teams}
                color="#ef4444"
              />

              <QBRecordCard
                icon="📊"
                title="Meilleure moyenne QB"
                qb={
                  stats.qbAverageRows[
                    0
                  ] || null
                }
                teams={teams}
                color="#38bdf8"
                isAverage={true}
              />
            </div>
          </section>

          {/* HISTORIQUE PERSONNEL */}

          {personalHistory && (
            <PersonalHistory
              history={
                personalHistory
              }
              qbHistory={
                personalQbs
              }
              teams={teams}
            />
          )}

          <section className="card">
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
