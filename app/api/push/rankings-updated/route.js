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

function formatRank(
  rank
) {
  if (rank === 1) {
    return "1er";
  }

  return `${rank}e`;
}

/*
 * =========================================================
 * HEURE D'ENVOI — 8 H 30 QUÉBEC
 * =========================================================
 *
 * Avant 8 h 30 :
 * on programme pour 8 h 30.
 *
 * À partir de 8 h 30 :
 * on envoie immédiatement.
 *
 * Septembre :
 * Québec = UTC-4
 * 8 h 30 = 12 h 30 UTC
 * =========================================================
 */

function getRankingDelivery() {
  const now =
    new Date();

  const today830 =
    new Date(now);

  today830.setUTCHours(
    12,
    30,
    0,
    0
  );

  if (
    now.getTime() <
    today830.getTime()
  ) {
    return {
      sendNow:
        false,

      scheduledFor:
        today830,
    };
  }

  return {
    sendNow:
      true,

    scheduledFor:
      null,
  };
}

/*
 * =========================================================
 * ROUTE
 * =========================================================
 */

export async function POST(
  request
) {
  try {
    /*
     * =====================================================
     * AUTHENTIFICATION
     * =====================================================
     */

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      !authorization ||
      !authorization.startsWith(
        "Bearer "
      )
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

    const accessToken =
      authorization.replace(
        "Bearer ",
        ""
      );

    /*
     * =====================================================
     * UTILISATEUR CONNECTÉ
     * =====================================================
     */

    const {
      data:
        authData,
      error:
        authError,
    } =
      await supabaseAdmin
        .auth
        .getUser(
          accessToken
        );

    if (
      authError ||
      !authData?.user
    ) {
      return Response.json(
        {
          error:
            "Session invalide",
        },
        {
          status:
            401,
        }
      );
    }

    const adminUser =
      authData.user;

    /*
     * =====================================================
     * VÉRIFIER ADMIN
     * =====================================================
     */

    const {
      data:
        adminProfile,
      error:
        adminError,
    } =
      await supabaseAdmin
        .from(
          "users"
        )
        .select(
          "id, is_admin"
        )
        .eq(
          "id",
          adminUser.id
        )
        .single();

    if (
      adminError ||
      !adminProfile
        ?.is_admin
    ) {
      return Response.json(
        {
          error:
            "Accès administrateur requis",
        },
        {
          status:
            403,
        }
      );
    }

    /*
     * =====================================================
     * DONNÉES REÇUES
     * =====================================================
     */

    const body =
      await request.json();

    const week =
      Number(
        body?.week
      );

    const gameLabel =
      String(
        body?.gameLabel ||
        ""
      ).trim();

    if (
      !Number.isInteger(
        week
      ) ||
      week < 1
    ) {
      return Response.json(
        {
          error:
            "Semaine invalide",
        },
        {
          status:
            400,
        }
      );
    }

    /*
     * =====================================================
     * CLASSEMENT HEBDOMADAIRE
     * =====================================================
     */

    const {
      data:
        weeklyScores,
      error:
        scoresError,
    } =
      await supabaseAdmin
        .from(
          "weekly_scores"
        )
        .select(
          `
            user_id,
            week,
            final_score
          `
        )
        .eq(
          "week",
          week
        );

    if (
      scoresError
    ) {
      throw scoresError;
    }

    if (
      !weeklyScores ||
      weeklyScores.length ===
        0
    ) {
      return Response.json({
        success:
          true,

        week,

        scheduled:
          0,

        sent:
          0,

        message:
          "Aucun classement hebdomadaire à notifier.",
      });
    }

    /*
     * =====================================================
     * TRI DU CLASSEMENT
     * =====================================================
     */

    const standings =
      [...weeklyScores]
        .map(
          (row) => ({
            ...row,

            final_score:
              Number(
                row.final_score ||
                  0
              ),
          })
        )
        .sort(
          (a, b) =>
            b.final_score -
            a.final_score
        );

    /*
     * =====================================================
     * HEURE D'ENVOI
     * =====================================================
     */

    const {
      sendNow,
      scheduledFor,
    } =
      getRankingDelivery();

    const updateId =
      Date.now();

    let scheduledCount =
      0;

    let sentCount =
      0;

    let noSubscriptionCount =
      0;

    let failedCount =
      0;

    const results =
      [];

    /*
     * =====================================================
     * NOTIFICATION PAR JOUEUR
     * =====================================================
     */

    for (
      let index = 0;
      index <
      standings.length;
      index++
    ) {
      const standing =
        standings[index];

      const rank =
        index + 1;

      const score =
        standing.final_score;

      const userId =
        standing.user_id;

      const eventKey =
        `rankings-week-${week}` +
        `-update-${updateId}` +
        `-user-${userId}`;

      /*
       * ===================================================
       * TEXTE PERSONNALISÉ
       * ===================================================
       */

      const rankText =
        formatRank(
          rank
        );

      const scoreText =
        score.toFixed(
          3
        );

      let notificationBody;

      if (
        gameLabel
      ) {
        notificationBody =
          `Après ${gameLabel}, tu es ${rankText} cette semaine avec ${scoreText} pts.`;
      } else {
        notificationBody =
          `Après les derniers matchs, tu es ${rankText} cette semaine avec ${scoreText} pts.`;
      }

      try {
        /*
         * =================================================
         * APRÈS 8 H 30 :
         * ENVOI IMMÉDIAT
         * =================================================
         */

        if (
          sendNow
        ) {
          const pushResult =
            await sendPushToUser({
              userId,

              title:
                "🏆 Classements mis à jour",

              body:
                notificationBody,

              url:
                "/classements",
            });

          if (
            pushResult.sent > 0
          ) {
            sentCount +=
              pushResult.sent;

            results.push({
              userId,

              rank,

              score,

              notificationBody,

              sent:
                pushResult.sent,

              status:
                "sent",
            });
          } else {
            noSubscriptionCount++;

            results.push({
              userId,

              rank,

              score,

              notificationBody,

              sent:
                0,

              status:
                "no_subscription",
            });
          }

          continue;
        }

        /*
         * =================================================
         * AVANT 8 H 30 :
         * PROGRAMMER POUR 8 H 30
         * =================================================
         */

        const {
          data:
            event,
          error:
            eventError,
        } =
          await supabaseAdmin
            .from(
              "push_notification_events"
            )
            .insert({
              event_key:
                eventKey,

              user_id:
                userId,

              notification_type:
                "rankings_updated",

              week,

              scheduled_for:
                scheduledFor.toISOString(),

              status:
                "pending",
            })
            .select(
              "id"
            )
            .single();

        if (
          eventError
        ) {
          throw eventError;
        }

        scheduledCount++;

        results.push({
          userId,

          rank,

          score,

          notificationBody,

          scheduledFor:
            scheduledFor.toISOString(),

          eventId:
            event.id,

          status:
            "pending",
        });
      } catch (
        playerError
      ) {
        console.error(
          "Erreur notification classement :",
          userId,
          playerError
        );

        failedCount++;

        results.push({
          userId,

          rank,

          score,

          status:
            "failed",

          error:
            playerError
              ?.message ||
            "Erreur inconnue",
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

      week,

      gameLabel:
        gameLabel ||
        null,

      players:
        standings.length,

      delivery:
        sendNow
          ? "immediate"
          : "scheduled",

      sent:
        sentCount,

      scheduled:
        scheduledCount,

      noSubscription:
        noSubscriptionCount,

      failed:
        failedCount,

      scheduledFor:
        scheduledFor
          ? scheduledFor.toISOString()
          : null,

      results,
    });
  } catch (
    error
  ) {
    console.error(
      "Erreur route classement :",
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
