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

/* =========================================================
   RESET MOT DE PASSE
   ========================================================= */

const [passwordUsers, setPasswordUsers] = useState([]);
const [passwordUserId, setPasswordUserId] = useState("");
const [temporaryPassword, setTemporaryPassword] = useState("");
const [passwordResetLoading, setPasswordResetLoading] = useState(false);
const [passwordResetMessage, setPasswordResetMessage] = useState("");

const [isMobile, setIsMobile] = useState(false);
const [isDesktop, setIsDesktop] = useState(false);

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
  function updateResponsive() {
    setIsMobile(window.innerWidth < 700);
    setIsDesktop(window.innerWidth >= 900);
  }

  updateResponsive();

  window.addEventListener("resize", updateResponsive);

  return () => {
    window.removeEventListener("resize", updateResponsive);
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

  const { data: passwordUsersData, error: passwordUsersError } =
    await supabase
      .from("users")
      .select("id, email, display_name, real_name, must_change_password")
      .order("real_name", {
        ascending: true,
      });

  if (passwordUsersError) {
    console.error(
      "Erreur chargement utilisateurs :",
      passwordUsersError
    );
  } else {
    setPasswordUsers(passwordUsersData || []);
  }
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

    /*
     * Matchs dont le score a réellement changé
     * depuis la dernière mise à jour Admin.
     */
    const changedGames = [];

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

      /*
       * =====================================================
       * DÉTECTER SI LE SCORE A RÉELLEMENT CHANGÉ
       * =====================================================
       */

      const previousHomeScore =
        game.home_score == null
          ? null
          : Number(game.home_score);

      const previousAwayScore =
        game.away_score == null
          ? null
          : Number(game.away_score);

      const scoreChanged =
        previousHomeScore !== homeScore ||
        previousAwayScore !== awayScore;

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

      /*
       * On garde seulement les matchs
       * qui apportent réellement un nouveau score.
       */
      if (scoreChanged) {
        changedGames.push({
          id: game.id,

          home_team:
            game.home_team,

          away_team:
            game.away_team,

          home_score:
            homeScore,

          away_score:
            awayScore,
        });
      }
    }

    return {
      updated,
      changedGames,
    };
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
      const scoresResult =
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

      /*
       * =====================================================
       * 5. NOTIFICATION DES CLASSEMENTS
       * =====================================================
       *
       * Seulement lorsqu'au moins un score de match
       * admissible a réellement changé.
       *
       * Une erreur de notification ne doit JAMAIS
       * faire échouer la mise à jour ESPN.
       * =====================================================
       */

      let rankingNotificationResult =
        null;

      if (
        scoresResult.changedGames.length >
        0
      ) {
        try {
          const {
            data: { session },
          } =
            await supabase.auth.getSession();

          if (!session?.access_token) {
            console.error(
              "Notification classement : session introuvable."
            );
          } else {
            /*
             * Un seul match modifié :
             *
             * Après Ravens @ Bengals...
             *
             * Plusieurs matchs modifiés :
             *
             * Après les derniers matchs...
             */
            let gameLabel = "";

            if (
              scoresResult.changedGames
                .length === 1
            ) {
              const changedGame =
                scoresResult
                  .changedGames[0];

              gameLabel =
                `${changedGame.away_team} @ ${changedGame.home_team}`;
            }

            const notificationResponse =
              await fetch(
                "/api/push/rankings-updated",
                {
                  method:
                    "POST",

                  headers: {
                    "Content-Type":
                      "application/json",

                    Authorization:
                      `Bearer ${session.access_token}`,
                  },

                  body:
                    JSON.stringify({
                      week:
                        Number(
                          currentWeek
                        ),

                      gameLabel,
                    }),
                }
              );

            rankingNotificationResult =
              await notificationResponse.json();

            if (
              !notificationResponse.ok
            ) {
              console.error(
                "Erreur notification classement :",
                rankingNotificationResult
              );
            } else {
              console.log(
                "Notification classement :",
                rankingNotificationResult
              );
            }
          }
        } catch (
          notificationError
        ) {
          console.error(
            "Erreur notification classement :",
            notificationError
          );
        }
      }

      /*
       * =====================================================
       * MESSAGE ADMIN
       * =====================================================
       */

      let finalMessage =
        `Mise à jour complète ✅ ` +
        `Scores ESPN : ${scoresResult.updated}. ` +
        `Équipes : ${standingsResult.updated}. ` +
        `QB ratings : ${qbResult.updated}. ` +
        `Classements : ${rankingsCalculated}.`;

      /*
       * Information utile pour toi dans Admin.
       */
      if (
        scoresResult.changedGames.length ===
        0
      ) {
        finalMessage +=
          ` Aucun nouveau score à notifier.`;
      } else if (
        rankingNotificationResult
          ?.success
      ) {
        finalMessage +=
          ` Notifications classement : ${rankingNotificationResult.sent}.`;
      }

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
  const confirmed = window.confirm(
    "Passer à la semaine suivante ?\n\n" +
      "Cette action ouvrira officiellement la prochaine semaine du pool."
  );

  if (!confirmed) return;


  setMessage("");

  try {
    /* =====================================================
       1. LIRE LA SEMAINE ACTUELLE
       ===================================================== */

    const { data: currentSettings, error: settingsError } =
      await supabase
        .from("settings")
        .select("current_week")
        .single();

    if (settingsError) throw settingsError;

    const currentWeek = Number(currentSettings?.current_week || 1);
    const newWeek = currentWeek + 1;

    /* =====================================================
       2. ENREGISTRER LE MOMENT D'OUVERTURE
       ===================================================== */

    const startedAt = new Date().toISOString();

    const { error: startError } = await supabase
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

    if (startError) throw startError;

    /* =====================================================
       3. PASSER À LA NOUVELLE SEMAINE
       ===================================================== */

    const { error: updateError } = await supabase
      .from("settings")
      .update({
        current_week: newWeek,
      })
      .eq("id", 1);

    if (updateError) throw updateError;

    /* =====================================================
       4. NOTIFIER LE PREMIER JOUEUR

       - avant 8 h 30 Québec :
         notification programmée pour 8 h 30

       - à partir de 8 h 30 :
         notification immédiate

       Une erreur de notification ne doit JAMAIS annuler
       le changement de semaine.
       ===================================================== */

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        console.error(
          "Notification premier joueur : session introuvable."
        );
      } else {
        const notificationResponse = await fetch(
          "/api/push/first-player",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        const notificationResult =
          await notificationResponse.json();

        if (!notificationResponse.ok) {
          console.error(
            "Erreur notification premier joueur :",
            notificationResult
          );
        } else {
          console.log(
            "Notification premier joueur :",
            notificationResult
          );
        }
      }
    } catch (notificationError) {
      console.error(
        "Erreur notification premier joueur :",
        notificationError
      );
    }

    /* =====================================================
       5. RECHARGER L'ADMIN
       ===================================================== */

  await loadSettings();
await loadSelectionStats(newWeek);

    setMessage(
      `Semaine ${newWeek} ouverte avec succès ✅`
    );
  } catch (error) {
    console.error(
      "Erreur passage semaine suivante :",
      error
    );

    setMessage(
      `Erreur : ${error?.message || "Impossible de passer à la semaine suivante."}`
    );
  }
};
/* =========================================================
   RESET MOT DE PASSE UTILISATEUR
   ========================================================= */

async function resetUserPassword() {
  setPasswordResetMessage("");

  if (!passwordUserId) {
    setPasswordResetMessage(
      "❌ Sélectionne un utilisateur."
    );
    return;
  }

  if (!temporaryPassword || temporaryPassword.length < 8) {
    setPasswordResetMessage(
      "❌ Le mot de passe temporaire doit contenir au moins 8 caractères."
    );
    return;
  }

  const targetUser = passwordUsers.find(
    (player) => player.id === passwordUserId
  );

  const targetName =
    targetUser?.real_name ||
    targetUser?.display_name ||
    targetUser?.email ||
    "cet utilisateur";

  const confirmed = window.confirm(
    `Réinitialiser le mot de passe de ${targetName} ?\n\n` +
      `Il devra obligatoirement créer un nouveau mot de passe après sa connexion.`
  );

  if (!confirmed) {
    return;
  }

  try {
    setPasswordResetLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error(
        "Session administrateur introuvable."
      );
    }

    const response = await fetch(
      "/api/admin/reset-password",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },

        body: JSON.stringify({
          userId: passwordUserId,
          temporaryPassword,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result?.error ||
          "Impossible de réinitialiser le mot de passe."
      );
    }

    setPasswordUsers((current) =>
      current.map((player) =>
        player.id === passwordUserId
          ? {
              ...player,
              must_change_password: true,
            }
          : player
      )
    );

    setPasswordResetMessage(
      `✅ Mot de passe temporaire activé pour ${targetName}.`
    );

    /*
     * On vide volontairement le champ.
     * Le mot de passe temporaire n'est jamais conservé
     * dans l'interface.
     */
    setTemporaryPassword("");
  } catch (error) {
    console.error(
      "Erreur reset mot de passe :",
      error
    );

    setPasswordResetMessage(
      `❌ ${
        error?.message ||
        "Impossible de réinitialiser le mot de passe."
      }`
    );
  } finally {
    setPasswordResetLoading(false);
  }
}
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
    <main
      className="page"
      style={{
        maxWidth: isDesktop ? 1280 : undefined,

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

      {/* =====================================================
          MESSAGE ADMIN
          ===================================================== */}

      {message && (
        <section
          className="card"
          style={
            isDesktop
              ? {
                  marginBottom: 18,
                }
              : undefined
          }
        >
          <p style={{ margin: 0 }}>
            {message}
          </p>
        </section>
      )}

      {/* =====================================================
          ACTIONS ADMIN
          Desktop : 2 colonnes
          Mobile : affichage actuel empilé
          ===================================================== */}

      <div
        style={{
          display: isDesktop
            ? "grid"
            : "block",

          gridTemplateColumns: isDesktop
            ? "repeat(2, minmax(0, 1fr))"
            : undefined,

          gap: isDesktop
            ? 18
            : undefined,

          marginBottom: isDesktop
            ? 18
            : undefined,
        }}
      >
        {/* ===================================================
            MISE À JOUR ESPN
            =================================================== */}

        <section
          className="card"
          style={
            isDesktop
              ? {
                  margin: 0,
                  minHeight: 245,
                  padding: "24px 26px",

                  display: "flex",
                  flexDirection: "column",
                }
              : undefined
          }
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background:
                      "rgba(59,130,246,0.12)",

                    border:
                      "1px solid rgba(59,130,246,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🔄
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                }}
              >
                Mise à jour complète
              </h2>
            </div>

            <p
              style={{
                color: "#94a3b8",
                marginTop: isDesktop
                  ? 15
                  : undefined,

                lineHeight: 1.55,
              }}
            >
              Met à jour les scores ESPN,
              les fiches des équipes, les
              passer ratings QB et les
              classements pour la semaine
              active.
            </p>

            {isDesktop && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 7,
                  marginTop: 14,
                }}
              >
                {[
                  "Scores ESPN",
                  "Équipes NFL",
                  "QB Ratings",
                  "Classements",
                ].map((item) => (
                  <span
                    key={item}
                    style={{
                      padding: "6px 9px",

                      borderRadius: 9,

                      background:
                        "rgba(148,163,184,0.07)",

                      border:
                        "1px solid rgba(148,163,184,0.12)",

                      color: "#94a3b8",

                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: isDesktop
                ? "auto"
                : undefined,

              paddingTop: isDesktop
                ? 22
                : undefined,
            }}
          >
            <button
              className="button"
              onClick={fullUpdate}
              style={
                isDesktop
                  ? {
                      width: "100%",
                    }
                  : undefined
              }
            >
              Mettre à jour ESPN +
              classements
            </button>
          </div>
        </section>

        {/* ===================================================
            SEMAINE ACTIVE
            =================================================== */}

        <section
          className="card"
          style={
            isDesktop
              ? {
                  margin: 0,
                  minHeight: 245,
                  padding: "24px 26px",

                  display: "flex",
                  flexDirection: "column",
                }
              : undefined
          }
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background:
                      "rgba(168,85,247,0.12)",

                    border:
                      "1px solid rgba(168,85,247,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  📅
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                }}
              >
                Semaine active
              </h2>
            </div>

            {isDesktop ? (
              <>
                <div
                  style={{
                    marginTop: 17,

                    padding: "13px 16px",

                    borderRadius: 14,

                    background:
                      "rgba(148,163,184,0.06)",

                    border:
                      "1px solid rgba(148,163,184,0.12)",

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Semaine actuelle
                  </span>

                  <strong
                    style={{
                      color: "#f8fafc",
                      fontSize: 21,
                      lineHeight: 1,
                    }}
                  >
                    Semaine{" "}
                    {settings?.current_week ||
                      "..."}
                  </strong>
                </div>

                <p
                  style={{
                    color: "#94a3b8",
                    margin: "13px 0 0",
                    lineHeight: 1.45,
                    fontSize: 12,
                  }}
                >
                  À utiliser quand la semaine
                  est terminée et validée.
                </p>
              </>
            ) : (
              <p
                style={{
                  color: "#94a3b8",
                }}
              >
                À utiliser quand la semaine
                est terminée et validée.
              </p>
            )}
          </div>

          <div
            style={{
              marginTop: isDesktop
                ? "auto"
                : undefined,

              paddingTop: isDesktop
                ? 18
                : undefined,
            }}
          >
            <button
              className="button-secondary"
              onClick={nextWeek}
              style={
                isDesktop
                  ? {
                      width: "100%",
                    }
                  : undefined
              }
            >
              Passer à la semaine suivante
            </button>
          </div>
        </section>
      </div>
      {/* =====================================================
          RÉINITIALISATION MOT DE PASSE
          ===================================================== */}

      <section
        className="card"
        style={
          isDesktop
            ? {
                padding: "22px 26px",
                marginTop: 0,
                marginBottom: 18,
              }
            : undefined
        }
      >
        <div
          style={{
            display: isDesktop ? "flex" : "block",
            alignItems: isDesktop ? "flex-start" : undefined,
            justifyContent: isDesktop ? "space-between" : undefined,
            gap: isDesktop ? 30 : undefined,
          }}
        >
          {/* =================================================
              TITRE
              ================================================= */}

          <div
            style={{
              flex: isDesktop ? "0 0 300px" : undefined,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🔐
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                  color: "#f8fafc",
                }}
              >
                Réinitialiser un mot de passe
              </h2>
            </div>

            <p
              style={{
                color: "#94a3b8",
                margin: "12px 0 0",
                lineHeight: 1.5,
                fontSize: 12,
              }}
            >
              Attribue un mot de passe temporaire à un joueur.
              À sa prochaine connexion, il devra obligatoirement
              choisir son nouveau mot de passe.
            </p>
          </div>

          {/* =================================================
              FORMULAIRE
              ================================================= */}

          <div
            style={{
              flex: isDesktop ? "1 1 auto" : undefined,
              marginTop: isDesktop ? 0 : 18,

              display: "grid",

              gridTemplateColumns: isDesktop
                ? "minmax(220px, 1fr) minmax(220px, 1fr) auto"
                : "1fr",

              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Joueur
              </div>

              <select
                value={passwordUserId}
                onChange={(event) => {
                  setPasswordUserId(event.target.value);
                  setPasswordResetMessage("");
                }}
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "0 12px",

                  borderRadius: 11,

                  background: "#0f172a",
                  border: "1px solid rgba(148,163,184,0.18)",

                  color: "#f8fafc",
                  fontWeight: 700,
                }}
              >
                <option value="">
                  Sélectionner un joueur
                </option>

                {passwordUsers.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                  >
                    {playerRealName(player)}
                    {player.must_change_password
                      ? " — changement en attente"
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Mot de passe temporaire
              </div>

              <input
                type="text"
                value={temporaryPassword}
                onChange={(event) => {
                  setTemporaryPassword(event.target.value);
                  setPasswordResetMessage("");
                }}
                placeholder="Minimum 8 caractères"
                autoComplete="off"
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "0 12px",

                  boxSizing: "border-box",
                  borderRadius: 11,

                  background: "#0f172a",
                  border: "1px solid rgba(148,163,184,0.18)",

                  color: "#f8fafc",
                  fontWeight: 700,
                }}
              />
            </div>

            <button
              className="button-secondary"
              onClick={resetUserPassword}
              disabled={passwordResetLoading}
              style={{
                minHeight: 44,
                whiteSpace: "nowrap",
                opacity: passwordResetLoading ? 0.65 : 1,
              }}
            >
              {passwordResetLoading
                ? "Réinitialisation..."
                : "Créer le temporaire"}
            </button>
          </div>
        </div>

        {passwordResetMessage && (
          <div
            style={{
              marginTop: 15,
              padding: "11px 13px",

              borderRadius: 11,

              background: passwordResetMessage.startsWith("✅")
                ? "rgba(34,197,94,0.08)"
                : "rgba(239,68,68,0.08)",

              border: passwordResetMessage.startsWith("✅")
                ? "1px solid rgba(34,197,94,0.20)"
                : "1px solid rgba(239,68,68,0.20)",

              color: passwordResetMessage.startsWith("✅")
                ? "#86efac"
                : "#fca5a5",

              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {passwordResetMessage}
          </div>
        )}
      </section>

   
      {/* =====================================================
          TEMPS DE SÉLECTION
          ===================================================== */}

      <section
        className="card"
        style={
          isDesktop
            ? {
                padding: "22px 26px",
                marginTop: 0,
              }
            : undefined
        }
      >
        <div
          style={{
            marginBottom: 18,

            display: isDesktop
              ? "flex"
              : "block",

            alignItems: isDesktop
              ? "flex-end"
              : undefined,

            justifyContent: isDesktop
              ? "space-between"
              : undefined,

            gap: isDesktop
              ? 20
              : undefined,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                color: "#f8fafc",
              }}
            >
              ⏱️ Temps de sélection
            </h2>

            {isDesktop && (
              <p
                style={{
                  margin: "5px 0 0",
                  color: "#64748b",
                  fontSize: 11,
                }}
              >
                Classement selon le temps
                moyen de sélection QB.
              </p>
            )}
          </div>

          {isDesktop &&
            selectionStats.length > 0 && (
              <span
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {
                  selectionStats.length
                }{" "}
                joueurs
              </span>
            )}
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
          /* =================================================
             MOBILE — INCHANGÉ
             ================================================= */

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

                          fontWeight:
                            900,

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

                          fontWeight:
                            900,

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

                          fontWeight:
                            800,

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

                        borderRadius:
                          11,

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

                          fontWeight:
                            900,
                        }}
                      >
                        CETTE SEM.
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

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

                        borderRadius:
                          11,

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

                          fontWeight:
                            900,
                        }}
                      >
                        + RAPIDE
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

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

                        borderRadius:
                          11,

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

                          fontWeight:
                            900,
                        }}
                      >
                        + LONG
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

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
          /* =================================================
             DESKTOP / TABLETTE — TABLEAU
             ================================================= */

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
              {/* =============================================
                  ENTÊTE TABLEAU
                  ============================================= */}

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

              {/* =============================================
                  JOUEURS
                  ============================================= */}

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
                        isDesktop
                          ? "12px 12px"
                          : "13px 12px",

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

                          fontWeight:
                            900,
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

                        fontWeight:
                          900,
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

                        fontWeight:
                          800,
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

                        fontWeight:
                          700,
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

                        fontWeight:
                          700,
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

                        fontWeight:
                          800,
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
