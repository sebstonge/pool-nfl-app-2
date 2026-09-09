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
    <div
      style={{
        textAlign: align,
        minWidth: 0,
      }}
    >
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

function PersonalStatCard({
  label,
  value,
  color = "#f8fafc",
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 16,
        background: "rgba(15,23,42,0.72)",
        border: "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <div
        style={{
          color: "#94a3b8",
          fontSize: 12,
          fontWeight: 800,
          marginBottom: 6,
        }}
      >
        {label}
      </div>

      <strong
        style={{
          color,
          fontSize: 20,
          lineHeight: 1.2,
        }}
      >
        {value}
      </strong>
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

              <div
                style={{
                  marginTop: 6,
                }}
              >
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

function MiniRanking({
  title,
  rows,
  valueLabel,
}) {
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
        rows
          .slice(0, 5)
          .map((row, index) => (
            <div
              key={row.userId || index}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "42px 1fr auto",
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
  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
            }}
          >
            Consensus du pool 🎯
          </h2>

          <p
            style={{
              margin: "5px 0 0",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            Performance du choix majoritaire
          </p>
        </div>

        {consensus.total > 0 && (
          <div
            style={{
              padding: "6px 11px",
              borderRadius: 999,
              background:
                "rgba(34,197,94,0.12)",
              border:
                "1px solid rgba(34,197,94,0.25)",
              color: "#22c55e",
              fontWeight: 900,
              fontSize: 13,
            }}
          >
            Saison
          </div>
        )}
      </div>

      {consensus.total === 0 ? (
        <p
          style={{
            color: "#94a3b8",
            marginBottom: 0,
          }}
        >
          Aucun match officiel complété.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 16,
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            <strong
              style={{
                fontSize: 34,
                color: "#f8fafc",
                lineHeight: 1,
              }}
            >
              {consensus.wins}–
              {consensus.losses}
            </strong>

            <strong
              style={{
                fontSize: 22,
                color: "#22c55e",
              }}
            >
              {consensus.percentage.toFixed(
                1
              )}
              %
            </strong>
          </div>

          <p
            style={{
              margin: "12px 0 0",
              color: "#cbd5e1",
              lineHeight: 1.5,
            }}
          >
            Le choix majoritaire du pool a
            remporté{" "}
            <strong
              style={{
                color: "#f8fafc",
              }}
            >
              {consensus.wins}
            </strong>{" "}
            des{" "}
            <strong
              style={{
                color: "#f8fafc",
              }}
            >
              {consensus.total}
            </strong>{" "}
            matchs terminés.
          </p>
        </>
      )}
    </section>
  );
}

function PersonalHistory({
  personal,
  teams,
}) {
  function getTeamLogo(teamName) {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() ===
        teamName?.toLowerCase().trim()
    );

    if (team?.espn_abbr) {
      return `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`;
    }

    return team?.logo || null;
  }

  return (
    <>
      <section className="card">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
              }}
            >
              Mon historique 👤
            </h2>

            <p
              style={{
                margin: "5px 0 0",
                color: "#94a3b8",
                fontSize: 13,
              }}
            >
              Mes performances cette saison
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(2, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          <PersonalStatCard
            label="Score saison"
            value={personal.totalScore.toFixed(
              3
            )}
            color="#22c55e"
          />

          <PersonalStatCard
            label="Moyenne / semaine"
            value={
              personal.weeklyScores.length >
              0
                ? personal.averageScore.toFixed(
                    3
                  )
                : "--"
            }
          />

          <PersonalStatCard
            label="Meilleure semaine"
            value={
              personal.bestWeek
                ? `S${personal.bestWeek.week} · ${personal.bestWeek.score.toFixed(
                    3
                  )}`
                : "--"
            }
            color="#facc15"
          />

          <PersonalStatCard
            label="QB utilisés"
            value={
              personal.usedQbs.length
            }
          />
        </div>
      </section>

      <section className="card">
        <h2
          style={{
            marginTop: 0,
          }}
        >
          Mes semaines 📅
        </h2>

        {personal.weeklyScores.length ===
        0 ? (
          <p
            style={{
              color: "#94a3b8",
            }}
          >
            Aucune semaine calculée.
          </p>
        ) : (
          personal.weeklyScores.map(
            (row, index) => (
              <div
                key={row.week}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "12px 0",
                  borderBottom:
                    index ===
                    personal.weeklyScores
                      .length -
                      1
                      ? "none"
                      : "1px solid rgba(148,163,184,0.12)",
                }}
              >
                <div>
                  <strong
                    style={{
                      display: "block",
                      color: "#f8fafc",
                    }}
                  >
                    Semaine {row.week}
                  </strong>

                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      color: "#94a3b8",
                      fontSize: 12,
                    }}
                  >
                    Points de base :{" "}
                    {Number(
                      row.base_points || 0
                    ).toFixed(0)}
                    {" · "}
                    Multiplicateur :{" "}
                    {Number(
                      row.multiplier || 0
                    ).toFixed(3)}
                  </span>
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
            )
          )
        )}
      </section>

      <section className="card">
        <h2
          style={{
            marginTop: 0,
          }}
        >
          Mes QB utilisés 🏈
        </h2>

        <p
          style={{
            marginTop: -4,
            color: "#94a3b8",
            fontSize: 13,
          }}
        >
          Les QB que j'ai déjà sélectionnés
          cette saison.
        </p>

        {personal.usedQbs.length === 0 ? (
          <p
            style={{
              color: "#94a3b8",
            }}
          >
            Aucun QB utilisé.
          </p>
        ) : (
          personal.usedQbs.map(
            (qb, index) => {
              const logo = getTeamLogo(
                qb.team
              );

              return (
                <div
                  key={`${qb.week}-${qb.qbId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "44px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 0",
                    borderBottom:
                      index ===
                      personal.usedQbs
                        .length -
                        1
                        ? "none"
                        : "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 999,
                      background:
                        "rgba(15,23,42,0.9)",
                      border:
                        "1px solid rgba(148,163,184,0.16)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    {logo ? (
                      <img
                        src={logo}
                        alt={qb.team}
                        style={{
                          width: 34,
                          height: 34,
                          objectFit:
                            "contain",
                        }}
                      />
                    ) : (
                      <span>🏈</span>
                    )}
                  </div>

                  <div
                    style={{
                      minWidth: 0,
                    }}
                  >
                    <strong
                      style={{
                        display: "block",
                        color: "#f8fafc",
                        overflow:
                          "hidden",
                        textOverflow:
                          "ellipsis",
                      }}
                    >
                      {qb.name}
                    </strong>

                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        color: "#94a3b8",
                        fontSize: 12,
                      }}
                    >
                      Semaine {qb.week}
                      {qb.team
                        ? ` · ${qb.team}`
                        : ""}
                    </span>
                  </div>

                  <div
                    style={{
                      textAlign: "right",
                    }}
                  >
                    {qb.rating != null ? (
                      <>
                        <strong
                          style={{
                            display:
                              "block",
                            color:
                              "#f8fafc",
                            fontSize: 17,
                          }}
                        >
                          {qb.rating.toFixed(
                            1
                          )}
                        </strong>

                        <span
                          style={{
                            display:
                              "block",
                            marginTop: 2,
                            color:
                              "#94a3b8",
                            fontSize: 11,
                          }}
                        >
                          Rating
                        </span>
                      </>
                    ) : (
                      <span
                        style={{
                          color:
                            "#64748b",
                        }}
                      >
                        —
                      </span>
                    )}
                  </div>
                </div>
              );
            }
          )
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

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setMessage("");

      const {
        data: authData,
      } =
        await supabase.auth.getUser();

      const currentUserId =
        authData?.user?.id || null;

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
          game_id,
          user_id,
          picked_team,
          predicted_spread,
          games (
            id,
            week,
            away_team,
            home_team,
            away_score,
            home_score,
            is_pool_eligible
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

      const users =
        usersData || [];

      const picks =
        (picksData || []).filter(
          (p) =>
            p.games?.is_pool_eligible ===
              true &&
            p.games?.home_score != null &&
            p.games?.away_score != null
        );

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

        const winner =
          Number(game.home_score) >
          Number(game.away_score)
            ? game.home_team
            : game.away_team;

        const realSpread =
          Math.abs(
            Number(game.home_score) -
              Number(game.away_score)
          );

        if (!byUser[pick.user_id]) {
          const user = users.find(
            (u) =>
              u.id === pick.user_id
          );

          byUser[pick.user_id] = {
            userId: pick.user_id,

            name: displayName(user),

            realName:
              realName(user),

            totalPicks: 0,
            correctWinners: 0,
            exactMargins: 0,
            wrong: 0,
          };
        }

        byUser[
          pick.user_id
        ].totalPicks += 1;

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
          byUser[
            pick.user_id
          ].wrong += 1;
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

            value:
              u.exactMargins,

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

            value:
              u.correctWinners,

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
                u.id ===
                row.user_id
            );

            return {
              ...row,

              name:
                displayName(user),

              realName:
                realName(user),

              score:
                statValue(row),
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
            sum +
            u.totalPicks,
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

      const bestQb =
        [...(qbRatings || [])]
          .filter(
            (r) =>
              r.passer_rating != null
          )
          .sort(
            (a, b) =>
              Number(
                b.passer_rating || 0
              ) -
              Number(
                a.passer_rating || 0
              )
          )[0];

      const worstQb =
        [...(qbRatings || [])]
          .filter(
            (r) =>
              r.passer_rating != null
          )
          .sort(
            (a, b) =>
              Number(
                a.passer_rating
              ) -
              Number(
                b.passer_rating
              )
          )[0];

      function qbLabel(rating) {
        if (!rating) {
          return null;
        }

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
              p.week ===
                rating.week
          );

        const user = users.find(
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
          (qbRatings || []).reduce(
            (acc, rating) => {
              if (
                rating.passer_rating ==
                null
              ) {
                return acc;
              }

              const selectedQb =
                (qbs || []).find(
                  (q) =>
                    q.id ===
                    rating.qb_id
                );

              const athleteId =
                rating.actual_espn_athlete_id ||
                selectedQb?.espn_athlete_id;

              if (!athleteId) {
                return acc;
              }

              const key = String(
                athleteId
              );

              if (!acc[key]) {
                const actualQb =
                  (qbs || []).find(
                    (q) =>
                      String(
                        q.espn_athlete_id
                      ) ===
                      String(
                        athleteId
                      )
                  );

                acc[key] = {
                  espn_athlete_id:
                    key,

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
                  rating.passer_rating ||
                    0
                );

              acc[key].count += 1;

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

      /*
       * CONSENSUS DU POOL
       *
       * On regroupe les choix par match.
       * Le consensus = équipe choisie
       * par la majorité des joueurs.
       *
       * Seuls les matchs officiels
       * terminés et is_pool_eligible
       * sont déjà présents dans "picks".
       */

      const picksByGame = {};

      picks.forEach((pick) => {
        const gameId =
          pick.game_id ||
          pick.games?.id;

        if (!gameId) return;

        if (!picksByGame[gameId]) {
          picksByGame[gameId] = {
            game: pick.games,
            picks: [],
          };
        }

        picksByGame[
          gameId
        ].picks.push(pick);
      });

      let consensusWins = 0;
      let consensusLosses = 0;

      Object.values(
        picksByGame
      ).forEach(
        ({ game, picks: gamePicks }) => {
          if (
            !game ||
            game.home_score == null ||
            game.away_score == null
          ) {
            return;
          }

          const homeCount =
            gamePicks.filter(
              (pick) =>
                pick.picked_team ===
                game.home_team
            ).length;

          const awayCount =
            gamePicks.filter(
              (pick) =>
                pick.picked_team ===
                game.away_team
            ).length;

          /*
           * Avec 13 joueurs ayant tous
           * soumis, il ne devrait pas
           * y avoir d'égalité.
           *
           * Si un historique incomplet
           * produit quand même une
           * égalité, on ignore le match.
           */

          if (
            homeCount === awayCount
          ) {
            return;
          }

          const consensusTeam =
            homeCount > awayCount
              ? game.home_team
              : game.away_team;

          const actualWinner =
            Number(
              game.home_score
            ) >
            Number(
              game.away_score
            )
              ? game.home_team
              : game.away_team;

          if (
            consensusTeam ===
            actualWinner
          ) {
            consensusWins += 1;
          } else {
            consensusLosses += 1;
          }
        }
      );

      const consensusTotal =
        consensusWins +
        consensusLosses;

      const consensus = {
        wins: consensusWins,
        losses:
          consensusLosses,
        total: consensusTotal,
        percentage:
          consensusTotal > 0
            ? (consensusWins /
                consensusTotal) *
              100
            : 0,
      };

      /*
       * HISTORIQUE PERSONNEL
       */

      const personalWeeklyScores =
        currentUserId
          ? weeklyRows
              .filter(
                (row) =>
                  row.user_id ===
                  currentUserId
              )
              .sort(
                (a, b) =>
                  Number(a.week) -
                  Number(b.week)
              )
          : [];

      const personalTotalScore =
        personalWeeklyScores.reduce(
          (sum, row) =>
            sum + row.score,
          0
        );

      const personalAverageScore =
        personalWeeklyScores.length >
        0
          ? personalTotalScore /
            personalWeeklyScores.length
          : 0;

      const personalBestWeek =
        personalWeeklyScores.length >
        0
          ? [...personalWeeklyScores]
              .sort(
                (a, b) =>
                  b.score -
                  a.score
              )[0]
          : null;

      const personalQbPicks =
        currentUserId
          ? (qbPicks || [])
              .filter(
                (pick) =>
                  pick.user_id ===
                  currentUserId
              )
              .sort(
                (a, b) =>
                  Number(a.week) -
                  Number(b.week)
              )
          : [];

      const usedQbs =
        personalQbPicks.map(
          (pick) => {
            const selectedQb =
              (qbs || []).find(
                (qb) =>
                  qb.id ===
                  pick.qb_id
              );

            const rating =
              (qbRatings || []).find(
                (row) =>
                  row.qb_id ===
                    pick.qb_id &&
                  Number(
                    row.week
                  ) ===
                    Number(
                      pick.week
                    )
              );

            let actualQb = null;

            if (
              rating?.actual_espn_athlete_id
            ) {
              actualQb =
                (qbs || []).find(
                  (qb) =>
                    String(
                      qb.espn_athlete_id
                    ) ===
                    String(
                      rating.actual_espn_athlete_id
                    )
                );
            }

            return {
              week:
                pick.week,

              qbId:
                pick.qb_id,

              /*
               * Pour l'historique des
               * QB "utilisés", on garde
               * le QB réellement utilisé
               * si ton système a enregistré
               * un remplacement.
               */

              name:
                rating?.actual_qb_name ||
                actualQb?.name ||
                selectedQb?.name ||
                "QB",

              team:
                actualQb?.team ||
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

      const personal = {
        weeklyScores:
          personalWeeklyScores,

        totalScore:
          personalTotalScore,

        averageScore:
          personalAverageScore,

        bestWeek:
          personalBestWeek,

        usedQbs,
      };

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

        consensus,

        personal,
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
          <section className="card">
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Records de saison
            </h2>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  typeof window !==
                    "undefined" &&
                  window.innerWidth <
                    800
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
                          stats.bestWeek
                            .name
                        }
                        realName={
                          stats.bestWeek
                            .realName
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
                        compact={true}
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

          <ConsensusCard
            consensus={
              stats.consensus
            }
          />

          <div
            style={{
              display: "grid",

              gridTemplateColumns:
                typeof window !==
                  "undefined" &&
                window.innerWidth <
                  900
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

          <section className="card">
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Records QB 🔥
            </h2>

            <div
              style={{
                display: "grid",

                gridTemplateColumns:
                  typeof window !==
                    "undefined" &&
                  window.innerWidth <
                    900
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
                teams={
                  teams
                }
              />

              <QBRecordCard
                icon="💀"
                title="Pire QB utilisé"
                qb={
                  stats.worstQb
                }
                teams={
                  teams
                }
                color="#ef4444"
              />

              <QBRecordCard
                icon="📊"
                title="Meilleure moyenne QB"
                qb={
                  stats
                    .qbAverageRows[
                    0
                  ] || null
                }
                teams={
                  teams
                }
                color="#38bdf8"
                isAverage={true}
              />
            </div>
          </section>

          <PersonalHistory
            personal={
              stats.personal
            }
            teams={teams}
          />

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
