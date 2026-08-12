"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();

      const currentUser =
        sessionData.session?.user ?? null;

      setUser(currentUser);

      if (currentUser) {
        const { data: adminData } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();

        setIsAdmin(
          adminData?.is_admin === true
        );
      }

      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      setSettings(settingsData);
    }

    load();
  }, []);

  async function loadSettings() {
    const { data } = await supabase
      .from("settings")
      .select("*")
      .single();

    setSettings(data);

    return data;
  }

  /* =========================================================
     SCORES DES MATCHS ESPN
     ========================================================= */

  async function updateScoresFromEspn(currentWeek) {
    const { data: games, error: gamesError } = await supabase
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
      if (!game.external_game_id) continue;

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

      if (!home || !away) continue;

      const homeScore =
        Number(home.score);

      const awayScore =
        Number(away.score);

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
      "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";

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
            String(item?.name || "")
              .toLowerCase() ===
            String(name).toLowerCase()
        );

        if (stat?.value != null) {
          return Number(stat.value);
        }
      }

      return 0;
    }

    function cleanDivisionName(name) {
      if (!name) return null;

      const value = String(name).trim();

      const normalized =
        value
          .replace(/^American Football Conference\s*-\s*/i, "AFC ")
          .replace(/^National Football Conference\s*-\s*/i, "NFC ")
          .replace(/^AFC\s*-\s*/i, "AFC ")
          .replace(/^NFC\s*-\s*/i, "NFC ");

      return normalized;
    }

    function looksLikeDivision(name) {
      if (!name) return false;

      const value =
        String(name).toLowerCase();

      const hasConference =
        value.includes("afc") ||
        value.includes("nfc") ||
        value.includes("american football conference") ||
        value.includes("national football conference");

      const hasDirection =
        value.includes("east") ||
        value.includes("west") ||
        value.includes("north") ||
        value.includes("south");

      return hasConference && hasDirection;
    }

    function walk(node, inheritedDivision = null) {
      if (!node) return;

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

            if (!team) return;

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

    /*
     * ESPN peut retourner plusieurs
     * conférences directement sous data.children.
     */
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

    /*
     * Évite les doublons si ESPN retourne
     * une équipe à plusieurs niveaux.
     */
    const uniqueTeams =
      new Map();

    foundTeams.forEach((team) => {
      const key =
        team.espn_abbr
          ? team.espn_abbr
              .toLowerCase()
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

    for (const team of uniqueTeams.values()) {
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
        query = query.ilike(
          "espn_abbr",
          team.espn_abbr
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

  async function updateQBRatingsFromEspn(currentWeek) {
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
      const selectedQB =
        pick.qbs;

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
          const home =
            (g.home_team || "")
              .toLowerCase();

          const away =
            (g.away_team || "")
              .toLowerCase();

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

      const response =
        await fetch(url);

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
        passingAthletes.length ===
        0
      ) {
        notFound.push(
          selectedQB.name
        );

        continue;
      }

      /*
       * Par défaut :
       * premier QB qui a réellement
       * obtenu un passer rating.
       */
      let actualQB =
        passingAthletes[0];

      /*
       * Si le QB sélectionné a joué,
       * on utilise son propre rating.
       */
      if (
        selectedQB.espn_athlete_id
      ) {
        const exactMatch =
          passingAthletes.find(
            (athlete) =>
              String(
                athlete.id
              ) ===
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
       * Si ESPN a utilisé un autre QB,
       * on l'ajoute automatiquement
       * à qbs comme remplaçant.
       */
      if (
        actualQB?.id &&
        String(actualQB.id) !==
          String(
            selectedQB.espn_athlete_id
          )
      ) {
        const {
          data:
            existingActualQB,
          error:
            lookupError,
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
            error:
              insertQbError,
          } = await supabase
            .from("qbs")
            .insert({
              name:
                actualQB.name,
              team:
                selectedQB.team,
              espn_athlete_id:
                String(
                  actualQB.id
                ),
              active: true,
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

      const { error } =
        await supabase
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

  async function calculateScores(currentWeek) {
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

    const { data: qbPicks } =
      await supabase
        .from("qb_picks")
        .select("*")
        .eq(
          "week",
          currentWeek
        );

    const { data: qbRatings } =
      await supabase
        .from("qb_ratings")
        .select("*")
        .eq(
          "week",
          currentWeek
        );

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
          (scoresByUser[
            pick.user_id
          ] || 0) +
          points;
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
              qbRating?.passer_rating ||
                0
            );

          const multiplier =
            passerRating > 0
              ? passerRating /
                100
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
                multiplier.toFixed(
                  3
                )
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

    if (
      rows.length === 0
    ) {
      return 0;
    }

    const { error } =
      await supabase
        .from(
          "weekly_scores"
        )
        .upsert(rows, {
          onConflict:
            "user_id,week",
        });

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
       * 2. Fiches / standings équipes
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
          .notMatched.length >
        0
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

      setMessage(
        finalMessage
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

    const currentSettings =
      await loadSettings();

    const newWeek =
      Number(
        currentSettings.current_week ||
          1
      ) + 1;

    const { error } =
      await supabase
        .from("settings")
        .update({
          current_week:
            newWeek,
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

    setMessage(
      `Semaine active changée à ${refreshedSettings.current_week} ✅`
    );
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
            Connecte-toi pour
            accéder à
            l’administration.
          </p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>
            Accès refusé ❌
          </h1>

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
          <p>{message}</p>
        </section>
      )}

      <section className="card">
        <h2>
          Mise à jour complète
        </h2>

        <p
          style={{
            color:
              "#94a3b8",
          }}
        >
          Met à jour les scores
          ESPN, les fiches des
          équipes, les passer
          ratings QB et les
          classements pour la
          semaine active.
        </p>

        <button
          className="button"
          onClick={fullUpdate}
        >
          Mettre à jour ESPN +
          classements
        </button>
      </section>

      <section className="card">
        <h2>
          Semaine active
        </h2>

        <p
          style={{
            color:
              "#94a3b8",
          }}
        >
          À utiliser quand la
          semaine est terminée
          et validée.
        </p>

        <button
          className="button-secondary"
          onClick={nextWeek}
        >
          Passer à la semaine
          suivante
        </button>
      </section>

      <BottomNav />
    </main>
  );
}
