import {
  createClient,
} from "@supabase/supabase-js";

import {
  sendPushToUser,
} from "../../../../lib/pushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const cronSecret =
  process.env.CRON_SECRET;

const supabaseAdmin =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
      },
    }
  );

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function normalizeTeam(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamsMatch(
  gameTeam,
  qbTeam
) {
  const a =
    normalizeTeam(gameTeam);

  const b =
    normalizeTeam(qbTeam);

  if (!a || !b) {
    return false;
  }

  return (
    a === b ||
    a.includes(b) ||
    b.includes(a)
  );
}

function isGameFinal(summary) {
  const competition =
    summary?.header
      ?.competitions?.[0];

  const status =
    competition?.status ||
    summary?.header?.status;

  const state =
    String(
      status?.type?.state ||
        ""
    ).toLowerCase();

  const name =
    String(
      status?.type?.name ||
        ""
    ).toLowerCase();

  const completed =
    status?.type?.completed ===
    true;

  return (
    completed ||
    state === "post" ||
    name.includes("final")
  );
}

function getOpponent(
  game,
  qbTeam
) {
  if (
    teamsMatch(
      game.home_team,
      qbTeam
    )
  ) {
    return game.away_team;
  }

  if (
    teamsMatch(
      game.away_team,
      qbTeam
    )
  ) {
    return game.home_team;
  }

  return "son adversaire";
}

function getPassingAthletes(
  summary,
  qbTeam
) {
  const boxscoreTeams =
    summary?.boxscore?.players ||
    [];

  const athletes = [];

  for (
    const teamBox of
    boxscoreTeams
  ) {
    const teamNames = [
      teamBox.team
        ?.abbreviation,
      teamBox.team
        ?.shortDisplayName,
      teamBox.team
        ?.displayName,
      teamBox.team?.name,
    ].filter(Boolean);

    const correctTeam =
      teamNames.some(
        (teamName) =>
          teamsMatch(
            teamName,
            qbTeam
          )
      );

    if (!correctTeam) {
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

    for (
      const row of
      passingCategory.athletes ||
      []
    ) {
      const rating =
        Number(
          row.stats?.[
            ratingIndex
          ]
        );

      if (
        Number.isNaN(rating)
      ) {
        continue;
      }

      athletes.push({
        id:
          row.athlete?.id
            ? String(
                row.athlete.id
              )
            : null,

        name:
          row.athlete
            ?.displayName ||
          "QB",

        rating,
      });
    }
  }

  return athletes;
}

/*
 * =========================================================
 * ROUTE CRON
 * =========================================================
 */

export async function GET(
  request
) {
  try {
    /*
     * =====================================================
     * SÉCURITÉ
     * =====================================================
     */

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      !cronSecret ||
      authorization !==
        `Bearer ${cronSecret}`
    ) {
      return Response.json(
        {
          error:
            "Non autorisé",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * =====================================================
     * SEMAINE ACTIVE
     * =====================================================
     */

    const {
      data: settings,
      error: settingsError,
    } =
      await supabaseAdmin
        .from("settings")
        .select(
          "current_week"
        )
        .single();

    if (settingsError) {
      throw settingsError;
    }

    const currentWeek =
      Number(
        settings?.current_week ||
          1
      );

    /*
     * =====================================================
     * QB SÉLECTIONNÉS
     * =====================================================
     */

    const {
      data: qbPicks,
      error: qbPicksError,
    } =
      await supabaseAdmin
        .from("qb_picks")
        .select(`
          id,
          user_id,
          week,
          qb_id,
          qbs (
            id,
            name,
            team,
            espn_athlete_id
          )
        `)
        .eq(
          "week",
          currentWeek
        );

    if (qbPicksError) {
      throw qbPicksError;
    }

    if (
      !qbPicks ||
      qbPicks.length === 0
    ) {
      return Response.json({
        success: true,
        week: currentWeek,
        checked: 0,
        sent: 0,
        message:
          "Aucun QB sélectionné.",
      });
    }

    /*
     * =====================================================
     * MATCHS NFL DE LA SEMAINE
     * =====================================================
     *
     * IMPORTANT :
     * Le match du QB n'a pas besoin d'être admissible
     * au pool.
     * =====================================================
     */

    const {
      data: games,
      error: gamesError,
    } =
      await supabaseAdmin
        .from("games")
        .select(`
          id,
          week,
          home_team,
          away_team,
          external_game_id
        `)
        .eq(
          "week",
          currentWeek
        );

    if (gamesError) {
      throw gamesError;
    }

    let checked = 0;
    let finalGames = 0;
    let sent = 0;
    let alreadyProcessed = 0;
    let notFinal = 0;
    let notFound = 0;
    let noSubscription = 0;

    const results = [];

    /*
     * Évite de demander plusieurs fois
     * le même match à ESPN durant ce cron.
     */
    const summaryCache =
      new Map();

    /*
     * =====================================================
     * TRAITEMENT DES QB
     * =====================================================
     */

    for (
      const pick of qbPicks
    ) {
      const selectedQB =
        pick.qbs;

      if (
        !selectedQB?.id ||
        !selectedQB?.team
      ) {
        notFound++;

        results.push({
          userId:
            pick.user_id,
          status:
            "qb_missing",
        });

        continue;
      }

      checked++;

      /*
       * ===================================================
       * MATCH DU QB
       * ===================================================
       */

      const game =
        (games || []).find(
          (item) =>
            teamsMatch(
              item.home_team,
              selectedQB.team
            ) ||
            teamsMatch(
              item.away_team,
              selectedQB.team
            )
        );

      if (
        !game?.external_game_id
      ) {
        notFound++;

        results.push({
          userId:
            pick.user_id,
          qb:
            selectedQB.name,
          status:
            "game_missing",
        });

        continue;
      }

      /*
       * ===================================================
       * DÉDUPLICATION
       * ===================================================
       */

      const eventKey =
        `qb-final-week-${currentWeek}` +
        `-user-${pick.user_id}`;

      const {
        data: existingEvent,
        error:
          existingEventError,
      } =
        await supabaseAdmin
          .from(
            "push_notification_events"
          )
          .select(
            "id, status, sent_at"
          )
          .eq(
            "event_key",
            eventKey
          )
          .maybeSingle();

      if (
        existingEventError
      ) {
        throw existingEventError;
      }

      /*
       * Si l'événement existe déjà,
       * on ne renvoie jamais le PR.
       */
      if (existingEvent) {
        alreadyProcessed++;

        results.push({
          userId:
            pick.user_id,
          qb:
            selectedQB.name,
          status:
            "already_processed",
        });

        continue;
      }

      /*
       * ===================================================
       * ESPN SUMMARY
       * ===================================================
       */

      let summary =
        summaryCache.get(
          game.external_game_id
        );

      if (!summary) {
        const espnUrl =
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary` +
          `?event=${game.external_game_id}`;

        const response =
          await fetch(
            espnUrl,
            {
              cache:
                "no-store",
            }
          );

        if (
          !response.ok
        ) {
          results.push({
            userId:
              pick.user_id,
            qb:
              selectedQB.name,
            status:
              "espn_error",
            httpStatus:
              response.status,
          });

          continue;
        }

        summary =
          await response.json();

        summaryCache.set(
          game.external_game_id,
          summary
        );
      }

      /*
       * ===================================================
       * MATCH FINAL ?
       * ===================================================
       */

      if (
        !isGameFinal(
          summary
        )
      ) {
        notFinal++;

        results.push({
          userId:
            pick.user_id,
          qb:
            selectedQB.name,
          status:
            "not_final",
        });

        continue;
      }

      finalGames++;

      /*
       * ===================================================
       * PASSER RATING
       * ===================================================
       */

      const passingAthletes =
        getPassingAthletes(
          summary,
          selectedQB.team
        );

      if (
        passingAthletes.length ===
        0
      ) {
        notFound++;

        results.push({
          userId:
            pick.user_id,
          qb:
            selectedQB.name,
          status:
            "passing_stats_missing",
        });

        continue;
      }

      /*
       * PRIORITÉ ABSOLUE :
       * le QB sélectionné lui-même.
       *
       * Donc s'il commence puis se blesse,
       * son propre PR demeure celui utilisé.
       */
      let actualQB = null;

      if (
        selectedQB.espn_athlete_id
      ) {
        actualQB =
          passingAthletes.find(
            (athlete) =>
              String(
                athlete.id
              ) ===
              String(
                selectedQB.espn_athlete_id
              )
          ) || null;
      }

      if (!actualQB) {
        actualQB =
          passingAthletes.find(
            (athlete) =>
              normalizeTeam(
                athlete.name
              ) ===
              normalizeTeam(
                selectedQB.name
              )
          ) || null;
      }

      /*
       * Le QB sélectionné n'apparaît pas
       * dans les stats de passe.
       *
       * On utilise alors le premier passeur
       * de l'équipe comme QB réel/remplaçant,
       * conformément au système existant.
       */
      if (!actualQB) {
        actualQB =
          passingAthletes[0];
      }

      if (
        !actualQB ||
        !Number.isFinite(
          Number(
            actualQB.rating
          )
        )
      ) {
        notFound++;

        results.push({
          userId:
            pick.user_id,
          qb:
            selectedQB.name,
          status:
            "rating_missing",
        });

        continue;
      }

      const passerRating =
        Number(
          actualQB.rating
        );

      /*
       * ===================================================
       * SAUVEGARDER LE PR FINAL
       * ===================================================
       *
       * Ainsi le PR automatique et le PR affiché
       * dans le pool restent synchronisés.
       * ===================================================
       */

      const {
        error: ratingError,
      } =
        await supabaseAdmin
          .from("qb_ratings")
          .upsert(
            {
              qb_id:
                selectedQB.id,

              week:
                currentWeek,

              passer_rating:
                passerRating,

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

      if (ratingError) {
        throw ratingError;
      }

      /*
       * ===================================================
       * ADVERSAIRE
       * ===================================================
       */

      const opponent =
        getOpponent(
          game,
          selectedQB.team
        );

      /*
       * ===================================================
       * CRÉER L'ÉVÉNEMENT AVANT L'ENVOI
       * ===================================================
       *
       * L'event_key unique protège contre
       * les notifications en double.
       * ===================================================
       */

      const {
        data: event,
        error: insertError,
      } =
        await supabaseAdmin
          .from(
            "push_notification_events"
          )
          .insert({
            event_key:
              eventKey,

            user_id:
              pick.user_id,

            notification_type:
              "qb_final",

            week:
              currentWeek,

            status:
              "pending",
          })
          .select(
            "id"
          )
          .single();

      if (insertError) {
        /*
         * Si deux exécutions arrivent exactement
         * en même temps, la contrainte unique
         * sur event_key peut faire échouer
         * la deuxième. C'est voulu.
         */
        console.error(
          "Création événement QB final :",
          insertError.message
        );

        alreadyProcessed++;

        results.push({
          userId:
            pick.user_id,
          qb:
            actualQB.name,
          status:
            "event_already_exists",
        });

        continue;
      }

      /*
       * ===================================================
       * NOTIFICATION
       * ===================================================
       */

      const ratingText =
        passerRating.toFixed(
          1
        );

      const pushResult =
        await sendPushToUser({
          userId:
            pick.user_id,

          title:
            "🏈 Passer Rating final",

          body:
            `${actualQB.name} a conclu son match contre ${opponent} avec un passer rating de ${ratingText}.`,

          url:
            "/qb-ratings",
        });

      /*
       * ===================================================
       * ÉTAT FINAL DE L'ÉVÉNEMENT
       * ===================================================
       */

      if (
        pushResult.sent > 0
      ) {
        const sentAt =
          new Date()
            .toISOString();

        const {
          error: updateError,
        } =
          await supabaseAdmin
            .from(
              "push_notification_events"
            )
            .update({
              status:
                "sent",

              sent_at:
                sentAt,
            })
            .eq(
              "id",
              event.id
            );

        if (updateError) {
          throw updateError;
        }

        sent +=
          pushResult.sent;

        results.push({
          userId:
            pick.user_id,
          qb:
            actualQB.name,
          opponent,
          passerRating,
          status:
            "sent",
          devices:
            pushResult.sent,
        });
      } else {
        const {
          error: updateError,
        } =
          await supabaseAdmin
            .from(
              "push_notification_events"
            )
            .update({
              status:
                "no_subscription",
            })
            .eq(
              "id",
              event.id
            );

        if (updateError) {
          throw updateError;
        }

        noSubscription++;

        results.push({
          userId:
            pick.user_id,
          qb:
            actualQB.name,
          opponent,
          passerRating,
          status:
            "no_subscription",
        });
      }
    }

    /*
     * =====================================================
     * RÉPONSE
     * =====================================================
     */

    return Response.json({
      success:
        true,

      week:
        currentWeek,

      checked,

      finalGames,

      sent,

      alreadyProcessed,

      notFinal,

      notFound,

      noSubscription,

      results,
    });
  } catch (
    error
  ) {
    console.error(
      "Erreur QB final :",
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          "Erreur inconnue",
      },
      {
        status: 500,
      }
    );
  }
}
