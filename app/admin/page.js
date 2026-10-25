"use client";
import {selectionSnapshot} from "../../lib/seasons/qbSnapshot.mjs";
import {initialOrder,regularClient} from "../../lib/seasons/regularClient.mjs";
const supabase=regularClient(rawSupabase);

import { useEffect, useRef, useState } from "react";
import { supabase as rawSupabase } from "../../lib/supabase";
import {loadSelectionStats as readSelectionStats,formatDuration} from "../../lib/seasons/selectionTime.mjs";
import NotificationLog from "./components/NotificationLog";
import FullUpdateStatus from "./components/FullUpdateStatus";
import BottomNav from "../components/BottomNav";
import SeasonLifecycle from "./components/SeasonLifecycle";
import LifecycleActions from "./components/LifecycleActions";
import previewStyles from "./previewNavigation.module.css";
import { fetchEspnStandings } from "../../lib/espnStandings.mjs";
import { regularGameResult } from "../../lib/seasons/regularResults.mjs";

// ESPN sometimes returns postponed/cancelled competitions in the post state.
// A final result requires all three independent provider signals.
function espnCompetitionState(summary) {
  const type = summary?.header?.competitions?.[0]?.status?.type;
  if (type?.state === "pre" || type?.state === "in") return "pending";
  const terminal = /^STATUS_FINAL(?:_OVERTIME|_OT|_\d+OT)?$/.test(String(type?.name || ""));
  return type?.state === "post" && type?.completed === true && terminal ? "final" : "unconfirmed";
}

/* =========================================================
   ORDRE OFFICIEL QB — SEMAINE 1
   ========================================================= */



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

/* =========================================================
   PAGE
   ========================================================= */

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");
  const [fullUpdateStatus, setFullUpdateStatus] = useState(null);
  const fullUpdateRunning = useRef(false);
  const nextWeekRunning = useRef(false);

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

      if(currentUser && admin && settingsData?.phase === "playoffs"){window.location.replace("/admin/playoffs");return;}
      setSettings(settingsData);
      if(settingsData?.phase==='offseason')return;

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

      const rows = await readSelectionStats(supabase, activeWeek);
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
    const { data: games, error: gamesError } = await supabase
      .from("games").select("*").eq("week", currentWeek);
    if (gamesError) throw new Error("Games : " + gamesError.message);

    let updated = 0;
    let pending = 0;
    const changedGames = [];
    const warnings = [];
    for (const game of games || []) {
      const label = `${game.away_team} @ ${game.home_team}`;
      if (!game.external_game_id) {
        warnings.push(`${label} : identifiant ESPN manquant.`);
        continue;
      }
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.external_game_id}`
        );
        if (!response.ok) throw new Error(`ESPN ${response.status}`);
        const summary = await response.json();
        const state = espnCompetitionState(summary);
        if (state === "pending") {
          pending++;
          continue;
        }
        if (state !== "final") throw new Error("statut final ESPN non confirmé");
        const competitors = summary.header?.competitions?.[0]?.competitors || [];
        const home = competitors.find((team) => team.homeAway === "home");
        const away = competitors.find((team) => team.homeAway === "away");
        const hasScore = (value) => value !== null && value !== undefined && String(value).trim() !== "";
        if (!home || !away || !hasScore(home.score) || !hasScore(away.score)) {
          throw new Error("scores finaux ESPN manquants");
        }
        const homeScore = Number(home.score);
        const awayScore = Number(away.score);
        if (regularGameResult({ ...game, home_score: home.score, away_score: away.score, result_status: "final" }).status === "pending") {
          throw new Error("scores finaux ESPN invalides");
        }
        const scoreChanged = game.home_score == null || game.away_score == null ||
          Number(game.home_score) !== homeScore || Number(game.away_score) !== awayScore || game.result_status !== "final";
        const { error } = await supabase.from("games").update({
          home_score: homeScore, away_score: awayScore, result_status: "final",
        }).eq("id", game.id);
        if (error) throw new Error("Enregistrement du score : " + error.message);
        if (game.is_pool_eligible !== true) continue;
        updated++;
        if (scoreChanged) changedGames.push({
          id: game.id, home_team: game.home_team, away_team: game.away_team,
          home_score: homeScore, away_score: awayScore,
        });
      } catch (error) {
        warnings.push(`${label} : ${error?.message || "résultat ESPN indisponible"}.`);
      }
    }
    return { updated, changedGames, pending, warnings };
  }
  /* =========================================================
     CLASSEMENTS / FICHES DES ÉQUIPES NFL
     ========================================================= */

  async function updateTeamStandingsFromEspn() {
    const data = await fetchEspnStandings();

    const foundTeams = [];
    const notMatched = [];

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

        if (stat?.value != null && ["number", "string"].includes(typeof stat.value) && String(stat.value).trim() !== "") {
          return Number(stat.value);
        }
      }

      return null;
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

            if ([wins, losses, ties].some((value) => value === null || !Number.isFinite(value) || value < 0)) {
              notMatched.push(`${team.displayName || team.abbreviation || "Équipe"} (fiche ESPN incomplète)`);
              return;
            }

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
    if (foundTeams.length === 0) notMatched.push("Aucune fiche d’équipe NFL exploitable dans la réponse ESPN");

    for (
      const team of uniqueTeams.values()
    ) {
      try {
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
      } catch (error) {
        notMatched.push(`${team.team_name} (${error?.message || "enregistrement impossible"})`);
      }
    }

    return {
      updated,
      notMatched,
    };
  }

  /* =========================================================
     QB RATINGS ESPN
     ========================================================= */

  async function updateQBRatingsFromEspn(currentWeek) {
    const { data: qbPicks, error: qbPicksError } = await supabase.from("qb_picks")
      .select(`*, qbs (id, name, team, espn_athlete_id)`).eq("week", currentWeek);
    if (qbPicksError) throw new Error("QB picks : " + qbPicksError.message);
    const { data: games, error: gamesError } = await supabase.from("games").select("*").eq("week", currentWeek);
    if (gamesError) throw new Error("Games : " + gamesError.message);
    let updated = 0;
    let pending = 0;
    const notFound = [];
    const warnings = [];
    for (const pick of qbPicks || []) {
      const selectedQB = selectionSnapshot(pick);
      // Legacy identity may have been overwritten in qbs. Preserve recorded results.
      if (!selectedQB) {
        notFound.push(`Sélection QB semaine ${pick.week} : identité historique à confirmer`);
        continue;
      }
      if (!selectedQB.team) {
        notFound.push(selectedQB.name || "QB sans équipe");
        continue;
      }
      const qbTeam = selectedQB.team.toLowerCase();
      const game = (games || []).find((game) =>
        (game.home_team || "").toLowerCase().includes(qbTeam) || (game.away_team || "").toLowerCase().includes(qbTeam)
      );
      if (!game?.external_game_id) {
        if (game?.result_status === "final") notFound.push(`${selectedQB.name} (identifiant ESPN manquant)`);
        else pending++;
        continue;
      }
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.external_game_id}`
        );
        if (!response.ok) throw new Error(`ESPN ${response.status}`);
        const summary = await response.json();
        const state = espnCompetitionState(summary);
        if (state === "pending") { pending++; continue; }
        if (state !== "final") throw new Error("statut final ESPN non confirmé");
        // Missing selected-player values must not become a zero rating via Number(null/"").
        for (const teamBox of summary.boxscore?.players || []) {
          const teamName = teamBox.team?.shortDisplayName || teamBox.team?.displayName || teamBox.team?.name || "";
          if (!teamName.toLowerCase().includes(qbTeam)) continue;
          const passing = teamBox.statistics?.find((category) => category.name === "passing" || category.displayName === "Passing");
          const index = passing?.labels?.findIndex((label) => ["RTG", "RAT", "RATE"].includes(String(label).toUpperCase())) ?? -1;
          if (index < 0) continue;
          const selectedRow = passing?.athletes?.find((row) => String(row.athlete?.id) === String(selectedQB.espn_athlete_id));
          if (selectedRow) {
            const value = selectedRow.stats?.[index];
            if (!["number", "string"].includes(typeof value) || String(value).trim() === "") {
              throw new Error("rating final ESPN manquant");
            }
          }
        }
    const boxscoreTeams =
      summary.boxscore?.players || [];
    let passingAthletes = [];

    /*
     * Chaque élément représente normalement
     * une des deux équipes du match.
     */
    for (const teamBox of boxscoreTeams) {
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
        if (!actualQB.id || !actualQB.name || !Number.isFinite(actualQB.rating)) {
          throw new Error("rating final ESPN invalide");
        }
        if (actualQB?.id && String(actualQB.id) !== String(selectedQB.espn_athlete_id)) {
          const { data: existingActualQB, error: lookupError } = await supabase.from("qbs")
            .select("id").eq("espn_athlete_id", String(actualQB.id)).maybeSingle();
          if (lookupError) {
            warnings.push(`${actualQB.name} : recherche du QB remplaçant impossible (${lookupError.message}).`);
          } else if (!existingActualQB) {
            const { error: insertError } = await supabase.from("qbs").insert({
              name: actualQB.name, team: selectedQB.team, espn_athlete_id: String(actualQB.id), active: true, is_active_starter: false,
            });
            if (insertError) warnings.push(`${actualQB.name} : ajout du QB remplaçant impossible (${insertError.message}).`);
          }
        }
        const { error } = await supabase.from("qb_ratings").upsert({
          qb_id: selectedQB.id, week: currentWeek, passer_rating: actualQB.rating,
          actual_qb_name: actualQB.name, actual_espn_athlete_id: actualQB.id,
        }, { onConflict: "qb_id,week" });
        if (error) throw new Error(error.message);
        updated++;
      } catch (error) {
        notFound.push(`${selectedQB.name} (${error?.message || "résultat ESPN indisponible"})`);
      }
    }
    return { updated, notFound, pending, warnings };
  }
/* =========================================================
   STATS HEBDOMADAIRES DE TOUS LES QB NFL
   ========================================================= */

async function updateAllQBWeeklyStatsFromEspn(currentWeek) {
  // NFL statistics remain independent of pool selections and their historical snapshots.
  const { data: games, error: gamesError } = await supabase.from("games")
    .select("id, external_game_id, home_team, away_team, result_status").eq("week", currentWeek);
  if (gamesError) throw new Error("Games pour stats QB : " + gamesError.message);
  let updated = 0;
  let pending = 0;
  const notFound = [];
  for (const game of games || []) {
    const label = `${game.away_team} @ ${game.home_team}`;
    if (!game.external_game_id) {
      if (game.result_status === "final") notFound.push(`${label} (identifiant ESPN manquant)`);
      else pending++;
      continue;
    }
    try {
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.external_game_id}`
      );
      if (!response.ok) throw new Error(`ESPN ${response.status}`);
      const summary = await response.json();
      const state = espnCompetitionState(summary);
      if (state === "pending") { pending++; continue; }
      if (state !== "final") throw new Error("statut final ESPN non confirmé");
      const boxscoreTeams = summary.boxscore?.players;
      if (!Array.isArray(boxscoreTeams) || boxscoreTeams.length === 0) throw new Error("statistiques de passes finales manquantes");
      if (boxscoreTeams.length < 2) notFound.push(`${label} (statistiques finales d’une équipe manquantes)`);
      for (const teamBox of boxscoreTeams) {
        const teamName = teamBox.team?.shortDisplayName || teamBox.team?.displayName || teamBox.team?.name || "";
        const espnAbbr = teamBox.team?.abbreviation || "";
        const passing = teamBox.statistics?.find((category) => category.name === "passing" || category.displayName === "Passing");
        const ratingIndex = passing?.labels?.findIndex((label) => ["RTG", "RAT", "RATE"].includes(String(label).toUpperCase())) ?? -1;
        if (ratingIndex === -1 || !passing?.athletes?.length) {
          notFound.push(`${teamName || label} (statistiques de passes finales manquantes)`);
          continue;
        }
        let localTeamName = teamName || null;
        if (espnAbbr) {
          const { data: localTeam, error: localTeamError } = await supabase.from("teams").select("name")
            .ilike("espn_abbr", espnAbbr === "WSH" ? "WAS" : espnAbbr).maybeSingle();
          if (localTeamError) notFound.push(`${teamName || espnAbbr} (association équipe : ${localTeamError.message})`);
          else if (!localTeam?.name) notFound.push(`${teamName || espnAbbr} (équipe non associée)`);
          if (localTeam?.name) localTeamName = localTeam.name;
        } else if (!localTeamName) {
          notFound.push(`${label} (équipe ESPN manquante)`);
        }
        for (const row of passing.athletes) {
          const athleteId = row.athlete?.id;
          const athleteName = row.athlete?.displayName;
          const rawRating = row.stats?.[ratingIndex];
          const rating = !["number", "string"].includes(typeof rawRating) || String(rawRating).trim() === "" ? NaN : Number(rawRating);
          if (!athleteId || !athleteName || !Number.isFinite(rating)) {
            notFound.push(`${athleteName || teamName || label} (rating final ESPN invalide)`);
            continue;
          }
          const { error } = await supabase.from("qb_weekly_stats").upsert({
            week: Number(currentWeek), espn_athlete_id: String(athleteId), qb_name: athleteName,
            team: localTeamName, passer_rating: rating, updated_at: new Date().toISOString(),
          }, { onConflict: "week,espn_athlete_id" });
          if (error) notFound.push(`${athleteName} (${error.message})`);
          else updated++;
        }
      }
    } catch (error) {
      notFound.push(`${label} (${error?.message || "résultat ESPN indisponible"})`);
    }
  }
  return { updated, notFound, pending };
}

  /* =========================================================
     CALCUL DES SCORES DU POOL
     ========================================================= */

  async function calculateScores(currentWeek, currentSettings = settings) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Session : " + error.message);
    if (!data?.session?.access_token) throw new Error("Session expirée. Reconnecte-toi avant de publier les classements.");
    const response = await fetch("/api/admin/regular-week-results", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ season: currentSettings.current_season, week: currentWeek, revision: currentSettings.revision }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("La publication des classements n’a pas pu être confirmée."); }
    if (!response.ok) throw new Error(result?.error || `Publication des classements impossible (${response.status}).`);
    return result;
  }
  /* =========================================================
     MISE À JOUR COMPLÈTE
     ========================================================= */

  const fullUpdate = async () => {
    if (fullUpdateRunning.current) return;
    fullUpdateRunning.current = true;
    let activeStep = null;
    let hasIssues = false;
    let hasAchievedResults = false;
    const startStep = (step) => {
      activeStep = step;
      setFullUpdateStatus((state) => ({ ...state, activeStep: step }));
    };
    const completeStep = (step, report, labels = {}) => {
      const warnings = [...(report?.warnings || []), ...(report?.errors || [])];
      if (report?.notMatched?.length) warnings.push(`${labels.notMatched || "Équipes non associées"} : ${report.notMatched.join(", ")}`);
      if (report?.notFound?.length) warnings.push(`${labels.notFound || "QB non trouvés"} : ${report.notFound.join(", ")}`);
      const partial = warnings.length > 0 || report?.partial === true;
      hasIssues = hasIssues || partial;
      hasAchievedResults = hasAchievedResults || Number(report?.updated) > 0;
      activeStep = null;
      setFullUpdateStatus((state) => ({
        ...state, activeStep: null,
        completed: { ...state.completed, [step]: report?.updated },
        stepStates: { ...state.stepStates, [step]: { status: partial ? "partial" : "success", warnings, pending: report?.pending || 0 } },
        warnings: [...state.warnings, ...warnings],
      }));
    };
    setMessage("");
    setFullUpdateStatus({
      status: "running", week: settings?.current_week ?? null,
      activeStep: null, completed: {}, stepStates: {}, details: {}, warnings: [], error: null,
    });
    try {
      const currentSettings = await loadSettings();
      const currentWeek = currentSettings.current_week;
      setFullUpdateStatus((state) => ({ ...state, week: currentWeek }));
      startStep("scores");
      const scoresResult = await updateScoresFromEspn(currentWeek);
      completeStep("scores", scoresResult);
      startStep("teams");
      const standingsResult = await updateTeamStandingsFromEspn();
      completeStep("teams", standingsResult);
      startStep("qb");
      const qbResult = await updateQBRatingsFromEspn(currentWeek);
      // Retain the pool rating count even if the independent NFL stats request fails.
      completeStep("qb", qbResult);
      startStep("qb");
      const allQbStatsResult = await updateAllQBWeeklyStatsFromEspn(currentWeek);
      const qbWarnings = [...(allQbStatsResult.warnings || []), ...(allQbStatsResult.errors || [])];
      if (allQbStatsResult.notFound?.length) qbWarnings.push("Stats QB NFL non trouvées : " + allQbStatsResult.notFound.join(", "));
      if (qbWarnings.length > 0) hasIssues = true;
      hasAchievedResults = hasAchievedResults || Number(allQbStatsResult.updated) > 0;
      setFullUpdateStatus((state) => ({
        ...state,
        stepStates: { ...state.stepStates, qb: {
          ...state.stepStates.qb,
          status: state.stepStates.qb?.status === "partial" || qbWarnings.length ? "partial" : "success",
          warnings: [...(state.stepStates.qb?.warnings || []), ...qbWarnings],
          pending: (state.stepStates.qb?.pending || 0) + (allQbStatsResult.pending || 0),
        } },
        warnings: [...state.warnings, ...qbWarnings],
        details: { ...state.details, qbStats: allQbStatsResult.updated },
      }));
      startStep("rankings");
      // The server publishes the score snapshot, then recovers queued notifications.
      const rankingsResult = await calculateScores(currentWeek, currentSettings);
      const notifications = rankingsResult.notifications || {};
      const notificationWarnings = Number(notifications.failed) > 0
        ? [`${notifications.failed} notification(s) de classement n’ont pas pu être envoyées.`] : [];
      completeStep("rankings", { ...rankingsResult, warnings: [...(rankingsResult.warnings || []), ...notificationWarnings] });
      const notificationNote = Number(notifications.scheduled) > 0
        ? `${notifications.scheduled} notification(s) de classement programmée(s).`
        : rankingsResult.publication?.baseline
          ? "Référence des classements enregistrée."
          : !rankingsResult.publication?.changed
            ? "Aucun nouveau classement à notifier." : null;
      setFullUpdateStatus((state) => ({
        ...state, details: { ...state.details,
          notifications: typeof notifications.sent === "number" ? notifications.sent : null, notificationNote,
        },
      }));
      await loadSelectionStats(Number(currentWeek));
      setFullUpdateStatus((state) => ({ ...state, status: hasIssues ? (hasAchievedResults ? "partial" : "error") : "success", activeStep: null }));
    } catch (error) {
      const message = error?.message || "La mise à jour a été interrompue.";
      setFullUpdateStatus((state) => ({
        ...state, status: hasAchievedResults ? "partial" : "error", activeStep: null,
        stepStates: activeStep ? { ...state.stepStates, [activeStep]: { ...state.stepStates[activeStep], status: "error", errors: [message] } } : state.stepStates,
        error: { step: activeStep, message },
      }));
    } finally {
      fullUpdateRunning.current = false;
    }
  };
 /* =========================================================
   SEMAINE SUIVANTE
   ========================================================= */

const nextWeek = async () => {
  if (nextWeekRunning.current) return;
  const displayedSettings = settings;
  const confirmed = window.confirm(
    "Passer à la semaine suivante ?\n\n" +
      "Cette action ouvrira officiellement la prochaine semaine du pool."
  );
  if (!confirmed) return;
  nextWeekRunning.current = true;
  setMessage("");
  let committedWeek = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Session : " + error.message);
    const token = data?.session?.access_token;
    if (!token) throw new Error("Session expirée. Reconnecte-toi avant de passer à la semaine suivante.");
    const response = await fetch("/api/admin/regular-next-week", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ season: displayedSettings.current_season, week: displayedSettings.current_week, revision: displayedSettings.revision, confirm: true }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("Le passage à la semaine suivante n’a pas pu être confirmé. Recharge la page avant de réessayer."); }
    if (!response.ok) throw new Error(result?.error || `Impossible de passer à la semaine suivante (${response.status}).`);
    const newWeek = Number(result.week ?? result.current_week ?? result.settings?.current_week ?? Number(displayedSettings.current_week) + 1);
    committedWeek = newWeek;
    // Notify only after the server has committed the new week and its opening time.
    let notificationWarning = "";
    try {
      const notificationResponse = await fetch("/api/push/first-player", {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      if (!notificationResponse.ok) notificationWarning = " L’envoi de la notification au premier joueur n’a pas été confirmé.";
    } catch {
      notificationWarning = " L’envoi de la notification au premier joueur n’a pas été confirmé.";
    }
    await loadSettings();
    await loadSelectionStats(newWeek);
    setMessage(`Semaine ${newWeek} ouverte avec succès ✅${notificationWarning}`);
  } catch (error) {
    setMessage(committedWeek !== null
      ? `Semaine ${committedWeek} ouverte. L’actualisation de l’affichage est incomplète. Recharge la page avant de poursuivre.`
      : `Erreur : ${error?.message || "Impossible de passer à la semaine suivante."}`);
  } finally {
    nextWeekRunning.current = false;
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

  if(!settings) return <main className="page"><p role="status">Chargement du contexte…</p></main>;

  /* =========================================================
   PAGE ADMIN
   ========================================================= */

  if(settings?.phase==='offseason')return <main className="page"><section className="header-card"><h1>Admin · Intersaison</h1></section><SeasonLifecycle/></main>;

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
        className={`header-card ${previewStyles.hero}`}
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
        <a href="/series" className={previewStyles.previewButton}>👁 Prévisualiser le mode Séries</a>

        <p>
          Saison{" "}
          {settings?.current_season ||
            "..."}{" "}
          — semaine{" "}
          {settings?.current_week ||
            "..."}
        </p>
      </section>


      <FullUpdateStatus state={fullUpdateStatus} />

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
              disabled={fullUpdateStatus?.status === "running"}
              aria-busy={fullUpdateStatus?.status === "running"}
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

      <NotificationLog scope="regular" />
      <LifecycleActions />
      <BottomNav />
    </main>
  );
}
