import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

/*
 * =========================================================
 * VARIABLES D'ENVIRONNEMENT
 * =========================================================
 */

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

/*
 * =========================================================
 * CLIENT SUPABASE ADMIN
 * =========================================================
 */

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
 * CONFIGURATION WEB PUSH
 * =========================================================
 */

webpush.setVapidDetails(
  vapidSubject,
  vapidPublicKey,
  vapidPrivateKey
);

/*
 * =========================================================
 * ENVOYER UNE NOTIFICATION À UN ABONNEMENT
 * =========================================================
 */

async function sendToSubscription(
  item,
  payload
) {
  try {
    await webpush.sendNotification(
      item.subscription,
      JSON.stringify(
        payload
      )
    );

    return {
      id:
        item.id,

      success:
        true,
    };
  } catch (error) {
    console.error(
      "Erreur push :",
      error
    );

    /*
     * =========================================================
     * SUPPRIMER LES ABONNEMENTS EXPIRÉS
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

    return {
      id:
        item.id,

      success:
        false,

      statusCode:
        error?.statusCode ||
        null,
    };
  }
}

/*
 * =========================================================
 * ENVOYER À UN UTILISATEUR
 * =========================================================
 */

export async function sendPushToUser({
  userId,
  title,
  body,
  url = "/",
}) {
  const {
    data:
      subscriptions,
    error,
  } =
    await supabaseAdmin
      .from(
        "push_subscriptions"
      )
      .select(
        "id, subscription"
      )
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw error;
  }

  if (
    !subscriptions ||
    subscriptions.length ===
      0
  ) {
    return {
      success:
        true,

      sent:
        0,

      total:
        0,

      results:
        [],
    };
  }

  const payload = {
    title:
      title ||
      "Pool NFL 🏈",

    body:
      body ||
      "Nouvelle notification",

    url,
  };

  const results = [];

  for (
    const item of
    subscriptions
  ) {
    const result =
      await sendToSubscription(
        item,
        payload
      );

    results.push(
      result
    );
  }

  return {
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
  };
}

/*
 * =========================================================
 * ENVOYER À TOUS LES UTILISATEURS ABONNÉS
 * =========================================================
 */

export async function sendPushToAll({
  title,
  body,
  url = "/",
}) {
  const {
    data:
      subscriptions,
    error,
  } =
    await supabaseAdmin
      .from(
        "push_subscriptions"
      )
      .select(
        "id, subscription"
      );

  if (error) {
    throw error;
  }

  if (
    !subscriptions ||
    subscriptions.length ===
      0
  ) {
    return {
      success:
        true,

      sent:
        0,

      total:
        0,

      results:
        [],
    };
  }

  const payload = {
    title:
      title ||
      "Pool NFL 🏈",

    body:
      body ||
      "Nouvelle notification",

    url,
  };

  const results = [];

  for (
    const item of
    subscriptions
  ) {
    const result =
      await sendToSubscription(
        item,
        payload
      );

    results.push(
      result
    );
  }

  return {
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
  };
}
