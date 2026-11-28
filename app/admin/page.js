"use client";
import {initialOrder,regularClient} from "../../lib/seasons/regularClient.mjs";
const supabase=regularClient(rawSupabase);

import { useEffect, useRef, useState } from "react";
import { supabase as rawSupabase } from "../../lib/supabase";
import {loadSelectionStats as readSelectionStats,formatDuration} from "../../lib/seasons/selectionTime.mjs";
import NotificationLog from "./components/NotificationLog";
import FullUpdateStatus from "./components/FullUpdateStatus";
import BottomNav from "../components/BottomNav";
import SeasonLifecycle from "./components/SeasonLifecycle";
import LifecycleActions from "./components/LifecycleActions";
import previewStyles from "./previewNavigation.module.css";

/* =========================================================
   ORDRE OFFICIEL QB — SEMAINE 1
   ========================================================= */



/* =========================================================
   HELPERS JOUEURS
   ========================================================= */

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

function playerDisplayName(player) {
  return (
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) { return initialOrder(players); }

/* =========================================================
   HELPERS SCORES / ORDRE
   ========================================================= */

function getWeeklyScoreValue(row) {
  const candidates = [
    row?.total_score,
    row?.final_score,
    row?.weekly_score,
    row?.score,
    row?.points,
    row?.total,
  ];

  for (const value of candidates) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

/* =========================================================
   HELPERS TEMPS
   ========================================================= */

/* =========================================================
   PAGE
   ========================================================= */

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");
  const [fullUpdateStatus, setFullUpdateStatus] = useState(null);
  const fullUpdateRunning = useRef(false);
  const nextWeekRunning = useRef(false);

  const [selectionStats, setSelectionStats] = useState([]);
  const [selectionStatsLoading, setSelectionStatsLoading] =
    useState(false);
  const [selectionStatsError, setSelectionStatsError] =
  useState("");

/* =========================================================
   RESET MOT DE PASSE
   ========================================================= */

const [passwordUsers, setPasswordUsers] = useState([]);
const [passwordUserId, setPasswordUserId] = useState("");
const [temporaryPassword, setTemporaryPassword] = useState("");
const [passwordResetLoading, setPasswordResetLoading] = useState(false);
const [passwordResetMessage, setPasswordResetMessage] = useState("");

const [isMobile, setIsMobile] = useState(false);
const [isDesktop, setIsDesktop] = useState(false);

  /* =========================================================
     RESPONSIVE
     ========================================================= */

  useEffect(() => {
  function updateResponsive() {
    setIsMobile(window.innerWidth < 700);
    setIsDesktop(window.innerWidth >= 900);
  }

  updateResponsive();

  window.addEventListener("resize", updateResponsive);

  return () => {
    window.removeEventListener("resize", updateResponsive);
  };
}, []);

  /* =========================================================
     CHARGEMENT INITIAL
     ========================================================= */

  useEffect(() => {
    async function load() {
      const { data: sessionData } =
        await supabase.auth.getSession();

      const currentUser =
        sessionData.session?.user ?? null;

      setUser(currentUser);

      let admin = false;

      if (currentUser) {
        const { data: adminData } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();

        admin = adminData?.is_admin === true;

        setIsAdmin(admin);
      }

      const { data: settingsData } = await supabase
        .from("settings")
        .select("*")
        .single();

      if(currentUser && admin && settingsData?.phase === "playoffs"){window.location.replace("/admin/playoffs");return;}
      setSettings(settingsData);
      if(settingsData?.phase==='offseason')return;

      if (currentUser && admin && settingsData) {
  await loadSelectionStats(
    Number(settingsData.current_week || 1)
  );

  const { data: passwordUsersData, error: passwordUsersError } =
    await supabase
      .from("users")
      .select("id, email, display_name, real_name, must_change_password")
      .order("real_name", {
        ascending: true,
      });

  if (passwordUsersError) {
    console.error(
      "Erreur chargement utilisateurs :",
      passwordUsersError
    );
  } else {
    setPasswordUsers(passwordUsersData || []);
  }
}
    }

    load();
  }, []);

  /* =========================================================
     SETTINGS
     ========================================================= */

  async function loadSettings() {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .single();

    if (error) {
      throw new Error(
        "Settings : " + error.message
      );
    }

    setSettings(data);

    return data;
  }

  /* =========================================================
     STATS TEMPS DE SÉLECTION QB
     ========================================================= */

  async function loadSelectionStats(activeWeek) {
    try {
      setSelectionStatsLoading(true);
      setSelectionStatsError("");

      const rows = await readSelectionStats(supabase, activeWeek);
      setSelectionStats(rows);
    } catch (error) {
      console.error(error);

      setSelectionStatsError(
        error.message
      );
    } finally {
      setSelectionStatsLoading(false);
    }
  }

  async function requestFullUpdate(currentSettings) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Session : " + error.message);
    if (!data?.session?.access_token) throw new Error("Session expirée. Reconnecte-toi avant la mise à jour.");
    const response = await fetch("/api/admin/regular-week-results", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ season: currentSettings.current_season, week: currentSettings.current_week, revision: currentSettings.revision }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("La mise à jour n’a pas pu être confirmée."); }
    if (!response.ok) throw new Error(result?.error || `Mise à jour impossible (${response.status}).`);
    return result;
  }

  /* =========================================================
     MISE À JOUR COMPLÈTE
     ========================================================= */

  const fullUpdate = async () => {
    if (fullUpdateRunning.current) return;
    fullUpdateRunning.current = true;
    setMessage("");
    setFullUpdateStatus({ status: "running", week: settings?.current_week ?? null });
    try {
      const currentSettings = await loadSettings();
      const week = currentSettings.current_week;
      setFullUpdateStatus({ status: "running", week });
      const report = await requestFullUpdate(currentSettings);
      const notifications = report.notifications || {};
      const warnings = [...(report.warnings || [])];
      if (notifications.failed > 0) {
        warnings.push(`${notifications.failed} notification(s) de classement n’ont pas pu être envoyées.`);
      }
      const notificationNote = notifications.scheduled > 0
        ? `${notifications.scheduled} notification(s) de classement programmée(s).`
        : report.publication?.baseline ? "Référence des classements enregistrée."
        : !report.publication?.changed ? "Aucun nouveau classement à notifier." : null;
      setFullUpdateStatus({
        status: warnings.length ? "partial" : "success",
        week, completed: report.completed, warnings,
        details: { qbStats: report.qbStats, notifications: notifications.sent, notificationNote },
      });
      await loadSelectionStats(Number(week));
    } catch (error) {
      setFullUpdateStatus((state) => ({ ...state,
        status: state.completed ? "partial" : "error",
        error: { message: error?.message || "La mise à jour a été interrompue." },
      }));
    } finally {
      fullUpdateRunning.current = false;
    }
  };
 /* =========================================================
   SEMAINE SUIVANTE
   ========================================================= */

const nextWeek = async () => {
  if (nextWeekRunning.current) return;
  const displayedSettings = settings;
  const confirmed = window.confirm(
    "Passer à la semaine suivante ?\n\n" +
      "Cette action ouvrira officiellement la prochaine semaine du pool."
  );
  if (!confirmed) return;
  nextWeekRunning.current = true;
  setMessage("");
  let committedWeek = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Session : " + error.message);
    const token = data?.session?.access_token;
    if (!token) throw new Error("Session expirée. Reconnecte-toi avant de passer à la semaine suivante.");
    const response = await fetch("/api/admin/regular-next-week", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ season: displayedSettings.current_season, week: displayedSettings.current_week, revision: displayedSettings.revision, confirm: true }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("Le passage à la semaine suivante n’a pas pu être confirmé. Recharge la page avant de réessayer."); }
    if (!response.ok) throw new Error(result?.error || `Impossible de passer à la semaine suivante (${response.status}).`);
    const newWeek = Number(result.week ?? result.current_week ?? result.settings?.current_week ?? Number(displayedSettings.current_week) + 1);
    committedWeek = newWeek;
    // Notify only after the server has committed the new week and its opening time.
    let notificationWarning = "";
    try {
      const notificationResponse = await fetch("/api/push/first-player", {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      if (!notificationResponse.ok) notificationWarning = " L’envoi de la notification au premier joueur n’a pas été confirmé.";
    } catch {
      notificationWarning = " L’envoi de la notification au premier joueur n’a pas été confirmé.";
    }
    await loadSettings();
    await loadSelectionStats(newWeek);
    setMessage(`Semaine ${newWeek} ouverte avec succès ✅${notificationWarning}`);
  } catch (error) {
    setMessage(committedWeek !== null
      ? `Semaine ${committedWeek} ouverte. L’actualisation de l’affichage est incomplète. Recharge la page avant de poursuivre.`
      : `Erreur : ${error?.message || "Impossible de passer à la semaine suivante."}`);
  } finally {
    nextWeekRunning.current = false;
  }
};
/* =========================================================
   RESET MOT DE PASSE UTILISATEUR
   ========================================================= */

async function resetUserPassword() {
  setPasswordResetMessage("");

  if (!passwordUserId) {
    setPasswordResetMessage(
      "❌ Sélectionne un utilisateur."
    );
    return;
  }

  if (!temporaryPassword || temporaryPassword.length < 8) {
    setPasswordResetMessage(
      "❌ Le mot de passe temporaire doit contenir au moins 8 caractères."
    );
    return;
  }

  const targetUser = passwordUsers.find(
    (player) => player.id === passwordUserId
  );

  const targetName =
    targetUser?.real_name ||
    targetUser?.display_name ||
    targetUser?.email ||
    "cet utilisateur";

  const confirmed = window.confirm(
    `Réinitialiser le mot de passe de ${targetName} ?\n\n` +
      `Il devra obligatoirement créer un nouveau mot de passe après sa connexion.`
  );

  if (!confirmed) {
    return;
  }

  try {
    setPasswordResetLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error(
        "Session administrateur introuvable."
      );
    }

    const response = await fetch(
      "/api/admin/reset-password",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },

        body: JSON.stringify({
          userId: passwordUserId,
          temporaryPassword,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result?.error ||
          "Impossible de réinitialiser le mot de passe."
      );
    }

    setPasswordUsers((current) =>
      current.map((player) =>
        player.id === passwordUserId
          ? {
              ...player,
              must_change_password: true,
            }
          : player
      )
    );

    setPasswordResetMessage(
      `✅ Mot de passe temporaire activé pour ${targetName}.`
    );

    /*
     * On vide volontairement le champ.
     * Le mot de passe temporaire n'est jamais conservé
     * dans l'interface.
     */
    setTemporaryPassword("");
  } catch (error) {
    console.error(
      "Erreur reset mot de passe :",
      error
    );

    setPasswordResetMessage(
      `❌ ${
        error?.message ||
        "Impossible de réinitialiser le mot de passe."
      }`
    );
  } finally {
    setPasswordResetLoading(false);
  }
}
  /* =========================================================
     ACCÈS
     ========================================================= */

  if (!user) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Admin ⚙️</h1>

          <p>
            Connecte-toi pour accéder à
            l&apos;administration.
          </p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <section className="header-card">
          <h1>Accès refusé ❌</h1>

          <p>
            Tu n&apos;es pas
            administrateur.
          </p>
        </section>
      </main>
    );
  }

  if(!settings) return <main className="page"><p role="status">Chargement du contexte…</p></main>;

  /* =========================================================
   PAGE ADMIN
   ========================================================= */

  if(settings?.phase==='offseason')return <main className="page"><section className="header-card"><h1>Admin · Intersaison</h1></section><SeasonLifecycle/></main>;

  return (
    <main
      className="page"
      style={{
        maxWidth: isDesktop ? 1280 : undefined,

        width: isDesktop
          ? "calc(100% - 48px)"
          : undefined,

        margin: isDesktop
          ? "0 auto"
          : undefined,

        paddingTop: isDesktop
          ? 112
          : undefined,
      }}
    >
      {/* =====================================================
          HEADER
          ===================================================== */}

      <section
        className={`header-card ${previewStyles.hero}`}
        style={
          isDesktop
            ? {
                padding: "26px 30px",
                marginBottom: 18,
              }
            : undefined
        }
      >
        <h1>Admin ⚙️</h1>
        <a href="/series" className={previewStyles.previewButton}>👁 Prévisualiser le mode Séries</a>

        <p>
          Saison{" "}
          {settings?.current_season ||
            "..."}{" "}
          — semaine{" "}
          {settings?.current_week ||
            "..."}
        </p>
      </section>

      <a href="/admin/qb-observation" className="button-secondary" style={{ display: "inline-block", marginBottom: 18 }}>
        Recommandations QB
      </a>
      <FullUpdateStatus state={fullUpdateStatus} />

      {/* =====================================================
          MESSAGE ADMIN
          ===================================================== */}

      {message && (
        <section
          className="card"
          style={
            isDesktop
              ? {
                  marginBottom: 18,
                }
              : undefined
          }
        >
          <p style={{ margin: 0 }}>
            {message}
          </p>
        </section>
      )}

      {/* =====================================================
          ACTIONS ADMIN
          Desktop : 2 colonnes
          Mobile : affichage actuel empilé
          ===================================================== */}

      <div
        style={{
          display: isDesktop
            ? "grid"
            : "block",

          gridTemplateColumns: isDesktop
            ? "repeat(2, minmax(0, 1fr))"
            : undefined,

          gap: isDesktop
            ? 18
            : undefined,

          marginBottom: isDesktop
            ? 18
            : undefined,
        }}
      >
        {/* ===================================================
            MISE À JOUR ESPN
            =================================================== */}

        <section
          className="card"
          style={
            isDesktop
              ? {
                  margin: 0,
                  minHeight: 245,
                  padding: "24px 26px",

                  display: "flex",
                  flexDirection: "column",
                }
              : undefined
          }
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background:
                      "rgba(59,130,246,0.12)",

                    border:
                      "1px solid rgba(59,130,246,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🔄
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                }}
              >
                Mise à jour complète
              </h2>
            </div>

            <p
              style={{
                color: "#94a3b8",
                marginTop: isDesktop
                  ? 15
                  : undefined,

                lineHeight: 1.55,
              }}
            >
              Met à jour les scores ESPN,
              les fiches des équipes, les
              passer ratings QB et les
              classements pour la semaine
              active.
            </p>

            {isDesktop && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 7,
                  marginTop: 14,
                }}
              >
                {[
                  "Scores ESPN",
                  "Équipes NFL",
                  "QB Ratings",
                  "Classements",
                ].map((item) => (
                  <span
                    key={item}
                    style={{
                      padding: "6px 9px",

                      borderRadius: 9,

                      background:
                        "rgba(148,163,184,0.07)",

                      border:
                        "1px solid rgba(148,163,184,0.12)",

                      color: "#94a3b8",

                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: isDesktop
                ? "auto"
                : undefined,

              paddingTop: isDesktop
                ? 22
                : undefined,
            }}
          >
            <button
              className="button"
              onClick={fullUpdate}
              disabled={fullUpdateStatus?.status === "running"}
              aria-busy={fullUpdateStatus?.status === "running"}
              style={
                isDesktop
                  ? {
                      width: "100%",
                    }
                  : undefined
              }
            >
              Mettre à jour ESPN +
              classements
            </button>
          </div>
        </section>

        {/* ===================================================
            SEMAINE ACTIVE
            =================================================== */}

        <section
          className="card"
          style={
            isDesktop
              ? {
                  margin: 0,
                  minHeight: 245,
                  padding: "24px 26px",

                  display: "flex",
                  flexDirection: "column",
                }
              : undefined
          }
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background:
                      "rgba(168,85,247,0.12)",

                    border:
                      "1px solid rgba(168,85,247,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  📅
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                }}
              >
                Semaine active
              </h2>
            </div>

            {isDesktop ? (
              <>
                <div
                  style={{
                    marginTop: 17,

                    padding: "13px 16px",

                    borderRadius: 14,

                    background:
                      "rgba(148,163,184,0.06)",

                    border:
                      "1px solid rgba(148,163,184,0.12)",

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Semaine actuelle
                  </span>

                  <strong
                    style={{
                      color: "#f8fafc",
                      fontSize: 21,
                      lineHeight: 1,
                    }}
                  >
                    Semaine{" "}
                    {settings?.current_week ||
                      "..."}
                  </strong>
                </div>

                <p
                  style={{
                    color: "#94a3b8",
                    margin: "13px 0 0",
                    lineHeight: 1.45,
                    fontSize: 12,
                  }}
                >
                  À utiliser quand la semaine
                  est terminée et validée.
                </p>
              </>
            ) : (
              <p
                style={{
                  color: "#94a3b8",
                }}
              >
                À utiliser quand la semaine
                est terminée et validée.
              </p>
            )}
          </div>

          <div
            style={{
              marginTop: isDesktop
                ? "auto"
                : undefined,

              paddingTop: isDesktop
                ? 18
                : undefined,
            }}
          >
            <button
              className="button-secondary"
              onClick={nextWeek}
              style={
                isDesktop
                  ? {
                      width: "100%",
                    }
                  : undefined
              }
            >
              Passer à la semaine suivante
            </button>
          </div>
        </section>
      </div>
      {/* =====================================================
          RÉINITIALISATION MOT DE PASSE
          ===================================================== */}

      <section
        className="card"
        style={
          isDesktop
            ? {
                padding: "22px 26px",
                marginTop: 0,
                marginBottom: 18,
              }
            : undefined
        }
      >
        <div
          style={{
            display: isDesktop ? "flex" : "block",
            alignItems: isDesktop ? "flex-start" : undefined,
            justifyContent: isDesktop ? "space-between" : undefined,
            gap: isDesktop ? 30 : undefined,
          }}
        >
          {/* =================================================
              TITRE
              ================================================= */}

          <div
            style={{
              flex: isDesktop ? "0 0 300px" : undefined,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {isDesktop && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,

                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",

                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.18)",

                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🔐
                </div>
              )}

              <h2
                style={{
                  margin: 0,
                  color: "#f8fafc",
                }}
              >
                Réinitialiser un mot de passe
              </h2>
            </div>

            <p
              style={{
                color: "#94a3b8",
                margin: "12px 0 0",
                lineHeight: 1.5,
                fontSize: 12,
              }}
            >
              Attribue un mot de passe temporaire à un joueur.
              À sa prochaine connexion, il devra obligatoirement
              choisir son nouveau mot de passe.
            </p>
          </div>

          {/* =================================================
              FORMULAIRE
              ================================================= */}

          <div
            style={{
              flex: isDesktop ? "1 1 auto" : undefined,
              marginTop: isDesktop ? 0 : 18,

              display: "grid",

              gridTemplateColumns: isDesktop
                ? "minmax(220px, 1fr) minmax(220px, 1fr) auto"
                : "1fr",

              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Joueur
              </div>

              <select
                value={passwordUserId}
                onChange={(event) => {
                  setPasswordUserId(event.target.value);
                  setPasswordResetMessage("");
                }}
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "0 12px",

                  borderRadius: 11,

                  background: "#0f172a",
                  border: "1px solid rgba(148,163,184,0.18)",

                  color: "#f8fafc",
                  fontWeight: 700,
                }}
              >
                <option value="">
                  Sélectionner un joueur
                </option>

                {passwordUsers.map((player) => (
                  <option
                    key={player.id}
                    value={player.id}
                  >
                    {playerRealName(player)}
                    {player.must_change_password
                      ? " — changement en attente"
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Mot de passe temporaire
              </div>

              <input
                type="text"
                value={temporaryPassword}
                onChange={(event) => {
                  setTemporaryPassword(event.target.value);
                  setPasswordResetMessage("");
                }}
                placeholder="Minimum 8 caractères"
                autoComplete="off"
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "0 12px",

                  boxSizing: "border-box",
                  borderRadius: 11,

                  background: "#0f172a",
                  border: "1px solid rgba(148,163,184,0.18)",

                  color: "#f8fafc",
                  fontWeight: 700,
                }}
              />
            </div>

            <button
              className="button-secondary"
              onClick={resetUserPassword}
              disabled={passwordResetLoading}
              style={{
                minHeight: 44,
                whiteSpace: "nowrap",
                opacity: passwordResetLoading ? 0.65 : 1,
              }}
            >
              {passwordResetLoading
                ? "Réinitialisation..."
                : "Créer le temporaire"}
            </button>
          </div>
        </div>

        {passwordResetMessage && (
          <div
            style={{
              marginTop: 15,
              padding: "11px 13px",

              borderRadius: 11,

              background: passwordResetMessage.startsWith("✅")
                ? "rgba(34,197,94,0.08)"
                : "rgba(239,68,68,0.08)",

              border: passwordResetMessage.startsWith("✅")
                ? "1px solid rgba(34,197,94,0.20)"
                : "1px solid rgba(239,68,68,0.20)",

              color: passwordResetMessage.startsWith("✅")
                ? "#86efac"
                : "#fca5a5",

              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {passwordResetMessage}
          </div>
        )}
      </section>

   
      {/* =====================================================
          TEMPS DE SÉLECTION
          ===================================================== */}

      <section
        className="card"
        style={
          isDesktop
            ? {
                padding: "22px 26px",
                marginTop: 0,
              }
            : undefined
        }
      >
        <div
          style={{
            marginBottom: 18,

            display: isDesktop
              ? "flex"
              : "block",

            alignItems: isDesktop
              ? "flex-end"
              : undefined,

            justifyContent: isDesktop
              ? "space-between"
              : undefined,

            gap: isDesktop
              ? 20
              : undefined,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                color: "#f8fafc",
              }}
            >
              ⏱️ Temps de sélection
            </h2>

            {isDesktop && (
              <p
                style={{
                  margin: "5px 0 0",
                  color: "#64748b",
                  fontSize: 11,
                }}
              >
                Classement selon le temps
                moyen de sélection QB.
              </p>
            )}
          </div>

          {isDesktop &&
            selectionStats.length > 0 && (
              <span
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {
                  selectionStats.length
                }{" "}
                joueurs
              </span>
            )}
        </div>

        {selectionStatsLoading ? (
          <p
            style={{
              color: "#94a3b8",
              margin: 0,
            }}
          >
            Calcul des statistiques...
          </p>
        ) : selectionStatsError ? (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 14,

              background:
                "rgba(239,68,68,0.08)",

              border:
                "1px solid rgba(239,68,68,0.25)",

              color: "#fca5a5",
            }}
          >
            {selectionStatsError}
          </div>
        ) : isMobile ? (
          /* =================================================
             MOBILE — INCHANGÉ
             ================================================= */

          <div>
            {selectionStats.map(
              (row, index) => (
                <div
                  key={row.userId}
                  style={{
                    padding: "15px 0",

                    borderBottom:
                      index <
                      selectionStats.length -
                        1
                        ? "1px solid rgba(148,163,184,0.12)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",

                      justifyContent:
                        "space-between",

                      alignItems:
                        "flex-start",

                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontWeight:
                            900,

                          fontSize: 15,
                        }}
                      >
                        {playerDisplayName(
                          row.player
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 12,

                          marginTop: 2,
                        }}
                      >
                        {playerRealName(
                          row.player
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        textAlign:
                          "right",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#4ade80",

                          fontWeight:
                            900,

                          fontSize: 16,
                        }}
                      >
                        {formatDuration(
                          row.average
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 10,

                          fontWeight:
                            800,

                          marginTop: 2,
                        }}
                      >
                        MOYENNE
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",

                      gridTemplateColumns:
                        "repeat(3, minmax(0, 1fr))",

                      gap: 8,

                      marginTop: 12,
                    }}
                  >
                    <div
                      style={{
                        padding:
                          "9px 8px",

                        borderRadius:
                          11,

                        background:
                          "rgba(15,23,42,0.65)",

                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 9,

                          fontWeight:
                            900,
                        }}
                      >
                        CETTE SEM.
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.current
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding:
                          "9px 8px",

                        borderRadius:
                          11,

                        background:
                          "rgba(15,23,42,0.65)",

                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 9,

                          fontWeight:
                            900,
                        }}
                      >
                        + RAPIDE
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.fastest
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding:
                          "9px 8px",

                        borderRadius:
                          11,

                        background:
                          "rgba(15,23,42,0.65)",

                        border:
                          "1px solid rgba(148,163,184,0.10)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 9,

                          fontWeight:
                            900,
                        }}
                      >
                        + LONG
                      </div>

                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 12,

                          fontWeight:
                            800,

                          marginTop: 4,
                        }}
                      >
                        {formatDuration(
                          row.slowest
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      color: "#64748b",
                      fontSize: 10,
                    }}
                  >
                    {row.samples} sélection
                    {row.samples === 1
                      ? ""
                      : "s"}{" "}
                    comptabilisée
                    {row.samples === 1
                      ? ""
                      : "s"}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          /* =================================================
             DESKTOP / TABLETTE — TABLEAU
             ================================================= */

          <div
            style={{
              overflowX: "auto",
            }}
          >
            <div
              style={{
                minWidth: 760,
              }}
            >
              {/* =============================================
                  ENTÊTE TABLEAU
                  ============================================= */}

              <div
                style={{
                  display: "grid",

                  gridTemplateColumns:
                    "minmax(180px, 1.4fr) repeat(4, minmax(100px, 1fr)) 75px",

                  gap: 12,

                  padding:
                    "0 12px 10px",

                  color: "#64748b",

                  fontSize: 10,

                  fontWeight: 900,

                  textTransform:
                    "uppercase",

                  letterSpacing:
                    "0.35px",
                }}
              >
                <div>Joueur</div>
                <div>Moyenne</div>
                <div>Cette sem.</div>
                <div>+ rapide</div>
                <div>+ long</div>
                <div>Sem.</div>
              </div>

              {/* =============================================
                  JOUEURS
                  ============================================= */}

              {selectionStats.map(
                (row, index) => (
                  <div
                    key={row.userId}
                    style={{
                      display: "grid",

                      gridTemplateColumns:
                        "minmax(180px, 1.4fr) repeat(4, minmax(100px, 1fr)) 75px",

                      gap: 12,

                      alignItems:
                        "center",

                      padding:
                        isDesktop
                          ? "12px 12px"
                          : "13px 12px",

                      borderTop:
                        "1px solid rgba(148,163,184,0.10)",

                      background:
                        index === 0
                          ? "rgba(34,197,94,0.055)"
                          : "transparent",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color:
                            "#f8fafc",

                          fontSize: 14,

                          fontWeight:
                            900,
                        }}
                      >
                        {playerDisplayName(
                          row.player
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            "#64748b",

                          fontSize: 11,

                          marginTop: 2,
                        }}
                      >
                        {playerRealName(
                          row.player
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        color:
                          "#4ade80",

                        fontWeight:
                          900,
                      }}
                    >
                      {formatDuration(
                        row.average
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#f8fafc",

                        fontWeight:
                          800,
                      }}
                    >
                      {formatDuration(
                        row.current
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#cbd5e1",

                        fontWeight:
                          700,
                      }}
                    >
                      {formatDuration(
                        row.fastest
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#cbd5e1",

                        fontWeight:
                          700,
                      }}
                    >
                      {formatDuration(
                        row.slowest
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          "#94a3b8",

                        fontWeight:
                          800,
                      }}
                    >
                      {row.samples}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </section>

      <NotificationLog scope="regular" />
      <LifecycleActions />
      <BottomNav />
    </main>
  );
}
