import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "../../../../lib/pushNotifications";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});

/* =========================================================
   ORDRE FIXE — SEMAINE 1
========================================================= */

const WEEK_1_ORDER = [
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

/* =========================================================
   HELPERS — NOMS
========================================================= */

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function playerDisplayName(player) {
  return (
    player?.display_name ||
    player?.name ||
    player?.real_name ||
    player?.email ||
    "Joueur"
  );
}

/* =========================================================
   HEURE DU QUÉBEC
========================================================= */

function getQuebecParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUTC - date.getTime();
}

function quebecDateTimeToUtc({
  year,
  month,
  day,
  hour,
  minute,
  second = 0,
}) {
  const approximateUtc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  );

  const firstOffset = getTimeZoneOffsetMs(
    approximateUtc,
    "America/Toronto"
  );

  let result = new Date(approximateUtc.getTime() - firstOffset);

  const secondOffset = getTimeZoneOffsetMs(
    result,
    "America/Toronto"
  );

  if (secondOffset !== firstOffset) {
    result = new Date(approximateUtc.getTime() - secondOffset);
  }

  return result;
}

function getTodayAt830Quebec(now = new Date()) {
  const parts = getQuebecParts(now);

  return quebecDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 8,
    minute: 30,
    second: 0,
  });
}

function isBefore830Quebec(now = new Date()) {
  const parts = getQuebecParts(now);

  return (
    parts.hour < 8 ||
    (parts.hour === 8 && parts.minute < 30)
  );
}

/* =========================================================
   ROUTE
========================================================= */

export async function POST(request) {
  try {
    /* =====================================================
       1. AUTHENTIFICATION
    ===================================================== */

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return Response.json(
        { error: "Non autorisé" },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice(7);

    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authUser) {
      return Response.json(
        { error: "Session invalide" },
        { status: 401 }
      );
    }

    /* =====================================================
       2. VÉRIFIER ADMIN
    ===================================================== */

    const { data: adminUser, error: adminError } =
      await supabaseAdmin
        .from("users")
        .select("id, is_admin")
        .eq("id", authUser.id)
        .single();

    if (adminError) throw adminError;

    if (!adminUser?.is_admin) {
      return Response.json(
        { error: "Accès administrateur requis" },
        { status: 403 }
      );
    }

    /* =====================================================
       3. SEMAINE ACTUELLE
    ===================================================== */

    const { data: settings, error: settingsError } =
      await supabaseAdmin
        .from("settings")
        .select("current_week")
        .single();

    if (settingsError) throw settingsError;

    const week = Number(settings?.current_week);

    if (!week) {
      return Response.json(
        { error: "Semaine invalide" },
        { status: 400 }
      );
    }

    /* =====================================================
       4. JOUEURS
    ===================================================== */

    const { data: players, error: playersError } =
      await supabaseAdmin
        .from("users")
        .select("*");

    if (playersError) throw playersError;

    if (!players?.length) {
      return Response.json(
        { error: "Aucun joueur trouvé" },
        { status: 400 }
      );
    }

    let orderedPlayers = [];

    /* =====================================================
       5. ORDRE SEMAINE 1
    ===================================================== */

    if (week === 1) {
      orderedPlayers = WEEK_1_ORDER
        .map((wantedName) => {
          const wanted = normalizeName(wantedName);

          return players.find((player) => {
            const candidates = [
              player?.display_name,
              player?.name,
              player?.real_name,
            ];

            return candidates.some(
              (candidate) =>
                normalizeName(candidate) === wanted
            );
          });
        })
        .filter(Boolean);
    }

    /* =====================================================
       6. ORDRE SEMAINE 2+
       Plus faible score semaine précédente en premier
    ===================================================== */

    if (week > 1) {
      const { data: previousScores, error: scoresError } =
        await supabaseAdmin
          .from("weekly_scores")
          .select("user_id, total_score")
          .eq("week", week - 1);

      if (scoresError) throw scoresError;

      const scoreMap = new Map();

      for (const row of previousScores || []) {
        scoreMap.set(
          row.user_id,
          Number(row.total_score ?? 0)
        );
      }

      orderedPlayers = [...players].sort((a, b) => {
        const scoreA = scoreMap.has(a.id)
          ? scoreMap.get(a.id)
          : 0;

        const scoreB = scoreMap.has(b.id)
          ? scoreMap.get(b.id)
          : 0;

        if (scoreA !== scoreB) {
          return scoreA - scoreB;
        }

        return playerDisplayName(a).localeCompare(
          playerDisplayName(b),
          "fr"
        );
      });
    }

    const firstPlayer = orderedPlayers[0];

    if (!firstPlayer) {
      return Response.json(
        { error: "Premier joueur introuvable" },
        { status: 400 }
      );
    }

    /* =====================================================
       7. CLÉ ANTI-DOUBLON

       Même format que /api/push/next-player.
       Ainsi une même personne ne peut pas recevoir deux fois
       la notification de son tour pour la même semaine.
    ===================================================== */

    const eventKey =
      `qb-turn-week-${week}-user-${firstPlayer.id}`;

    const now = new Date();
    const before830 = isBefore830Quebec(now);

    /* =====================================================
       8. AVANT 8 H 30 QUÉBEC
       → programmer pour aujourd'hui à 8 h 30
    ===================================================== */

    if (before830) {
      const scheduledFor = getTodayAt830Quebec(now);

      const { error: insertError } = await supabaseAdmin
        .from("push_notification_events")
        .insert({
          event_key: eventKey,
          user_id: firstPlayer.id,
          notification_type: "qb_turn",
          week,
          scheduled_for: scheduledFor.toISOString(),
          status: "pending",
        });

      if (insertError) {
        if (insertError.code === "23505") {
          return Response.json({
            success: true,
            alreadyExists: true,
            week,
            firstPlayer: playerDisplayName(firstPlayer),
          });
        }

        throw insertError;
      }

      return Response.json({
        success: true,
        scheduled: true,
        week,
        firstPlayer: playerDisplayName(firstPlayer),
        scheduledFor: scheduledFor.toISOString(),
      });
    }

    /* =====================================================
       9. À PARTIR DE 8 H 30 QUÉBEC
       → envoyer immédiatement
    ===================================================== */

    const { data: event, error: insertError } =
      await supabaseAdmin
        .from("push_notification_events")
        .insert({
          event_key: eventKey,
          user_id: firstPlayer.id,
          notification_type: "qb_turn",
          week,
          scheduled_for: now.toISOString(),
          status: "pending",
        })
        .select("id")
        .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return Response.json({
          success: true,
          alreadyExists: true,
          week,
          firstPlayer: playerDisplayName(firstPlayer),
        });
      }

      throw insertError;
    }

    const pushResult = await sendPushToUser({
      userId: firstPlayer.id,
      title: "⏰ C’est à ton tour",
      body:
        `Tu peux maintenant soumettre ton QB et tes choix ` +
        `pour la semaine ${week}.`,
      url: "/mes-choix",
    });

    if (pushResult.sent > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("push_notification_events")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (updateError) throw updateError;

      return Response.json({
        success: true,
        sent: true,
        week,
        firstPlayer: playerDisplayName(firstPlayer),
        devices: pushResult.sent,
      });
    }

    /*
      Aucun abonnement push :
      on retire l'événement afin qu'un nouvel essai
      demeure possible.
    */

    await supabaseAdmin
      .from("push_notification_events")
      .delete()
      .eq("id", event.id);

    return Response.json({
      success: true,
      sent: false,
      noSubscription: true,
      week,
      firstPlayer: playerDisplayName(firstPlayer),
    });
  } catch (error) {
    console.error(
      "Erreur notification premier joueur :",
      error
    );

    return Response.json(
      {
        error: error?.message || "Erreur inconnue",
      },
      {
        status: 500,
      }
    );
  }
}
