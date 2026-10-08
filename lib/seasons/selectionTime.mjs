import {initialOrder} from "./regularClient.mjs";

// Existing Admin calculation, shared by the two regular-season screens.
function playerRealName(player) {
  return (
    player?.real_name ||
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) { return initialOrder(players); }

/* =========================================================
   HELPERS SCORES / ORDRE
   ========================================================= */

function getWeeklyScoreValue(row) {
  const candidates = [
    row?.total_score,
    row?.final_score,
    row?.weekly_score,
    row?.score,
    row?.points,
    row?.total,
  ];

  for (const value of candidates) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

/* =========================================================
   HELPERS TEMPS
   ========================================================= */

export function formatDuration(milliseconds) {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    !Number.isFinite(milliseconds)
  ) {
    return "—";
  }

  const totalMinutes = Math.max(
    0,
    Math.round(milliseconds / 60000)
  );

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/*
 * SEMAINE 1
 *
 * Le signal réel donné à Alexandre était 19 h 05.
 *
 * On utilise la date de sa soumission pour retrouver
 * automatiquement la bonne date du signal.
 *
 * S'il a soumis après minuit, 19 h 05 correspond
 * automatiquement à la veille.
 */
function getWeek1FirstPlayerStart(alexandrePickCreatedAt) {
  if (!alexandrePickCreatedAt) {
    return null;
  }

  const pickedAt = new Date(alexandrePickCreatedAt);

  if (Number.isNaN(pickedAt.getTime())) {
    return null;
  }

  const start = new Date(pickedAt);

  start.setHours(19, 5, 0, 0);

  if (start.getTime() > pickedAt.getTime()) {
    start.setDate(start.getDate() - 1);
  }

  return start;
}

/*
 * SEMAINES 2+
 *
 * Si tu passes à la nouvelle semaine avant 9 h,
 * le premier joueur commence à 9 h.
 *
 * Si tu passes à la nouvelle semaine après 9 h,
 * le chrono commence immédiatement.
 */
function getAdjustedFirstPlayerStart(startedAt) {
  if (!startedAt) return null;

  const started = new Date(startedAt);

  if (Number.isNaN(started.getTime())) {
    return null;
  }

  /*
    Si la semaine est ouverte avant 8 h 30,
    le chrono officiel du premier joueur commence à 8 h 30.

    Si elle est ouverte à 8 h 30 ou plus tard,
    le chrono commence au moment réel de l'ouverture.
  */

  if (
    started.getHours() < 8 ||
    (started.getHours() === 8 && started.getMinutes() < 30)
  ) {
    const adjusted = new Date(started);
    adjusted.setHours(8, 30, 0, 0);
    return adjusted;
  }

  return started;
}

export async function loadSelectionStats(supabase, activeWeek) {
      const {
        data: playersData,
        error: playersError,
      } = await supabase
        .from("users")
        .select(
          "id, email, display_name, real_name"
        );

      if (playersError) {
        throw new Error(
          "Joueurs : " + playersError.message
        );
      }

      const players = playersData || [];

      const {
        data: qbPicksData,
        error: qbPicksError,
      } = await supabase
        .from("qb_picks")
        .select(
          "id, user_id, week, qb_id, created_at"
        )
        .lte("week", activeWeek)
        .order("week", {
          ascending: true,
        })
        .order("created_at", {
          ascending: true,
        });

      if (qbPicksError) {
        throw new Error(
          "QB picks : " + qbPicksError.message
        );
      }

      const {
        data: weeklyScoresData,
        error: weeklyScoresError,
      } = await supabase
        .from("weekly_scores")
        .select("*")
        .lt("week", activeWeek)
        .order("week", {
          ascending: true,
        });

      if (weeklyScoresError) {
        throw new Error(
          "Weekly scores : " +
            weeklyScoresError.message
        );
      }

      const {
        data: weekStartsData,
        error: weekStartsError,
      } = await supabase
        .from("qb_selection_weeks")
        .select("week, started_at")
        .lte("week", activeWeek);

      if (weekStartsError) {
        throw new Error(
          "Départs de semaine : " +
            weekStartsError.message
        );
      }

      const qbPicks = qbPicksData || [];
      const weeklyScores = weeklyScoresData || [];
      const weekStarts = weekStartsData || [];

      const statsByUser = {};

      players.forEach((player) => {
        statsByUser[player.id] = {
          player,
          durations: [],
          byWeek: {},
        };
      });

      for (
        let week = 1;
        week <= activeWeek;
        week++
      ) {
        const weekPicks = qbPicks.filter(
          (pick) =>
            Number(pick.week) === Number(week)
        );

        if (weekPicks.length === 0) {
          continue;
        }

        let fullOrder = [];

        /*
         * SEMAINE 1
         */
        if (week === 1) {
          fullOrder = getWeek1Order(players);
        } else {
          /*
           * SEMAINE 2+
           *
           * Même logique que Mes choix :
           * plus faible score de la semaine précédente
           * choisit en premier.
           */
          const previousWeekScores =
            weeklyScores.filter(
              (row) =>
                Number(row.week) ===
                Number(week - 1)
            );

          const scoreByUser = {};

          previousWeekScores.forEach((row) => {
            scoreByUser[row.user_id] =
              getWeeklyScoreValue(row);
          });

          fullOrder = [...players].sort((a, b) => {
            const scoreA = scoreByUser[a.id];
            const scoreB = scoreByUser[b.id];

            const hasA =
              scoreA !== null &&
              scoreA !== undefined;

            const hasB =
              scoreB !== null &&
              scoreB !== undefined;

            if (hasA && !hasB) {
              return -1;
            }

            if (!hasA && hasB) {
              return 1;
            }

            if (
              hasA &&
              hasB &&
              scoreA !== scoreB
            ) {
              return scoreA - scoreB;
            }

            return playerRealName(a).localeCompare(
              playerRealName(b),
              "fr"
            );
          });
        }

        const pickByUser = {};

        weekPicks.forEach((pick) => {
          pickByUser[pick.user_id] = pick;
        });

        const weekStart = weekStarts.find(
          (row) =>
            Number(row.week) === Number(week)
        );

        for (
          let index = 0;
          index < fullOrder.length;
          index++
        ) {
          const player = fullOrder[index];

          const currentPick =
            pickByUser[player.id];

          if (!currentPick?.created_at) {
            continue;
          }

          const pickedAt = new Date(
            currentPick.created_at
          );

          if (
            Number.isNaN(pickedAt.getTime())
          ) {
            continue;
          }

          let startTime = null;

          /*
           * PREMIER JOUEUR
           */
          if (index === 0) {
            if (week === 1) {
              /*
               * Alexandre :
               * signal officiel semaine 1 = 19 h 05.
               */
              startTime =
                getWeek1FirstPlayerStart(
                  currentPick.created_at
                );
            } else {
              /*
               * Semaines suivantes :
               * heure du clic "Passer à la semaine suivante".
               */
              if (!weekStart?.started_at) {
                continue;
              }

              startTime =
                getAdjustedFirstPlayerStart(
                  weekStart.started_at
                );
            }
          } else {
            /*
             * JOUEURS 2 À 13
             *
             * Leur chrono commence exactement
             * lorsque le joueur précédent soumet.
             */
            const previousPlayer =
              fullOrder[index - 1];

            const previousPick =
              pickByUser[previousPlayer.id];

            if (!previousPick?.created_at) {
              continue;
            }

            startTime = new Date(
              previousPick.created_at
            );
          }

          if (
            !startTime ||
            Number.isNaN(startTime.getTime())
          ) {
            continue;
          }

          const duration =
            pickedAt.getTime() -
            startTime.getTime();

          /*
           * Une durée négative signifierait qu'un joueur
           * a soumis avant que son tour officiel commence.
           * On ne l'inclut pas dans la moyenne.
           */
          if (duration < 0) {
            continue;
          }

          if (!statsByUser[player.id]) {
            continue;
          }

          statsByUser[player.id].durations.push(
            duration
          );

          statsByUser[player.id].byWeek[week] =
            duration;
        }
      }

      const rows = Object.values(statsByUser)
        .map((entry) => {
          const durations =
            entry.durations || [];

          const average =
            durations.length > 0
              ? durations.reduce(
                  (sum, value) =>
                    sum + value,
                  0
                ) / durations.length
              : null;

          const fastest =
            durations.length > 0
              ? Math.min(...durations)
              : null;

          const slowest =
            durations.length > 0
              ? Math.max(...durations)
              : null;

          const current =
            entry.byWeek[
              Number(activeWeek)
            ] ?? null;

          return {
            userId: entry.player.id,
            player: entry.player,
            average,
            fastest,
            slowest,
            current,
            samples: durations.length,
          };
        })
        .sort((a, b) => {
          if (
            a.average === null &&
            b.average === null
          ) {
            return playerRealName(
              a.player
            ).localeCompare(
              playerRealName(b.player),
              "fr"
            );
          }

          if (a.average === null) {
            return 1;
          }

          if (b.average === null) {
            return -1;
          }

          return a.average - b.average;
        });

return rows;
}
