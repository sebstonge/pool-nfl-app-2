import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function POST(request) {
  try {
    /* =========================================================
       1. VÉRIFIER LA SESSION
       ========================================================= */

    const authHeader =
      request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "Non autorisé.",
        },
        {
          status: 401,
        }
      );
    }

    const accessToken =
      authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },

        global: {
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } =
      await supabaseAuth.auth.getUser(
        accessToken
      );

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "Session invalide.",
        },
        {
          status: 401,
        }
      );
    }

    /* =========================================================
       2. ENLEVER L'OBLIGATION
       ========================================================= */

    const { error: updateError } =
      await supabaseAdmin
        .from("users")
        .update({
          must_change_password: false,
        })
        .eq("id", user.id);

    if (updateError) {
      console.error(
        "Erreur must_change_password :",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Impossible de confirmer le changement de mot de passe.",
        },
        {
          status: 500,
        }
      );
    }

    /* =========================================================
       3. TERMINÉ
       ========================================================= */

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Erreur password-changed :",
      error
    );

    return NextResponse.json(
      {
        error: "Erreur serveur.",
      },
      {
        status: 500,
      }
    );
  }
}
