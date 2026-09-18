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
    /*
     * =========================================================
     * AUTHENTIFICATION DE L'ADMIN
     * =========================================================
     */

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

    /*
     * =========================================================
     * VÉRIFIER QUE LE DEMANDEUR EST ADMIN
     * =========================================================
     */

    const {
      data: adminProfile,
      error: adminError,
    } =
      await supabaseAdmin
        .from("users")
        .select(`
          id,
          is_admin
        `)
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    if (adminError) {
      console.error(
        "Erreur vérification admin :",
        adminError
      );

      return NextResponse.json(
        {
          error:
            "Impossible de vérifier les droits administrateur.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !adminProfile ||
      adminProfile.is_admin !== true
    ) {
      return NextResponse.json(
        {
          error:
            "Accès administrateur requis.",
        },
        {
          status: 403,
        }
      );
    }

    /*
     * =========================================================
     * DONNÉES DU RESET
     * =========================================================
     */

    const body =
      await request.json();

    const userId =
      body?.userId;

    const temporaryPassword =
      body?.temporaryPassword;

    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Joueur introuvable.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !temporaryPassword ||
      temporaryPassword.length < 8
    ) {
      return NextResponse.json(
        {
          error:
            "Le mot de passe temporaire doit contenir au moins 8 caractères.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =========================================================
     * VÉRIFIER LE JOUEUR
     * =========================================================
     */

    const {
      data: targetUser,
      error: targetError,
    } =
      await supabaseAdmin
        .from("users")
        .select(`
          id,
          email,
          display_name,
          real_name
        `)
        .eq(
          "id",
          userId
        )
        .maybeSingle();

    if (
      targetError ||
      !targetUser
    ) {
      console.error(
        "Erreur joueur cible :",
        targetError
      );

      return NextResponse.json(
        {
          error:
            "Joueur introuvable.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * =========================================================
     * ACTIVER LE CHANGEMENT OBLIGATOIRE
     * =========================================================
     *
     * On place le marqueur AVANT de modifier le mot de passe.
     *
     * Ainsi, si la modification Auth réussit mais qu'une erreur
     * survient ensuite, le joueur reste quand même obligé de
     * créer son mot de passe permanent.
     */

    const {
      error: flagError,
    } =
      await supabaseAdmin
        .from("users")
        .update({
          must_change_password: true,
        })
        .eq(
          "id",
          userId
        );

    if (flagError) {
      console.error(
        "Erreur activation must_change_password :",
        flagError
      );

      return NextResponse.json(
        {
          error:
            "Impossible d'activer le changement obligatoire de mot de passe.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =========================================================
     * MODIFIER LE MOT DE PASSE SUPABASE AUTH
     * =========================================================
     */

    const {
      error: passwordError,
    } =
      await supabaseAdmin.auth.admin.updateUserById(
        userId,
        {
          password:
            temporaryPassword,
        }
      );

    if (passwordError) {
      console.error(
        "Erreur reset mot de passe :",
        passwordError
      );

      /*
       * Le mot de passe n'a pas été modifié.
       * On remet donc le marqueur à false.
       */

      const {
        error: rollbackError,
      } =
        await supabaseAdmin
          .from("users")
          .update({
            must_change_password: false,
          })
          .eq(
            "id",
            userId
          );

      if (rollbackError) {
        console.error(
          "Erreur rollback must_change_password :",
          rollbackError
        );
      }

      return NextResponse.json(
        {
          error:
            "Impossible de créer le mot de passe temporaire.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =========================================================
     * SUCCÈS
     * =========================================================
     */

    return NextResponse.json({
      success: true,

      user: {
        id:
          targetUser.id,

        email:
          targetUser.email,

        display_name:
          targetUser.display_name,

        real_name:
          targetUser.real_name,

        must_change_password:
          true,
      },
    });
  } catch (error) {
    console.error(
      "Erreur reset-password :",
      error
    );

    return NextResponse.json(
      {
        error:
          "Erreur serveur.",
      },
      {
        status: 500,
      }
    );
  }
}
