"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

/* =========================================================
   ORDRE OFFICIEL QB — SEMAINE 1
   ========================================================= */

const WEEK_1_QB_ORDER = [
  "Alexandre",
  "Edouard",
  "Louis-Simon",
  "Séb",
  "Charles",
  "Naomie",
  "Léa",
  "Félix",
  "Carolyne",
  "Mathieu",
  "Katy",
  "Pierre-André",
  "Étienne",
];

/* =========================================================
   HELPERS JOUEURS
   ========================================================= */

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerRealName(player) {
  return (
    player?.real_name ||
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function playerDisplayName(player) {
  return (
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) {
  const ordered = [];
  const usedIds = new Set();

  WEEK_1_QB_ORDER.forEach((wantedName) => {
    const wanted = normalizeName(wantedName);

    let player = players.find(
      (p) =>
        !usedIds.has(p.id) &&
        normalizeName(p.real_name) === wanted
    );

    if (!player) {
      player = players.find((p) => {
        if (usedIds.has(p.id)) {
          return false;
        }

        const actual = normalizeName(p.real_name);

        return (
          actual.startsWith(wanted) ||
          wanted.startsWith(actual)
        );
      });
    }

    if (player) {
      ordered.push(player);
      usedIds.add(player.id);
    }
  });

  const leftovers = players
    .filter((p) => !usedIds.has(p.id))
    .sort((a, b) =>
      playerRealName(a).localeCompare(
        playerRealName(b),
        "fr"
      )
    );

  return [...ordered, ...leftovers];
}

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

function formatDuration(milliseconds) {
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
  if (!startedAt) {
    return null;
  }

  const started = new Date(startedAt);

  if (Number.isNaN(started.getTime())) {
    return null;
  }

  if (started.getHours() < 9) {
    const adjusted = new Date(started);
    adjusted.setHours(9, 0, 0, 0);
    return adjusted;
  }

  return started;
}

/* =========================================================
   PAGE
   ========================================================= */

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");

  const [selectionStats, setSelectionStats] = useState([]);
  const [selectionStatsLoading, setSelectionStatsLoading] =
    useState(false);
  const [selectionStatsError, setSelectionStatsError] =
    useState("");

  const [isMobile, setIsMobile] = useState(false);

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
    function updateMobile() {
      setIsMobile(window.innerWidth < 700);
    }

    updateMobile();

    window.addEventListener("resize", updateMobile);

    return () => {
      window.removeEventListener("resize", updateMobile);
    };
  }, []);

  /* =========================================================
     CHARGEMENT INITIAL
     ========================================================= */

  useEffect(() => {
    async function load() {
      const { data: sessionData } =
        await supabase.auth.getSession();

      const currentUser =
        sessionData.session?.user ?? null;

      setUser(currentUser);

      let admin = false;

      if (currentUser) {
        const { data: adminData } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();

        admin = adminData?.is_admin === true;

        setIsAdmin(admin);
      }

      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      setSettings(settingsData);

      if (currentUser && admin && settingsData) {
        await loadSelectionStats(
          Number(settingsData.current_week || 1)
        );
      }
    }

    load();
  }, []);

  /* =========================================================
     SETTINGS
     ========================================================= */

  async function loadSettings() {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .single();

    if (error) {
      throw new Error(
        "Settings : " + error.message
      );
    }

    setSettings(data);

    return data;
  }

  /* =========================================================
     STATS TEMPS DE SÉLECTION QB
     ========================================================= */

  async function loadSelectionStats(activeWeek) {
    try {
      setSelectionStatsLoading(true);
      setSelectionStatsError("");

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

      setSelectionStats(rows);
    } catch (error) {
      console.error(error);

      setSelectionStatsError(
        error.message
      );
    } finally {
      setSelectionStatsLoading(false);
    }
  }

  /* =========================================================
     SCORES DES MATCHS ESPN
     ========================================================= */

  async function updateScoresFromEspn(currentWeek) {
    const { data: games, error: gamesError } =
      await supabase
        .from("games")
        .select("*")
        .eq("week", currentWeek)
        .eq("is_pool_eligible", true);

    if (gamesError) {
      throw new Error(
        "Games : " + gamesError.message
      );
    }

    let updated = 0;

    for (const game of games || []) {
      if (!game.external_game_id) {
        continue;
      }

      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
        `?event=${game.external_game_id}`;

      const response = await fetch(url);

      if (!response.ok) {
        console.error(
          `Erreur ESPN match ${game.external_game_id}:`,
          response.status
        );

        continue;
      }

      const data = await response.json();

      const competition =
        data.header?.competitions?.[0];

      const competitors =
        competition?.competitors || [];

      const home = competitors.find(
        (c) => c.homeAway === "home"
      );

      const away = competitors.find(
        (c) => c.homeAway === "away"
      );

      if (!home || !away) {
        continue;
      }

      const homeScore = Number(home.score);
      const awayScore = Number(away.score);

      if (
        Number.isNaN(homeScore) ||
        Number.isNaN(awayScore)
      ) {
        continue;
      }

      const { error } = await supabase
        .from("games")
        .update({
          home_score: homeScore,
          away_score: awayScore,
        })
        .eq("id", game.id);

      if (error) {
        throw new Error(
          "Update score : " +
            error.message
        );
      }

      updated++;
    }

    return updated;
  }

  /* =========================================================
     CLASSEMENTS / FICHES DES ÉQUIPES NFL
     ========================================================= */

  async function updateTeamStandingsFromEspn() {
    const url =
      "https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=0&level=3";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Standings ESPN : ${response.status}`
      );
    }

    const data = await response.json();

    const foundTeams = [];

    function getStat(entry, names) {
      const stats = entry?.stats || [];

      for (const name of names) {
        const stat = stats.find(
          (item) =>
            String(
              item?.name || ""
            ).toLowerCase() ===
            String(name).toLowerCase()
        );

        if (stat?.value != null) {
          return Number(stat.value);
        }
      }

      return 0;
    }

    function cleanDivisionName(name) {
      if (!name) {
        return null;
      }

      const value =
        String(name).trim();

      return value
        .replace(
          /^American Football Conference\s*-\s*/i,
          "AFC "
        )
        .replace(
          /^National Football Conference\s*-\s*/i,
          "NFC "
        )
        .replace(
          /^AFC\s*-\s*/i,
          "AFC "
        )
        .replace(
          /^NFC\s*-\s*/i,
          "NFC "
        );
    }

    function looksLikeDivision(name) {
      if (!name) {
        return false;
      }

      const value =
        String(name).toLowerCase();

      const hasConference =
        value.includes("afc") ||
        value.includes("nfc") ||
        value.includes(
          "american football conference"
        ) ||
        value.includes(
          "national football conference"
        );

      const hasDirection =
        value.includes("east") ||
        value.includes("west") ||
        value.includes("north") ||
        value.includes("south");

      return (
        hasConference &&
        hasDirection
      );
    }

    function walk(
      node,
      inheritedDivision = null
    ) {
      if (!node) {
        return;
      }

      const nodeName =
        node.name ||
        node.displayName ||
        node.shortDisplayName ||
        node.abbreviation ||
        "";

      const currentDivision =
        looksLikeDivision(nodeName)
          ? cleanDivisionName(nodeName)
          : inheritedDivision;

      const entries =
        node.standings?.entries ||
        node.entries ||
        [];

      if (
        currentDivision &&
        entries.length > 0
      ) {
        entries.forEach(
          (entry, index) => {
            const team = entry.team;

            if (!team) {
              return;
            }

            const wins = getStat(
              entry,
              ["wins"]
            );

            const losses = getStat(
              entry,
              ["losses"]
            );

            const ties = getStat(
              entry,
              ["ties"]
            );

            let divisionRank =
              getStat(
                entry,
                [
                  "divisionRank",
                  "divisionrank",
                ]
              );

            if (
              !divisionRank ||
              divisionRank < 1
            ) {
              divisionRank =
                index + 1;
            }

            foundTeams.push({
              espn_abbr:
                team.abbreviation ||
                null,

              team_name:
                team.displayName ||
                team.shortDisplayName ||
                team.name ||
                "",

              wins,
              losses,
              ties,

              division_rank:
                divisionRank,

              division_name:
                currentDivision,
            });
          }
        );
      }

      const children =
        node.children || [];

      children.forEach((child) => {
        walk(
          child,
          currentDivision
        );
      });
    }

    if (
      Array.isArray(data.children) &&
      data.children.length > 0
    ) {
      data.children.forEach(
        (child) => {
          walk(child, null);
        }
      );
    } else {
      walk(data, null);
    }

    const uniqueTeams = new Map();

    foundTeams.forEach((team) => {
      const key =
        team.espn_abbr
          ? team.espn_abbr.toLowerCase()
          : team.team_name
              .toLowerCase()
              .trim();

      const existing =
        uniqueTeams.get(key);

      if (
        !existing ||
        (
          !existing.division_name &&
          team.division_name
        )
      ) {
        uniqueTeams.set(
          key,
          team
        );
      }
    });

    let updated = 0;
    const notMatched = [];

    for (
      const team of uniqueTeams.values()
    ) {
      let query = supabase
        .from("teams")
        .update({
          wins: team.wins,
          losses: team.losses,
          ties: team.ties,
          division_rank:
            team.division_rank,
          division_name:
            team.division_name,
        });

      if (team.espn_abbr) {
        const localAbbr =
          team.espn_abbr === "WSH"
            ? "WAS"
            : team.espn_abbr;

        query = query.ilike(
          "espn_abbr",
          localAbbr
        );
      } else {
        query = query.ilike(
          "name",
          team.team_name
        );
      }

      const {
        data: updatedRows,
        error,
      } = await query.select("id");

      if (error) {
        console.error(
          `Erreur standings ${team.team_name}:`,
          error.message
        );

        notMatched.push(
          `${team.team_name} (${error.message})`
        );

        continue;
      }

      if (
        !updatedRows ||
        updatedRows.length === 0
      ) {
        notMatched.push(
          team.team_name
        );

        continue;
      }

      updated++;
    }

    return {
      updated,
      notMatched,
    };
  }

  /* =========================================================
     QB RATINGS ESPN
     ========================================================= */

  async function updateQBRatingsFromEspn(
    currentWeek
  ) {
    const {
      data: qbPicks,
      error: qbPicksError,
    } = await supabase
      .from("qb_picks")
      .select(`
        *,
        qbs (
          id,
          name,
          team,
          espn_athlete_id
        )
      `)
      .eq("week", currentWeek);

    if (qbPicksError) {
      throw new Error(
        "QB picks : " +
          qbPicksError.message
      );
    }

    const {
      data: games,
      error: gamesError,
    } = await supabase
      .from("games")
      .select("*")
      .eq("week", currentWeek);

    if (gamesError) {
      throw new Error(
        "Games : " +
          gamesError.message
      );
    }

    let updated = 0;
    const notFound = [];

    for (const pick of qbPicks || []) {
      const selectedQB = pick.qbs;

      if (!selectedQB?.team) {
        notFound.push(
          selectedQB?.name ||
            "QB sans équipe"
        );

        continue;
      }

      const qbTeam =
        selectedQB.team.toLowerCase();

      const game = (games || []).find(
        (g) => {
          const home = (
            g.home_team || ""
          ).toLowerCase();

          const away = (
            g.away_team || ""
          ).toLowerCase();

          return (
            home.includes(qbTeam) ||
            away.includes(qbTeam)
          );
        }
      );

      if (!game?.external_game_id) {
        notFound.push(
          selectedQB.name
        );

        continue;
      }

      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
        `?event=${game.external_game_id}`;

      const response = await fetch(url);

      if (!response.ok) {
        notFound.push(
          `${selectedQB.name} (ESPN ${response.status})`
        );

        continue;
      }

      const summary =
        await response.json();

      const boxscoreTeams =
        summary.boxscore?.players ||
        [];

      let passingAthletes = [];

      for (
        const teamBox of boxscoreTeams
      ) {
        const teamName =
          teamBox.team
            ?.shortDisplayName ||
          teamBox.team
            ?.displayName ||
          teamBox.team?.name ||
          "";

        if (
          !teamName
            .toLowerCase()
            .includes(qbTeam)
        ) {
          continue;
        }

        const passingCategory =
          teamBox.statistics?.find(
            (category) =>
              category.name ===
                "passing" ||
              category.displayName ===
                "Passing"
          );

        if (!passingCategory) {
          continue;
        }

        const labels =
          passingCategory.labels ||
          [];

        const ratingIndex =
          labels.findIndex(
            (label) =>
              [
                "RTG",
                "RAT",
                "RATE",
              ].includes(
                String(
                  label
                ).toUpperCase()
              )
          );

        if (ratingIndex === -1) {
          continue;
        }

        passingAthletes =
          passingCategory.athletes
            .map((row) => ({
              id:
                row.athlete?.id,

              name:
                row.athlete
                  ?.displayName,

              rating:
                Number(
                  row.stats?.[
                    ratingIndex
                  ]
                ),
            }))
            .filter(
              (row) =>
                !Number.isNaN(
                  row.rating
                )
            );
      }

      if (
        passingAthletes.length === 0
      ) {
        notFound.push(
          selectedQB.name
        );

        continue;
      }

      let actualQB =
        passingAthletes[0];

      if (
        selectedQB.espn_athlete_id
      ) {
        const exactMatch =
          passingAthletes.find(
            (athlete) =>
              String(athlete.id) ===
              String(
                selectedQB.espn_athlete_id
              )
          );

        if (exactMatch) {
          actualQB =
            exactMatch;
        }
      } else {
        const nameMatch =
          passingAthletes.find(
            (athlete) =>
              athlete.name
                ?.toLowerCase()
                .includes(
                  selectedQB.name.toLowerCase()
                )
          );

        if (nameMatch) {
          actualQB =
            nameMatch;
        }
      }

      /*
       * Si le QB réel était un remplaçant,
       * on l'ajoute à qbs s'il n'existe pas.
       */
      if (
        actualQB?.id &&
        String(actualQB.id) !==
          String(
            selectedQB.espn_athlete_id
          )
      ) {
        const {
          data: existingActualQB,
          error: lookupError,
        } = await supabase
          .from("qbs")
          .select("id")
          .eq(
            "espn_athlete_id",
            String(actualQB.id)
          )
          .maybeSingle();

        if (lookupError) {
          console.error(
            "Erreur recherche QB remplaçant :",
            lookupError.message
          );
        }

        if (!existingActualQB) {
          const {
            error: insertQbError,
          } = await supabase
            .from("qbs")
            .insert({
              name:
                actualQB.name,

              team:
                selectedQB.team,

              espn_athlete_id:
                String(actualQB.id),

              active:
                true,

              is_active_starter:
                false,
            });

          if (insertQbError) {
            console.error(
              "Erreur ajout QB remplaçant :",
              insertQbError.message
            );
          }
        }
      }

      const { error } = await supabase
        .from("qb_ratings")
        .upsert(
          {
            qb_id:
              selectedQB.id,

            week:
              currentWeek,

            passer_rating:
              actualQB.rating,

            actual_qb_name:
              actualQB.name,

            actual_espn_athlete_id:
              actualQB.id,
          },
          {
            onConflict:
              "qb_id,week",
          }
        );

      if (error) {
        notFound.push(
          `${selectedQB.name} (${error.message})`
        );
      } else {
        updated++;
      }
    }

    return {
      updated,
      notFound,
    };
  }

  /* =========================================================
     CALCUL DES SCORES DU POOL
     ========================================================= */

  async function calculateScores(
    currentWeek
  ) {
    const {
      data: picks,
      error: picksError,
    } = await supabase
      .from("picks")
      .select(`
        *,
        games (
          week,
          home_team,
          away_team,
          home_score,
          away_score
        )
      `);

    if (picksError) {
      throw new Error(
        "Picks : " +
          picksError.message
      );
    }

    const {
      data: qbPicks,
    } = await supabase
      .from("qb_picks")
      .select("*")
      .eq("week", currentWeek);

    const {
      data: qbRatings,
    } = await supabase
      .from("qb_ratings")
      .select("*")
      .eq("week", currentWeek);

    const scoresByUser = {};

    (picks || [])
      .filter(
        (pick) =>
          pick.games?.week ===
          currentWeek
      )
      .forEach((pick) => {
        const game =
          pick.games;

        if (
          game.home_score == null ||
          game.away_score == null
        ) {
          return;
        }

        let winner = null;

        if (
          game.home_score >
          game.away_score
        ) {
          winner =
            game.home_team;
        }

        if (
          game.away_score >
          game.home_score
        ) {
          winner =
            game.away_team;
        }

        const realSpread =
          Math.abs(
            game.home_score -
              game.away_score
          );

        let points = 0;

        if (
          pick.picked_team ===
          winner
        ) {
          points = 1;

          if (
            Number(
              pick.predicted_spread
            ) === realSpread
          ) {
            points = 2;
          }
        }

        scoresByUser[
          pick.user_id
        ] =
          (
            scoresByUser[
              pick.user_id
            ] || 0
          ) + points;
      });

    const rows =
      Object.entries(
        scoresByUser
      ).map(
        ([
          userId,
          basePoints,
        ]) => {
          const qbPick =
            (qbPicks || []).find(
              (p) =>
                p.user_id ===
                userId
            );

          const qbRating =
            (qbRatings || []).find(
              (r) =>
                r.qb_id ===
                qbPick?.qb_id
            );

          const passerRating =
            Number(
              qbRating
                ?.passer_rating ||
                0
            );

          const multiplier =
            passerRating > 0
              ? passerRating / 100
              : 1;

          return {
            user_id:
              userId,

            week:
              currentWeek,

            base_points:
              basePoints,

            multiplier:
              Number(
                multiplier.toFixed(3)
              ),

            final_score:
              Number(
                (
                  basePoints *
                  multiplier
                ).toFixed(3)
              ),
          };
        }
      );

    if (rows.length === 0) {
      return 0;
    }

    const { error } = await supabase
      .from("weekly_scores")
      .upsert(
        rows,
        {
          onConflict:
            "user_id,week",
        }
      );

    if (error) {
      throw new Error(
        "Weekly scores : " +
          error.message
      );
    }

    return rows.length;
  }

  /* =========================================================
     MISE À JOUR COMPLÈTE
     ========================================================= */

  const fullUpdate = async () => {
    try {
      setMessage(
        "Mise à jour complète en cours..."
      );

      const currentSettings =
        await loadSettings();

      const currentWeek =
        currentSettings.current_week;

      /*
       * 1. Scores NFL
       */
      const scoresUpdated =
        await updateScoresFromEspn(
          currentWeek
        );

      /*
       * 2. Standings NFL
       */
      const standingsResult =
        await updateTeamStandingsFromEspn();

      /*
       * 3. QB ratings
       */
      const qbResult =
        await updateQBRatingsFromEspn(
          currentWeek
        );

      /*
       * 4. Scores du pool
       */
      const rankingsCalculated =
        await calculateScores(
          currentWeek
        );

      let finalMessage =
        `Mise à jour complète ✅ ` +
        `Scores ESPN : ${scoresUpdated}. ` +
        `Équipes : ${standingsResult.updated}. ` +
        `QB ratings : ${qbResult.updated}. ` +
        `Classements : ${rankingsCalculated}.`;

      if (
        standingsResult
          .notMatched
          .length > 0
      ) {
        finalMessage +=
          ` Équipes non associées : ` +
          standingsResult.notMatched.join(
            ", "
          ) +
          ".";
      }

      if (
        qbResult.notFound
          .length > 0
      ) {
        finalMessage +=
          ` QB non trouvés : ` +
          qbResult.notFound.join(
            ", "
          );
      }

      setMessage(finalMessage);

      await loadSelectionStats(
        Number(currentWeek)
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Erreur mise à jour : " +
          error.message
      );
    }
  };

  /* =========================================================
     SEMAINE SUIVANTE
     ========================================================= */

  const nextWeek = async () => {
    const confirmation =
      window.confirm(
        "Passer à la semaine suivante? Assure-toi que les scores sont calculés."
      );

    if (!confirmation) {
      return;
    }

    try {
      const currentSettings =
        await loadSettings();

      const newWeek =
        Number(
          currentSettings.current_week ||
            1
        ) + 1;

      /*
       * On enregistre l'heure EXACTE
       * à laquelle tu ouvres la nouvelle semaine.
       */
      const startedAt =
        new Date().toISOString();

      const {
        error: startError,
      } = await supabase
        .from("qb_selection_weeks")
        .upsert(
          {
            week: newWeek,
            started_at: startedAt,
          },
          {
            onConflict: "week",
          }
        );

      if (startError) {
        setMessage(
          "Erreur départ sélection QB : " +
            startError.message
        );

        return;
      }

      const { error } = await supabase
        .from("settings")
        .update({
          current_week: newWeek,
        })
        .eq(
          "id",
          currentSettings.id
        );

      if (error) {
        setMessage(
          "Erreur semaine suivante : " +
            error.message
        );

        return;
      }

      const refreshedSettings =
        await loadSettings();

      await loadSelectionStats(
        Number(
          refreshedSettings.current_week
        )
      );

      setMessage(
        `Semaine active changée à ${refreshedSettings.current_week} ✅`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Erreur semaine suivante : " +
          error.message
      );
    }
  };

  /* =========================================================
     ACCÈS
     ========================================================= */

  if (!user) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Admin ⚙️</h1>

          <p>
            Connecte-toi pour accéder à
            l&apos;administration.
          </p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Accès refusé ❌</h1>

          <p>
            Tu n&apos;es pas
            administrateur.
          </p>
        </section>
      </main>
    );
  }

  /* =========================================================
     PAGE ADMIN
     ========================================================= */

  return (
    <main className="page">
      <section className="header-card">
        <h1>Admin ⚙️</h1>

        <p>
          Saison{" "}
          {settings?.current_season ||
            "..."}{" "}
          — semaine{" "}
          {settings?.current_week ||
            "..."}
        </p>
      </section>

      {message && (
        <section className="card">
          <p style={{ margin: 0 }}>
            {message}
          </p>
        </section>
      )}

      {/* =====================================================
          MISE À JOUR ESPN
          ===================================================== */}

      <section className="card">
        <h2>
          Mise à jour complète
        </h2>

        <p
          style={{
            color: "#94a3b8",
          }}
        >
          Met à jour les scores ESPN,
          les fiches des équipes, les
          passer ratings QB et les
          classements pour la semaine
          active.
        </p>

        <button
          className="button"
          onClick={fullUpdate}
        >
          Mettre à jour ESPN +
          classements
        </button>
      </section>

      {/* =====================================================
          SEMAINE ACTIVE
          ===================================================== */}

      <section className="card">
        <h2>
          Semaine active
        </h2>

        <p
          style={{
            color: "#94a3b8",
          }}
        >
          À utiliser quand la semaine
          est terminée et validée.
        </p>

        <button
          className="button-secondary"
          onClick={nextWeek}
        >
          Passer à la semaine suivante
        </button>
      </section>

      {/* =====================================================
          TEMPS DE SÉLECTION
          ===================================================== */}

      <section className="card">
        <div
          style={{
            marginBottom: 18,
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#f8fafc",
            }}
          >
            ⏱️ Temps de sélection
          </h2>
        </div>

        {selectionStatsLoading ? (
          <p
            style={{
              color: "#94a3b8",
              margin: 0,
            }}
          >
            Calcul des statistiques...
          </p>
        ) : selectionStatsError ? (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 14,
              background:
                "rgba(239,68,68,0.08)",
              border:
                "1px solid rgba(239,68,68,0.25)",
              color: "#fca5a5",
            }}
          >
            {selectionStatsError}
          </div>
        ) : isMobile ? (
          /*
           * MOBILE
           */
          <div>
            {selectionStats.map(
              (row, index) => (
                <div
                  key={row.userId}
                  style={{
                    padding: "15px 0",
                    borderBottom:
                      index <
                      selectionStats.length -
                        1
                        ? "1px solid rgba(148,163,184,0.12)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "flex-start",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#f8fafc",
                          fontWeight: 900,
                          fontSize: 15,
                        }}
                      >
                        {playerDisplayName(
                          row.player
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {playerRealName(
                          row.player
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        textAlign:
                          "right",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#4ade80",
                          fontWeight: 900,
                          fontSize: 16,
                        }}
                      >
                        {formatDuration(
                          row.average
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 10,
                          fontWeight: 800,
                          marginTop: 2,
                        }}
                      >
                        MOYENNE
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(3, minmax(0, 1fr))",
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    <div
                      style={{
                        padding:
                          "9px 8px",
                        borderRadius: 11,
                        background:
                          "rgba(15,23,42,0.65)",
                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 9,
                          fontWeight: 900,
                        }}
                      >
                        CETTE SEM.
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",
                          fontSize: 12,
                          fontWeight: 800,
                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.current
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding:
                          "9px 8px",
                        borderRadius: 11,
                        background:
                          "rgba(15,23,42,0.65)",
                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 9,
                          fontWeight: 900,
                        }}
                      >
                        + RAPIDE
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",
                          fontSize: 12,
                          fontWeight: 800,
                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.fastest
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding:
                          "9px 8px",
                        borderRadius: 11,
                        background:
                          "rgba(15,23,42,0.65)",
                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 9,
                          fontWeight: 900,
                        }}
                      >
                        + LONG
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",
                          fontSize: 12,
                          fontWeight: 800,
                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.slowest
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      color: "#64748b",
                      fontSize: 10,
                    }}
                  >
                    {row.samples} sélection
                    {row.samples === 1
                      ? ""
                      : "s"}{" "}
                    comptabilisée
                    {row.samples === 1
                      ? ""
                      : "s"}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          /*
           * DESKTOP
           */
          <div
            style={{
              overflowX: "auto",
            }}
          >
            <div
              style={{
                minWidth: 760,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(180px, 1.4fr) repeat(4, minmax(100px, 1fr)) 75px",
                  gap: 12,
                  padding:
                    "0 12px 10px",
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform:
                    "uppercase",
                  letterSpacing:
                    "0.35px",
                }}
              >
                <div>Joueur</div>
                <div>Moyenne</div>
                <div>Cette sem.</div>
                <div>+ rapide</div>
                <div>+ long</div>
                <div>Sem.</div>
              </div>

              {selectionStats.map(
                (row, index) => (
                  <div
                    key={row.userId}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(180px, 1.4fr) repeat(4, minmax(100px, 1fr)) 75px",
                      gap: 12,
                      alignItems:
                        "center",
                      padding:
                        "13px 12px",
                      borderTop:
                        "1px solid rgba(148,163,184,0.10)",
                      background:
                        index === 0
                          ? "rgba(34,197,94,0.055)"
                          : "transparent",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color:
                            "#f8fafc",
                          fontSize: 14,
                          fontWeight: 900,
                        }}
                      >
                        {playerDisplayName(
                          row.player
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",
                          fontSize: 11,
                          marginTop: 2,
                        }}
                      >
                        {playerRealName(
                          row.player
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        color:
                          "#4ade80",
                        fontWeight: 900,
                      }}
                    >
                      {formatDuration(
                        row.average
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#f8fafc",
                        fontWeight: 800,
                      }}
                    >
                      {formatDuration(
                        row.current
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#cbd5e1",
                        fontWeight: 700,
                      }}
                    >
                      {formatDuration(
                        row.fastest
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#cbd5e1",
                        fontWeight: 700,
                      }}
                    >
                      {formatDuration(
                        row.slowest
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#94a3b8",
                        fontWeight: 800,
                      }}
                    >
                      {row.samples}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
