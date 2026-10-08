import {regularEventKey,regularClient,initialOrder} from "../../../../lib/seasons/regularClient.mjs";
import { loadLifecycle, regularIsOpen } from '../../../../lib/lifecycle/context.mjs';
import { createClient } from "@supabase/supabase-js";
import { sendRegularPushToUser as sendPushToUser } from "../../../../lib/pushNotifications";

export const runtime = "nodejs";

/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const rawAdmin =
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
 * ORDRE OFFICIEL — SEMAINE 1
 * =========================================================
 */



/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerRealName(player) {
  return (
    player?.real_name ||
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) { return initialOrder(players); }

function getWeeklyScoreValue(
  row
) {
  const candidates = [
    row?.total_score,
    row?.final_score,
    row?.weekly_score,
    row?.score,
    row?.points,
    row?.total,
  ];

  for (
    const value of
    candidates
  ) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(
        Number(value)
      )
    ) {
      return Number(
        value
      );
    }
  }

  return null;
}

/*
 * =========================================================
 * ROUTE
 * =========================================================
 */

export async function POST(
  request
) {
  const supabaseAdmin=regularClient(rawAdmin);
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
      data: userData,
      error: userError,
    } =
      await supabaseAdmin
        .auth
        .getUser(
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
     * SEMAINE ACTUELLE
     * =========================================================
     */

    if (!regularIsOpen(await loadLifecycle(supabaseAdmin))) return Response.json({ skipped: 'regular_closed' });

    const {
      data: settings,
      error: settingsError,
    } =
      await supabaseAdmin
        .from(
          "settings"
        )
        .select(
          "current_week"
        )
        .single();

    if (
      settingsError
    ) {
      throw settingsError;
    }

    const week =
      Number(
        settings?.current_week
      ) || 1;

    /*
     * =========================================================
     * JOUEURS
     * =========================================================
     */

    const {
      data: playersData,
      error: playersError,
    } =
      await supabaseAdmin
        .from(
          "users"
        )
        .select(
          "id, email, display_name, real_name"
        );

    if (
      playersError
    ) {
      throw playersError;
    }

    const players =
      playersData || [];

    /*
     * =========================================================
     * JOUEURS AYANT DÉJÀ SOUMIS
     * =========================================================
     */

    const {
      data: qbPicks,
      error: qbPicksError,
    } =
      await supabaseAdmin
        .from(
          "qb_picks"
        )
        .select(
          "user_id"
        )
        .eq(
          "week",
          week
        );

    if (
      qbPicksError
    ) {
      throw qbPicksError;
    }

    const alreadyPickedIds =
      new Set(
        (
          qbPicks || []
        ).map(
          (row) =>
            row.user_id
        )
      );

    /*
     * =========================================================
     * ORDRE COMPLET
     * =========================================================
     */

    let fullOrder = [];

    if (
      week === 1
    ) {
      fullOrder =
        getWeek1Order(
          players
        );
    } else {
      const {
        data: previousScores,
        error: previousScoresError,
      } =
        await supabaseAdmin
          .from(
            "weekly_scores"
          )
          .select("*")
          .eq(
            "week",
            week - 1
          );

      if (
        previousScoresError
      ) {
        throw previousScoresError;
      }

      const scoreByUser =
        {};

      (
        previousScores || []
      ).forEach(
        (row) => {
          scoreByUser[
            row.user_id
          ] =
            getWeeklyScoreValue(
              row
            );
        }
      );

      fullOrder =
        [...players].sort(
          (a, b) => {
            const scoreA =
              scoreByUser[
                a.id
              ];

            const scoreB =
              scoreByUser[
                b.id
              ];

            if (
              scoreA == null &&
              scoreB == null
            ) {
              return playerRealName(
                a
              ).localeCompare(
                playerRealName(
                  b
                ),
                "fr"
              );
            }

            if (
              scoreA == null
            ) {
              return 1;
            }

            if (
              scoreB == null
            ) {
              return -1;
            }

            if (
              scoreA !==
              scoreB
            ) {
              return (
                scoreA -
                scoreB
              );
            }

            return playerRealName(
              a
            ).localeCompare(
              playerRealName(
                b
              ),
              "fr"
            );
          }
        );
    }

    /*
     * =========================================================
     * PROCHAIN JOUEUR
     * =========================================================
     */

    const nextPlayer =
      fullOrder.find(
        (player) =>
          !alreadyPickedIds.has(
            player.id
          )
      );

    /*
     * Tout le monde a soumis.
     */
    if (
      !nextPlayer
    ) {
      return Response.json({
        success: true,
        completed: true,
        message:
          "Tous les joueurs ont soumis.",
      });
    }

    /*
     * =========================================================
     * CLÉ UNIQUE DE NOTIFICATION
     * =========================================================
     */

    const eventKey = regularEventKey(await supabaseAdmin.regularSeason(),
      `qb-turn-week-${week}-user-${nextPlayer.id}`);

    /*
     * =========================================================
     * RÉSERVER L'ÉVÉNEMENT
     * =========================================================
     *
     * La contrainte UNIQUE sur event_key
     * empêche un double envoi.
     * =========================================================
     */

    const {
      data: eventRow,
      error: eventError,
    } =
      await supabaseAdmin
        .from(
          "push_notification_events"
        )
        .insert({
          event_key:
            eventKey,

          user_id:
            nextPlayer.id,

          notification_type:
            "qb_turn",

          week,
        })
        .select(
          "id"
        )
        .single();

    /*
     * Code PostgreSQL 23505 =
     * valeur UNIQUE déjà existante.
     */
    if (
      eventError?.code ===
      "23505"
    ) {
      return Response.json({
        success: true,
        alreadySent: true,
        nextPlayer:
          playerRealName(
            nextPlayer
          ),
      });
    }

    if (
      eventError
    ) {
      throw eventError;
    }

    /*
     * =========================================================
     * ENVOI PUSH
     * =========================================================
     */

    const result =
  await sendPushToUser({
    season: await supabaseAdmin.regularSeason(),
    notificationLog: {eventKey, type: 'qb_turn'},
    userId:
      nextPlayer.id,

    title:
      "⏰ C’est à ton tour",

    body:
      `Tu peux maintenant soumettre ton QB et tes choix pour la semaine ${week}.`,

    url:
      "/",
  });

    /*
     * =========================================================
     * AUCUN APPAREIL ABONNÉ
     * =========================================================
     *
     * On libère l'événement afin qu'un
     * nouvel essai reste possible plus tard.
     * =========================================================
     */

    if (
      result.sent === 0
    ) {
      await supabaseAdmin
        .from(
          "push_notification_events"
        )
        .delete()
        .eq(
          "id",
          eventRow.id
        );
    }

    /*
     * =========================================================
     * RÉPONSE
     * =========================================================
     */

    return Response.json({
      success: true,

      week,

      nextPlayer:
        playerRealName(
          nextPlayer
        ),

      userId:
        nextPlayer.id,

      sent:
        result.sent,

      total:
        result.total,
    });
  } catch (error) {
    console.error(
      "Erreur notification prochain joueur :",
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
