import {
  createClient,
} from "@supabase/supabase-js";

import {
  sendPushToUser,
} from "../../../../lib/pushNotifications";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const supabaseUrl =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY;

const cronSecret =
  process.env
    .CRON_SECRET;

const supabaseAdmin =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession:
          false,
      },
    }
  );

/*
 * =========================================================
 * FORMAT DU RANG
 * =========================================================
 */

function formatRank(rank) {
  if (rank === 1) {
    return "1er";
  }

  return `${rank}e`;
}

/*
 * =========================================================
 * CONTENU NOTIFICATION CLASSEMENT
 * =========================================================
 */

async function getRankingNotification(
  event
) {
  const {
    data: weeklyScores,
    error: scoresError,
  } = await supabaseAdmin
    .from("weekly_scores")
    .select(
      `
        user_id,
        final_score
      `
    )
    .eq(
      "week",
      event.week
    );

  if (scoresError) {
    throw scoresError;
  }

  if (
    !weeklyScores ||
    weeklyScores.length === 0
  ) {
    throw new Error(
      `Aucun classement pour la semaine ${event.week}.`
    );
  }

  /*
   * =====================================================
   * TRI DU CLASSEMENT
   * =====================================================
   */

  const standings =
    [...weeklyScores]
      .map((row) => ({
        ...row,

        final_score:
          Number(
            row.final_score ||
              0
          ),
      }))
      .sort(
        (a, b) =>
          b.final_score -
          a.final_score
      );

  const playerIndex =
    standings.findIndex(
      (row) =>
        row.user_id ===
        event.user_id
    );

  if (playerIndex === -1) {
    throw new Error(
      "Joueur absent du classement."
    );
  }

  const playerStanding =
    standings[playerIndex];

  const rank =
    playerIndex + 1;

  const score =
    playerStanding.final_score;

  const rankText =
    formatRank(rank);

  const scoreText =
    score.toFixed(3);

  return {
    title:
      "🏆 Classements mis à jour",

    body:
      `Après les derniers matchs, tu es ${rankText} cette semaine avec ${scoreText} pts.`,

    url:
      "/classements",
  };
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
     * =========================================================
     * SÉCURITÉ
     * =========================================================
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
          status:
            401,
        }
      );
    }

    /*
     * =========================================================
     * HEURE ACTUELLE
     * =========================================================
     */

    const now =
      new Date().toISOString();

    /*
     * =========================================================
     * NOTIFICATIONS ARRIVÉES À ÉCHÉANCE
     * =========================================================
     */

    const {
      data: events,
      error: eventsError,
    } = await supabaseAdmin
      .from(
        "push_notification_events"
      )
      .select(
        `
          id,
          event_key,
          user_id,
          notification_type,
          week,
          scheduled_for,
          sent_at,
          status
        `
      )
      .eq(
        "status",
        "pending"
      )
      .is(
        "sent_at",
        null
      )
      .not(
        "scheduled_for",
        "is",
        null
      )
      .lte(
        "scheduled_for",
        now
      )
      .order(
        "scheduled_for",
        {
          ascending:
            true,
        }
      );

    if (eventsError) {
      throw eventsError;
    }

    /*
     * =========================================================
     * RIEN À ENVOYER
     * =========================================================
     */

    if (
      !events ||
      events.length === 0
    ) {
      return Response.json({
        success:
          true,

        processed:
          0,

        sent:
          0,

        message:
          "Aucune notification programmée à envoyer.",
      });
    }

    /*
     * =========================================================
     * TRAITEMENT
     * =========================================================
     */

    let sentCount =
      0;

    let noSubscriptionCount =
      0;

    let failedCount =
      0;

    const results =
      [];

    for (const event of events) {
      try {
        /*
         * =====================================================
         * CONTENU SELON LE TYPE
         * =====================================================
         */

        let title =
          "Pool NFL 🏈";

        let body =
          "Nouvelle notification";

        let url =
          "/";

        /*
         * =====================================================
         * TOUR DE SÉLECTION QB
         * =====================================================
         */

        if (
          event.notification_type ===
          "qb_turn"
        ) {
          title =
            "⏰ C’est à ton tour";

          body =
            `Tu peux maintenant soumettre ton QB et tes choix pour la semaine ${event.week}.`;

          url =
            "/mes-choix";
        }

        /*
         * =====================================================
         * CLASSEMENT
         * =====================================================
         */

        if (
          event.notification_type ===
          "rankings_updated"
        ) {
          const rankingNotification =
            await getRankingNotification(
              event
            );

          title =
            rankingNotification.title;

          body =
            rankingNotification.body;

          url =
            rankingNotification.url;
        }

        /*
         * =====================================================
         * ENVOI PUSH
         * =====================================================
         */

        const pushResult =
          await sendPushToUser({
            userId:
              event.user_id,

            title,

            body,

            url,
          });

        /*
         * =====================================================
         * NOTIFICATION ENVOYÉE
         * =====================================================
         */

        if (
          pushResult.sent > 0
        ) {
          const sentAt =
            new Date()
              .toISOString();

          const {
            error: updateError,
          } = await supabaseAdmin
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

          sentCount++;

          results.push({
            id:
              event.id,

            eventKey:
              event.event_key,

            type:
              event.notification_type,

            status:
              "sent",

            devices:
              pushResult.sent,
          });

          continue;
        }

        /*
         * =====================================================
         * AUCUN ABONNEMENT PUSH
         * =====================================================
         */

        const {
          error:
            noSubscriptionError,
        } = await supabaseAdmin
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

        if (
          noSubscriptionError
        ) {
          throw noSubscriptionError;
        }

        noSubscriptionCount++;

        results.push({
          id:
            event.id,

          eventKey:
            event.event_key,

          type:
            event.notification_type,

          status:
            "no_subscription",
        });
      } catch (eventError) {
        console.error(
          "Erreur notification programmée :",
          event.id,
          eventError
        );

        failedCount++;

        /*
         * On laisse pending pour permettre
         * un nouvel essai ultérieur.
         */

        results.push({
          id:
            event.id,

          eventKey:
            event.event_key,

          type:
            event.notification_type,

          status:
            "failed",

          error:
            eventError?.message ||
            "Erreur inconnue",
        });
      }
    }

    /*
     * =========================================================
     * RÉPONSE
     * =========================================================
     */

    return Response.json({
      success:
        true,

      processed:
        events.length,

      sent:
        sentCount,

      noSubscription:
        noSubscriptionCount,

      failed:
        failedCount,

      results,
    });
  } catch (error) {
    console.error(
      "Erreur route notifications programmées :",
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          "Erreur inconnue",
      },
      {
        status:
          500,
      }
    );
  }
}
