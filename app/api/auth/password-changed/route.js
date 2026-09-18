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
       1. VÉRIFIER LA SESSION ACTUELLE
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

    const {
      data: { user },
      error: userError,
    } =
      await supabaseAdmin.auth.getUser(
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
       2. LIRE LES MOTS DE PASSE
       ========================================================= */

    const body =
      await request.json();

    const temporaryPassword =
      body?.temporaryPassword;

    const newPassword =
      body?.newPassword;

    if (!temporaryPassword) {
      return NextResponse.json(
        {
          error:
            "Entre ton mot de passe temporaire.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !newPassword ||
      newPassword.length < 8
    ) {
      return NextResponse.json(
        {
          error:
            "Le nouveau mot de passe doit contenir au moins 8 caractères.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      temporaryPassword ===
      newPassword
    ) {
      return NextResponse.json(
        {
          error:
            "Ton nouveau mot de passe doit être différent du mot de passe temporaire.",
        },
        {
          status: 400,
        }
      );
    }

    if (!user.email) {
      return NextResponse.json(
        {
          error:
            "Adresse courriel introuvable.",
        },
        {
          status: 400,
        }
      );
    }

    /* =========================================================
       3. VÉRIFIER QUE LE CHANGEMENT EST BIEN OBLIGATOIRE
       ========================================================= */

    const {
      data: profile,
      error: profileError,
    } =
      await supabaseAdmin
        .from("users")
        .select(`
          id,
          must_change_password
        `)
        .eq("id", user.id)
        .maybeSingle();

    if (
      profileError ||
      !profile
    ) {
      console.error(
        "Erreur profil password change :",
        profileError
      );

      return NextResponse.json(
        {
          error:
            "Profil utilisateur introuvable.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      profile.must_change_password !==
      true
    ) {
      return NextResponse.json(
        {
          error:
            "Aucun changement obligatoire de mot de passe n'est en attente.",
        },
        {
          status: 400,
        }
      );
    }

    /* =========================================================
       4. VÉRIFIER LE MOT DE PASSE TEMPORAIRE

       IMPORTANT :
       on crée un client Auth séparé.
       Le service role ne sert PAS à cette vérification.
       ========================================================= */

    const verificationClient =
      createClient(
        supabaseUrl,
        supabaseAnonKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );

    const {
      data: verificationData,
      error: verificationError,
    } =
      await verificationClient.auth.signInWithPassword({
        email:
          user.email
            .trim()
            .toLowerCase(),

        password:
          temporaryPassword,
      });

    if (
      verificationError ||
      !verificationData?.user
    ) {
      return NextResponse.json(
        {
          error:
            "Le mot de passe temporaire est invalide.",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * Protection supplémentaire :
     * le compte authentifié avec le temporaire
     * doit être exactement le compte de la session.
     */

    if (
      verificationData.user.id !==
      user.id
    ) {
      return NextResponse.json(
        {
          error:
            "Le mot de passe temporaire ne correspond pas à ce compte.",
        },
        {
          status: 403,
        }
      );
    }

    /* =========================================================
       5. REMPLACER LE MOT DE PASSE CÔTÉ SERVEUR
       ========================================================= */

    const {
      error: passwordError,
    } =
      await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        {
          password:
            newPassword,
        }
      );

    if (passwordError) {
      console.error(
        "Erreur changement mot de passe permanent :",
        passwordError
      );

      return NextResponse.json(
        {
          error:
            "Impossible d'enregistrer le nouveau mot de passe.",
        },
        {
          status: 500,
        }
      );
    }

    /* =========================================================
       6. RETIRER LE VERROU TEMPORAIRE
       ========================================================= */

    const {
      error: flagError,
    } =
      await supabaseAdmin
        .from("users")
        .update({
          must_change_password:
            false,
        })
        .eq("id", user.id);

    if (flagError) {
      console.error(
        "Erreur désactivation must_change_password :",
        flagError
      );

      /*
       * Le mot de passe a déjà été changé.
       * On retourne donc une erreur explicite
       * plutôt que de prétendre que tout est terminé.
       */

      return NextResponse.json(
        {
          error:
            "Le mot de passe a été changé, mais le compte n'a pas pu être déverrouillé. Contacte l'administrateur.",
        },
        {
          status: 500,
        }
      );
    }

    /* =========================================================
       7. SUCCÈS
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
