import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const vapidPublicKey =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const vapidPrivateKey =
  process.env.VAPID_PRIVATE_KEY;

const vapidSubject =
  process.env.VAPID_SUBJECT;

webpush.setVapidDetails(
  vapidSubject,
  vapidPublicKey,
  vapidPrivateKey
);

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

export async function POST(request) {
  try {
    /*
     * =========================================================
     * AUTHENTIFICATION
     * =========================================================
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
          status: 401,
        }
      );
    }

    const accessToken =
      authorization.replace(
        "Bearer ",
        ""
      );

    const {
      data:
        userData,
      error:
        userError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      userError ||
      !userData?.user
    ) {
      return Response.json(
        {
          error:
            "Session invalide ou expirée",
        },
        {
          status: 401,
        }
      );
    }

    const userId =
      userData.user.id;

    /*
     * =========================================================
     * ABONNEMENTS PUSH DE L'UTILISATEUR
     * =========================================================
     */

    const {
      data:
        subscriptions,
      error:
        subscriptionsError,
    } =
      await supabaseAdmin
        .from(
          "push_subscriptions"
        )
        .select(
          "id, endpoint, subscription"
        )
        .eq(
          "user_id",
          userId
        );

    if (
      subscriptionsError
    ) {
      throw subscriptionsError;
    }

    if (
      !subscriptions ||
      subscriptions.length ===
        0
    ) {
      return Response.json(
        {
          error:
            "Aucun abonnement push trouvé pour cet utilisateur.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * =========================================================
     * NOTIFICATION TEST
     * =========================================================
     */

    const payload =
      JSON.stringify({
        title:
          "Pool NFL 🏈",

        body:
          "Notification test réussie!",

        url:
          "/",
      });

    const results = [];

    for (
      const item of
      subscriptions
    ) {
      try {
        await webpush.sendNotification(
          item.subscription,
          payload
        );

        results.push({
          id:
            item.id,

          success:
            true,
        });
      } catch (error) {
        console.error(
          "Erreur push :",
          error
        );

        /*
         * =========================================================
         * ABONNEMENT EXPIRÉ / SUPPRIMÉ PAR LE NAVIGATEUR
         * =========================================================
         */

        if (
          error?.statusCode ===
            404 ||
          error?.statusCode ===
            410
        ) {
          await supabaseAdmin
            .from(
              "push_subscriptions"
            )
            .delete()
            .eq(
              "id",
              item.id
            );
        }

        results.push({
          id:
            item.id,

          success:
            false,

          statusCode:
            error?.statusCode ||
            null,
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

      sent:
        results.filter(
          (result) =>
            result.success
        ).length,

      total:
        results.length,

      results,
    });
  } catch (error) {
    console.error(
      "Erreur route push test :",
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
