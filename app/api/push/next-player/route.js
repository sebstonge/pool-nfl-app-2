import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "../../../../lib/pushNotifications";

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
 * ORDRE OFFICIEL — SEMAINE 1
 * =========================================================
 */

const WEEK_1_QB_ORDER = [
  "Alexandre",
  "Edouard",
  "Louis-Simon",
  "Séb",
  "Charles",
  "Naomie",
  "Léa",
  "Félix",
  "Carolyne",
  "Mathieu",
  "Katy",
  "Pierre-André",
  "Étienne",
];

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

function getWeek1Order(players) {
  const ordered = [];
  const usedIds = new Set();

  WEEK_1_QB_ORDER.forEach(
    (wantedName) => {
      const wanted =
        normalizeName(
          wantedName
        );

      let player =
        players.find(
          (p) =>
            !usedIds.has(
              p.id
            ) &&
            normalizeName(
              p.real_name
            ) === wanted
        );

      if (!player) {
        player =
          players.find(
            (p) => {
              if (
                usedIds.has(
                  p.id
                )
              ) {
                return false;
              }

              const actual =
                normalizeName(
                  p.real_name
                );

              return (
                actual.startsWith(
                  wanted
                ) ||
                wanted.startsWith(
                  actual
                )
              );
            }
          );
      }

      if (player) {
        ordered.push(
          player
        );

        usedIds.add(
          player.id
        );
      }
    }
  );

  const leftovers =
    players
      .filter(
        (p) =>
          !usedIds.has(
            p.id
          )
      )
      .sort(
        (a, b) =>
          playerRealName(
            a
          ).localeCompare(
            playerRealName(
              b
            ),
            "fr"
          )
      );

  return [
    ...ordered,
    ...leftovers,
  ];
}

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

    const eventKey =
      `qb-turn-week-${week}-user-${nextPlayer.id}`;

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
