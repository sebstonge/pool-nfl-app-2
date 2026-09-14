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
    const body =
      await request.json();

    const userId =
      body?.user_id;

    if (!userId) {
      return Response.json(
        {
          error:
            "user_id manquant",
        },
        {
          status: 400,
        }
      );
    }

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

    return Response.json({
      success:
        true,
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
