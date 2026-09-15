import {
  createClient,
} from "@supabase/supabase-js";

import {
  sendPushToUser,
} from "../../../../lib/pushNotifications";

export const runtime =
  "nodejs";

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
     *
     * Vercel Cron enverra automatiquement :
     *
     * Authorization: Bearer CRON_SECRET
     *
     * Cette route ne peut donc pas être
     * déclenchée librement par un joueur.
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
     *
     * On prend uniquement :
     *
     * - status = pending
     * - scheduled_for existe
     * - scheduled_for <= maintenant
     * - sent_at est encore vide
     * =========================================================
     */

    const {
      data:
        events,
      error:
        eventsError,
    } =
      await supabaseAdmin
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

    if (
      eventsError
    ) {
      throw eventsError;
    }

    /*
     * =========================================================
     * RIEN À ENVOYER
     * =========================================================
     */

    if (
      !events ||
      events.length ===
        0
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
     * TRAITEMENT DES NOTIFICATIONS
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

    for (
      const event of
      events
    ) {
      try {
        /*
         * =====================================================
         * CONTENU SELON LE TYPE DE NOTIFICATION
         * =====================================================
         */

        let title =
          "Pool NFL 🏈";

        let body =
          "Nouvelle notification";

        let url =
          "/";

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
          pushResult.sent >
          0
        ) {
          const sentAt =
            new Date()
              .toISOString();

          const {
            error:
              updateError,
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

          if (
            updateError
          ) {
            throw updateError;
          }

          sentCount++;

          results.push({
            id:
              event.id,

            eventKey:
              event.event_key,

            status:
              "sent",

            devices:
              pushResult.sent,
          });

          continue;
        }

        /*
         * =====================================================
         * JOUEUR SANS ABONNEMENT PUSH
         * =====================================================
         *
         * Le joueur peut quand même participer normalement.
         * L'absence de l'app ou des notifications
         * ne bloque jamais le pool.
         * =====================================================
         */

        const {
          error:
            noSubscriptionError,
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

          status:
            "no_subscription",
        });
      } catch (
        eventError
      ) {
        console.error(
          "Erreur notification programmée :",
          event.id,
          eventError
        );

        failedCount++;

        /*
         * On laisse status = pending.
         *
         * Ainsi une erreur temporaire
         * pourra être réessayée au prochain
         * passage du cron.
         */

        results.push({
          id:
            event.id,

          eventKey:
            event.event_key,

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
  } catch (
    error
  ) {
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
