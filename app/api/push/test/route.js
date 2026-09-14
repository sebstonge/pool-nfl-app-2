import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "../../../../lib/pushNotifications";

export const runtime =
  "nodejs";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    /*
     * =========================================================
     * ENVOI DE LA NOTIFICATION TEST
     * =========================================================
     */

    const result =
      await sendPushToUser({
        userId:
          userData.user.id,

        title:
          "Pool NFL 🏈",

        body:
          "Notification test réussie!",

        url:
          "/",
      });

    return Response.json(
      result
    );
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
