import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function POST(request) {
  try {
    /* =========================================================
       1. LIRE LA DEMANDE
       ========================================================= */

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Non autorisé." },
        { status: 401 }
      );
    }

    const accessToken = authHeader.replace("Bearer ", "");

    const body = await request.json();
    const { userId, temporaryPassword } = body;

    if (!userId || !temporaryPassword) {
      return NextResponse.json(
        { error: "Utilisateur et mot de passe temporaire requis." },
        { status: 400 }
      );
    }

    if (temporaryPassword.length < 8) {
      return NextResponse.json(
        {
          error:
            "Le mot de passe temporaire doit contenir au moins 8 caractères.",
        },
        { status: 400 }
      );
    }

    /* =========================================================
       2. VÉRIFIER L'UTILISATEUR CONNECTÉ
       ========================================================= */

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const {
      data: { user: requester },
      error: requesterError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (requesterError || !requester) {
      return NextResponse.json(
        { error: "Session invalide." },
        { status: 401 }
      );
    }

    /* =========================================================
       3. VÉRIFIER QUE LE DEMANDEUR EST ADMIN
       ========================================================= */

    const { data: adminProfile, error: adminError } = await supabaseAdmin
      .from("users")
      .select("id, is_admin")
      .eq("id", requester.id)
      .single();

    if (adminError || !adminProfile?.is_admin) {
      return NextResponse.json(
        { error: "Accès administrateur requis." },
        { status: 403 }
      );
    }

    /* =========================================================
       4. VÉRIFIER L'UTILISATEUR CIBLÉ
       ========================================================= */

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from("users")
      .select("id, email, display_name, real_name")
      .eq("id", userId)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json(
        { error: "Utilisateur introuvable." },
        { status: 404 }
      );
    }

    /* =========================================================
       5. ATTRIBUER LE MOT DE PASSE TEMPORAIRE
       ========================================================= */

    const { error: passwordError } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: temporaryPassword,
      });

    if (passwordError) {
      console.error("Erreur reset password:", passwordError);

      return NextResponse.json(
        { error: "Impossible de modifier le mot de passe." },
        { status: 500 }
      );
    }

    /* =========================================================
       6. FORCER LE CHANGEMENT À LA PROCHAINE CONNEXION
       ========================================================= */

    const { error: flagError } = await supabaseAdmin
      .from("users")
      .update({
        must_change_password: true,
      })
      .eq("id", userId);

    if (flagError) {
      console.error("Erreur must_change_password:", flagError);

      return NextResponse.json(
        {
          error:
            "Le mot de passe a été modifié, mais le changement obligatoire n'a pas pu être activé.",
        },
        { status: 500 }
      );
    }

    /* =========================================================
       7. TERMINÉ
       ========================================================= */

    return NextResponse.json({
      success: true,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        display_name: targetUser.display_name,
        real_name: targetUser.real_name,
      },
    });
  } catch (error) {
    console.error("Erreur API reset-password:", error);

    return NextResponse.json(
      { error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
