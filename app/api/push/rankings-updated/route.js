import {
  createClient,
} from "@supabase/supabase-js";

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
 * PROCHAIN 8 H 30 — HEURE DU QUÉBEC
 * =========================================================
 *
 * En septembre, le Québec est à UTC-4.
 *
 * 8 h 30 Québec = 12 h 30 UTC.
 *
 * Cette route est utilisée lorsque l'Admin fait
 * sa mise à jour tôt le matin.
 * =========================================================
 */

function getNext830Quebec() {
  const now =
    new Date();

  const scheduled =
    new Date(now);

  scheduled.setUTCHours(
    12,
    30,
    0,
    0
  );

  /*
   * Si 8 h 30 Québec est déjà passé,
   * on programme pour le lendemain.
   */
  if (
    scheduled.getTime() <=
    now.getTime()
  ) {
    scheduled.setUTCDate(
      scheduled.getUTCDate() + 1
    );
  }

  return scheduled;
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
        .from("users")
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

    const scheduledFor =
      getNext830Quebec();

    const updateId =
      Date.now();

    let scheduledCount =
      0;

    let failedCount =
      0;

    const results =
      [];

    /*
     * =====================================================
     * PROGRAMMER UNE NOTIFICATION PAR JOUEUR
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
         * CRÉER L'ÉVÉNEMENT PROGRAMMÉ
         * =================================================
         *
         * On conserve le texte directement dans event_key
         * uniquement pour identifier l'événement.
         *
         * Le cron reconstruira le classement au moment
         * de l'envoi à partir de weekly_scores.
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
          "Erreur programmation classement :",
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

      scheduled:
        scheduledCount,

      failed:
        failedCount,

      scheduledFor:
        scheduledFor.toISOString(),

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
