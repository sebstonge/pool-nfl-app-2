"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import BottomNav from "./components/BottomNav";

function NavItem({
  href,
  icon,
  title,
  subtitle,
  color,
}) {
  return (
    <a
      className="nav-card home-nav-card"
      href={href}
    >
      <div
        className="nav-icon home-nav-icon"
        style={{
          background: color,
        }}
      >
        {icon}
      </div>

      <div className="home-nav-text">
        <strong className="home-nav-title">
          {title}
        </strong>

        <span className="home-nav-subtitle">
          {subtitle}
        </span>
      </div>
    </a>
  );
}

export default function HomePage() {
  const [user, setUser] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [authMode, setAuthMode] =
    useState("login");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [
    notificationStatus,
    setNotificationStatus,
  ] = useState("");

  const [
    notificationLoading,
    setNotificationLoading,
  ] = useState(false);

  /*
   * =========================================================
   * CHANGEMENT OBLIGATOIRE DE MOT DE PASSE
   * =========================================================
   */

  const [
    mustChangePassword,
    setMustChangePassword,
  ] = useState(false);

  const [
    temporaryPassword,
    setTemporaryPassword,
  ] = useState("");

  const [
    newPassword,
    setNewPassword,
  ] = useState("");

  const [
    newPasswordConfirm,
    setNewPasswordConfirm,
  ] = useState("");

  const [
    passwordChangeLoading,
    setPasswordChangeLoading,
  ] = useState(false);

  const [
    passwordChangeMessage,
    setPasswordChangeMessage,
  ] = useState("");

  /*
   * =========================================================
   * AFFICHAGE RESPONSIVE
   * =========================================================
   */

  const [
    isMobile,
    setIsMobile,
  ] = useState(false);

  const [
    isDesktop,
    setIsDesktop,
  ] = useState(false);

  /*
   * =========================================================
   * PROFIL
   * =========================================================
   */

  async function loadProfile(
    currentUser
  ) {
    if (!currentUser) {
      setProfile(null);
      setMustChangePassword(false);
      return;
    }

    const {
      data: profileData,
      error,
    } = await supabase
      .from("users")
      .select(`
        id,
        email,
        display_name,
        real_name,
        is_admin,
        must_change_password
      `)
      .eq(
        "id",
        currentUser.id
      )
      .maybeSingle();

    if (error) {
      console.error(
        "Erreur chargement profil :",
        error.message
      );
    }

    setProfile(
      profileData || null
    );

    setMustChangePassword(
      profileData?.must_change_password === true
    );

    /*
     * Si le joueur doit changer son mot de passe,
     * on NE le redirige nulle part.
     */
    if (
      profileData?.must_change_password === true
    ) {
      return;
    }

    /*
     * Le profil doit contenir :
     *
     * display_name = username / pseudo
     * real_name = vrai nom
     */
    if (
      !profileData ||
      !profileData.display_name?.trim() ||
      !profileData.real_name?.trim()
    ) {
      window.location.href =
        "/setup-profile";

      return;
    }
  }

  /*
   * =========================================================
   * NETTOYAGE DES PARAMÈTRES DE PARTAGE META
   * =========================================================
   */

  useEffect(() => {
    const url =
      new URL(window.location.href);

    const metaParams = [
      "fbclid",
    ];

    let changed = false;

    metaParams.forEach(
      (param) => {
        if (
          url.searchParams.has(
            param
          )
        ) {
          url.searchParams.delete(
            param
          );

          changed = true;
        }
      }
    );

    if (changed) {
      const cleanUrl =
        url.pathname +
        (url.search
          ? url.search
          : "") +
        url.hash;

      window.history.replaceState(
        {},
        "",
        cleanUrl
      );
    }
  }, []);

  /*
   * =========================================================
   * SESSION
   * =========================================================
   */

  useEffect(() => {
    async function loadSession() {
      const { data } =
        await supabase.auth.getSession();

      const currentUser =
        data.session?.user ?? null;

      setUser(
        currentUser
      );

      if (currentUser) {
        await loadProfile(
          currentUser
        );
      }
    }

    loadSession();

    const { data: listener } =
      supabase.auth.onAuthStateChange(
        async (
          _event,
          session
        ) => {
          const currentUser =
            session?.user ??
            null;

          setUser(
            currentUser
          );

          if (currentUser) {
            await loadProfile(
              currentUser
            );
          } else {
            setProfile(
              null
            );

            setMustChangePassword(
              false
            );
          }
        }
      );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  /*
   * =========================================================
   * RESPONSIVE
   * =========================================================
   */

  useEffect(() => {
    const updateResponsive = () => {
      const width =
        window.innerWidth;

      setIsMobile(
        width < 700
      );

      setIsDesktop(
        width >= 900
      );
    };

    updateResponsive();

    window.addEventListener(
      "resize",
      updateResponsive
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateResponsive
      );
    };
  }, []);

  /*
   * =========================================================
   * CONNEXION
   * =========================================================
   */

  async function handleLogin() {
    setMessage("");

    const cleanEmail =
      email
        .trim()
        .toLowerCase();

    if (!cleanEmail) {
      setMessage(
        "Entre ton adresse courriel."
      );

      return;
    }

    if (!password) {
      setMessage(
        "Entre ton mot de passe."
      );

      return;
    }

    setLoading(true);

    const {
      data,
      error,
    } =
      await supabase.auth.signInWithPassword({
        email:
          cleanEmail,

        password,
      });

    setLoading(false);

    if (error) {
      console.error(
        "Erreur connexion :",
        error.message
      );

      setMessage(
        "Courriel ou mot de passe invalide."
      );

      return;
    }

    const currentUser =
      data.user ||
      data.session?.user;

    setUser(
      currentUser
    );

    if (currentUser) {
      await loadProfile(
        currentUser
      );
    }

    setMessage("");
  }

  /*
   * =========================================================
   * CRÉATION DE COMPTE
   * =========================================================
   */

  async function handleSignUp() {
    setMessage("");

    const cleanEmail =
      email
        .trim()
        .toLowerCase();

    if (!cleanEmail) {
      setMessage(
        "Entre ton adresse courriel."
      );

      return;
    }

    if (
      password.length < 6
    ) {
      setMessage(
        "Le mot de passe doit contenir au moins 6 caractères."
      );

      return;
    }

    if (
      password !==
      confirmPassword
    ) {
      setMessage(
        "Les deux mots de passe ne correspondent pas."
      );

      return;
    }

    setLoading(true);

    const {
      data,
      error,
    } =
      await supabase.auth.signUp({
        email:
          cleanEmail,

        password,
      });

    setLoading(false);

    if (error) {
      console.error(
        "Erreur inscription :",
        error.message
      );

      const text =
        String(
          error.message ||
            ""
        ).toLowerCase();

      if (
        text.includes(
          "already"
        ) ||
        text.includes(
          "registered"
        ) ||
        text.includes(
          "exists"
        )
      ) {
        setMessage(
          "Un compte existe déjà avec ce courriel. Utilise Connexion."
        );
      } else {
        setMessage(
          "Erreur d'inscription : " +
            error.message
        );
      }

      return;
    }

    const currentUser =
      data.user ||
      data.session?.user;

    if (!currentUser) {
      setMessage(
        "Compte créé, mais aucune session n'a été ouverte. Vérifie que Confirm Email est désactivé dans Supabase."
      );

      return;
    }

    setUser(
      currentUser
    );

    /*
     * Création du profil de base.
     * Username + vrai nom seront
     * ajoutés dans /setup-profile.
     */
    const {
      error:
        profileError,
    } = await supabase
      .from("users")
      .upsert(
        {
          id:
            currentUser.id,

          email:
            currentUser.email,
        },
        {
          onConflict:
            "id",
        }
      );

    if (
      profileError
    ) {
      console.error(
        "Erreur création profil :",
        profileError.message
      );

      setMessage(
        "Erreur création du profil : " +
          profileError.message
      );

      return;
    }

    window.location.href =
      "/setup-profile";
  }

  /*
 * =========================================================
 * CHANGER LE MOT DE PASSE OBLIGATOIRE
 * =========================================================
 */

async function handleMandatoryPasswordChange() {
  setPasswordChangeMessage("");

  if (!temporaryPassword) {
    setPasswordChangeMessage(
      "Entre d'abord ton mot de passe temporaire."
    );

    return;
  }

  if (
    !newPassword ||
    newPassword.length < 8
  ) {
    setPasswordChangeMessage(
      "Le nouveau mot de passe doit contenir au moins 8 caractères."
    );

    return;
  }

  if (
    newPassword !==
    newPasswordConfirm
  ) {
    setPasswordChangeMessage(
      "Les deux nouveaux mots de passe ne correspondent pas."
    );

    return;
  }

  if (
    temporaryPassword ===
    newPassword
  ) {
    setPasswordChangeMessage(
      "Ton nouveau mot de passe doit être différent du mot de passe temporaire."
    );

    return;
  }

  setPasswordChangeLoading(true);

  try {
    /* =====================================================
       1. RÉCUPÉRER LA SESSION
       ===================================================== */

    const {
      data: sessionData,
      error: sessionError,
    } =
      await supabase.auth.getSession();

    const accessToken =
      sessionData?.session?.access_token;

    if (
      sessionError ||
      !accessToken
    ) {
      throw new Error(
        "Session introuvable. Reconnecte-toi avec ton mot de passe temporaire."
      );
    }

    /* =====================================================
       2. DEMANDER AU SERVEUR DE FAIRE LE CHANGEMENT
       ===================================================== */

    const response =
      await fetch(
        "/api/auth/password-changed",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${accessToken}`,
          },

          body: JSON.stringify({
            temporaryPassword,
            newPassword,
          }),
        }
      );

    let result = null;

    try {
      result =
        await response.json();
    } catch {
      throw new Error(
        "Réponse invalide du serveur."
      );
    }

    if (!response.ok) {
      throw new Error(
        result?.error ||
          "Impossible de modifier le mot de passe."
      );
    }

    /* =====================================================
       3. SUCCÈS
       ===================================================== */

    setTemporaryPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setPasswordChangeMessage("");

    setMustChangePassword(false);

    setProfile(
      (currentProfile) =>
        currentProfile
          ? {
              ...currentProfile,
              must_change_password:
                false,
            }
          : currentProfile
    );

    /*
     * Le mot de passe Auth a changé côté serveur.
     * On déconnecte proprement l'ancienne session.
     *
     * Le joueur pourra immédiatement vérifier
     * son nouveau mot de passe en se reconnectant.
     */

    try {
      await supabase.auth.signOut({
        scope: "local",
      });
    } catch (logoutError) {
      console.error(
        "Erreur déconnexion après changement :",
        logoutError
      );
    }

    setUser(null);
    setProfile(null);
    setMustChangePassword(false);

    setMessage(
      "✅ Mot de passe enregistré. Connecte-toi maintenant avec ton nouveau mot de passe."
    );

    setAuthMode("login");
    setPassword("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  } catch (error) {
    console.error(
      "Erreur changement mot de passe :",
      error
    );

    setPasswordChangeMessage(
      error?.message ||
        "Impossible de modifier le mot de passe."
    );
  } finally {
    setPasswordChangeLoading(false);
  }
}

  /*
   * =========================================================
   * DÉCONNEXION
   * =========================================================
   */

  async function handleLogout() {
    setMessage(
      "Déconnexion..."
    );

    try {
      await supabase.auth.signOut({
        scope: "local",
      });
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    Object.keys(
      localStorage
    ).forEach((key) => {
      if (
        key.includes(
          "supabase"
        ) ||
        key.includes(
          "sb-"
        )
      ) {
        localStorage.removeItem(
          key
        );
      }
    });

    sessionStorage.clear();

    setUser(null);
    setProfile(null);

    setMustChangePassword(
      false
    );

    setTemporaryPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setPasswordChangeMessage("");

    setTimeout(() => {
      window.location.href =
        "/";
    }, 200);
  }

  /*
   * =========================================================
   * NOTIFICATIONS PUSH
   * =========================================================
   */

  function urlBase64ToUint8Array(
    base64String
  ) {
    const padding =
      "=".repeat(
        (4 -
          (base64String.length %
            4)) %
          4
      );

    const base64 =
      (
        base64String +
        padding
      )
        .replace(
          /-/g,
          "+"
        )
        .replace(
          /_/g,
          "/"
        );

    const rawData =
      window.atob(
        base64
      );

    return Uint8Array.from(
      [...rawData].map(
        (char) =>
          char.charCodeAt(
            0
          )
      )
    );
  }

  async function handleEnableNotifications() {
    if (!user) {
      setNotificationStatus(
        "Tu dois être connecté."
      );

      return;
    }

    if (
      !(
        "serviceWorker" in
        navigator
      )
    ) {
      setNotificationStatus(
        "Les notifications ne sont pas supportées sur cet appareil."
      );

      return;
    }

    if (
      !(
        "PushManager" in
        window
      )
    ) {
      setNotificationStatus(
        "Le push n’est pas supporté sur ce navigateur."
      );

      return;
    }

    const vapidPublicKey =
      process.env
        .NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (!vapidPublicKey) {
      setNotificationStatus(
        "Clé VAPID publique manquante."
      );

      return;
    }

    setNotificationLoading(
      true
    );

    setNotificationStatus(
      ""
    );

    try {
      const registration =
        await navigator.serviceWorker.register(
          "/sw.js"
        );

      const permission =
        await Notification.requestPermission();

      if (
        permission !==
        "granted"
      ) {
        setNotificationStatus(
          "Permission refusée."
        );

        setNotificationLoading(
          false
        );

        return;
      }

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe(
            {
              userVisibleOnly:
                true,

              applicationServerKey:
                urlBase64ToUint8Array(
                  vapidPublicKey
                ),
            }
          );
      }

      const subscriptionJson =
        subscription.toJSON();

      const {
        error,
      } = await supabase
        .from(
          "push_subscriptions"
        )
        .upsert(
          {
            user_id:
              user.id,

            endpoint:
              subscription.endpoint,

            subscription:
              subscriptionJson,

            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "endpoint",
          }
        );

      if (error) {
        throw error;
      }

      setNotificationStatus(
        "✅ Notifications activées."
      );
    } catch (error) {
      console.error(
        "Erreur notifications :",
        error
      );

      setNotificationStatus(
        "Erreur lors de l’activation des notifications."
      );
    }

    setNotificationLoading(
      false
    );
  }

  /*
   * =========================================================
   * ÉTAT DES NOTIFICATIONS
   * =========================================================
   */

  useEffect(() => {
    async function checkNotificationStatus() {
      try {
        if (
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window) ||
          Notification.permission !== "granted"
        ) {
          return;
        }

        const registration =
          await navigator.serviceWorker.register(
            "/sw.js"
          );

        const subscription =
          await registration.pushManager.getSubscription();

        if (subscription) {
          setNotificationStatus(
            "✅ Notifications activées."
          );
        }
      } catch (error) {
        console.error(
          "Erreur vérification notifications :",
          error
        );
      }
    }

    checkNotificationStatus();
  }, []);

  /*
   * =========================================================
   * AFFICHAGE
   * =========================================================
   */

  return (
    <main
      className="page"
      style={
        isDesktop
          ? {
              maxWidth: 1280,
              width: "calc(100% - 48px)",
              margin: "0 auto",
              paddingTop: 112,
            }
          : undefined
      }
    >
      {/* =====================================================
          HEADER
          ===================================================== */}

      <section
        className="header-card"
        style={
          isDesktop
            ? {
                padding: "28px 32px",
                marginBottom: 20,
              }
            : undefined
        }
      >
        <h1
          style={
            isDesktop
              ? {
                  marginBottom: 6,
                }
              : undefined
          }
        >
          Pool NFL 🏈
        </h1>

        <p>
          Prêt pour la semaine?
        </p>
      </section>

      {user ? (
        <>
          {/* =================================================
              CHANGEMENT OBLIGATOIRE DU MOT DE PASSE
              ================================================= */}

          {mustChangePassword ? (
            <section
              className="card"
              style={{
                maxWidth: 620,
                marginLeft: "auto",
                marginRight: "auto",
                padding: isDesktop
                  ? "30px 32px"
                  : undefined,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 16,

                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",

                  marginBottom: 18,

                  background:
                    "rgba(245,158,11,0.12)",

                  border:
                    "1px solid rgba(245,158,11,0.22)",

                  fontSize: 25,
                }}
              >
                🔐
              </div>

              <h2
                style={{
                  margin:
                    "0 0 8px",

                  color:
                    "#f8fafc",

                  fontSize:
                    isDesktop
                      ? 25
                      : 22,
                }}
              >
                Crée ton nouveau mot de passe
              </h2>

              <p
                style={{
                  margin:
                    "0 0 22px",

                  color:
                    "#94a3b8",

                  lineHeight:
                    1.55,

                  fontSize:
                    13,
                }}
              >
                Tu es connecté avec un mot de passe temporaire.
                Entre-le une dernière fois, puis choisis ton nouveau
                mot de passe pour continuer vers le pool.
              </p>

              {/* =================================================
                  MOT DE PASSE TEMPORAIRE
                  ================================================= */}

              <div
                style={{
                  marginBottom:
                    8,

                  color:
                    "#64748b",

                  fontSize:
                    10,

                  fontWeight:
                    900,

                  textTransform:
                    "uppercase",
                }}
              >
                Mot de passe temporaire
              </div>

              <input
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="Mot de passe temporaire"
                value={
                  temporaryPassword
                }
                onChange={(event) => {
                  setTemporaryPassword(
                    event.target.value
                  );

                  setPasswordChangeMessage(
                    ""
                  );
                }}
                disabled={
                  passwordChangeLoading
                }
              />

              {/* =================================================
                  NOUVEAU MOT DE PASSE
                  ================================================= */}

              <div
                style={{
                  marginTop:
                    14,

                  marginBottom:
                    8,

                  color:
                    "#64748b",

                  fontSize:
                    10,

                  fontWeight:
                    900,

                  textTransform:
                    "uppercase",
                }}
              >
                Nouveau mot de passe
              </div>

              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Minimum 8 caractères"
                value={
                  newPassword
                }
                onChange={(event) => {
                  setNewPassword(
                    event.target.value
                  );

                  setPasswordChangeMessage(
                    ""
                  );
                }}
                disabled={
                  passwordChangeLoading
                }
              />

              {/* =================================================
                  CONFIRMATION
                  ================================================= */}

              <div
                style={{
                  marginTop:
                    14,

                  marginBottom:
                    8,

                  color:
                    "#64748b",

                  fontSize:
                    10,

                  fontWeight:
                    900,

                  textTransform:
                    "uppercase",
                }}
              >
                Confirmer le nouveau mot de passe
              </div>

              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Confirmer le mot de passe"
                value={
                  newPasswordConfirm
                }
                onChange={(event) => {
                  setNewPasswordConfirm(
                    event.target.value
                  );

                  setPasswordChangeMessage(
                    ""
                  );
                }}
                disabled={
                  passwordChangeLoading
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                      "Enter" &&
                    !passwordChangeLoading
                  ) {
                    handleMandatoryPasswordChange();
                  }
                }}
              />

              <button
                type="button"
                className="button"
                onClick={
                  handleMandatoryPasswordChange
                }
                disabled={
                  passwordChangeLoading
                }
                style={{
                  width:
                    "100%",

                  marginTop:
                    18,
                }}
              >
                {passwordChangeLoading
                  ? "Enregistrement..."
                  : "Enregistrer mon nouveau mot de passe"}
              </button>

              {passwordChangeMessage && (
                <div
                  style={{
                    marginTop:
                      14,

                    padding:
                      "11px 13px",

                    borderRadius:
                      11,

                    background:
                      "rgba(239,68,68,0.08)",

                    border:
                      "1px solid rgba(239,68,68,0.20)",

                    color:
                      "#fca5a5",

                    fontSize:
                      12,

                    fontWeight:
                      700,

                    lineHeight:
                      1.45,
                  }}
                >
                  {
                    passwordChangeMessage
                  }
                </div>
              )}

              <p
                style={{
                  margin:
                    "16px 0 0",

                  color:
                    "#64748b",

                  fontSize:
                    11,

                  lineHeight:
                    1.45,
                }}
              >
                Après l’enregistrement, le mot de passe temporaire
                ne fonctionnera plus. Utilise ton nouveau mot de
                passe lors de tes prochaines connexions.
              </p>
            </section>
          ) : (
            <>
              {/* ================================
                  UTILISATEUR CONNECTÉ
                  ================================ */}

              <section className="card">
                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      isMobile
                        ? "1fr"
                        : isDesktop
                        ? "minmax(0, 1fr) 300px"
                        : "minmax(0, 1fr) auto",

                    gap:
                      isMobile
                        ? 14
                        : isDesktop
                        ? 24
                        : 16,

                    alignItems:
                      "center",
                  }}
                >
                  <div
                    style={{
                      minWidth:
                        0,
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",

                        color:
                          "#94a3b8",

                        fontSize:
                          13,

                        fontWeight:
                          700,

                        marginBottom:
                          3,
                      }}
                    >
                      Connecté sous
                    </span>

                    <strong
                      style={{
                        display:
                          "block",

                        color:
                          "#f8fafc",

                        fontSize:
                          isMobile
                            ? 18
                            : isDesktop
                            ? 22
                            : 20,

                        fontWeight:
                          900,

                        lineHeight:
                          1.15,

                        overflowWrap:
                          "break-word",
                      }}
                    >
                      {profile?.display_name ||
                        user.email?.split(
                          "@"
                        )[0]}
                    </strong>

                    {profile?.real_name && (
                      <span
                        style={{
                          display:
                            "block",

                          marginTop:
                            3,

                          color:
                            "#94a3b8",

                          fontSize:
                            14,

                          fontWeight:
                            400,

                          lineHeight:
                            1.2,
                        }}
                      >
                        {
                          profile.real_name
                        }
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display:
                        "flex",

                      flexDirection:
                        "column",

                      gap:
                        8,

                      alignItems:
                        "stretch",
                    }}
                  >
                    <button
                      type="button"
                      className="button"
                      onClick={
                        notificationStatus.includes(
                          "✅"
                        )
                          ? undefined
                          : handleEnableNotifications
                      }
                      disabled={
                        notificationLoading ||
                        notificationStatus.includes(
                          "✅"
                        )
                      }
                      style={{
                        width:
                          isDesktop
                            ? "100%"
                            : "auto",

                        minWidth:
                          180,

                        whiteSpace:
                          "nowrap",

                        margin:
                          0,

                        background:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "#475569"
                            : undefined,

                        borderColor:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "#64748b"
                            : undefined,

                        color:
                          "#f8fafc",

                        cursor:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "default"
                            : "pointer",

                        opacity:
                          1,
                      }}
                    >
                      {notificationLoading
                        ? "Activation..."
                        : notificationStatus.includes(
                            "✅"
                          )
                        ? "✅ Notifications activées"
                        : "🔔 Activer les notifications"}
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={
                        handleLogout
                      }
                      style={{
                        width:
                          isDesktop
                            ? "100%"
                            : "auto",

                        minWidth:
                          140,

                        whiteSpace:
                          "nowrap",

                        margin:
                          0,
                      }}
                    >
                      Se déconnecter
                    </button>
                  </div>

                  {notificationStatus &&
                    !notificationStatus.includes(
                      "✅"
                    ) && (
                      <p
                        style={{
                          marginTop:
                            12,

                          marginBottom:
                            0,

                          color:
                            "#fca5a5",

                          fontSize:
                            13,

                          fontWeight:
                            700,
                        }}
                      >
                        {
                          notificationStatus
                        }
                      </p>
                    )}
                </div>
              </section>

              {/* ================================
                  NAVIGATION
                  ================================ */}

              <section
                className="nav-grid"
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    isDesktop
                      ? "repeat(3, minmax(0, 1fr))"
                      : "repeat(2, minmax(0, 1fr))",

                  gap:
                    isDesktop
                      ? 18
                      : 14,
                }}
              >
                <NavItem
                  href="/matchs"
                  icon="✅"
                  title="Mes choix"
                  subtitle="Faire mes prédictions"
                  color="rgba(34,197,94,0.18)"
                />

                <NavItem
                  href="/tous-les-choix"
                  icon="👀"
                  title="Tous les choix"
                  subtitle="Voir les prédictions de tous"
                  color="rgba(59,130,246,0.20)"
                />

                <NavItem
                  href="/qb-ratings"
                  icon="📊"
                  title="QB Ratings"
                  subtitle="Ratings et moyennes"
                  color="rgba(236,72,153,0.20)"
                />

                <NavItem
                  href="/classements"
                  icon="🏆"
                  title="Classements"
                  subtitle="Hebdo et saison"
                  color="rgba(234,179,8,0.20)"
                />

                <NavItem
                  href="/analytics"
                  icon="📈"
                  title="Statistiques"
                  subtitle="Records et statistiques"
                  color="rgba(59,130,246,0.20)"
                />

                <NavItem
                  href="/admin"
                  icon="⚙️"
                  title="Admin"
                  subtitle="Scores, stats et calculs"
                  color="rgba(148,163,184,0.18)"
                />
              </section>

              <BottomNav />
            </>
          )}
        </>
      ) : (
        /*
         * =====================================================
         * NON CONNECTÉ
         * =====================================================
         */

        <section
          className="card"
          style={
            isDesktop
              ? {
                  maxWidth: 720,
                  marginLeft: "auto",
                  marginRight: "auto",
                }
              : undefined
          }
        >
          <div
            style={{
              marginBottom:
                20,

              padding:
                "14px 16px",

              borderRadius:
                14,

              background:
                "rgba(59,130,246,0.08)",

              border:
                "1px solid rgba(59,130,246,0.18)",
            }}
          >
            <strong
              style={{
                display:
                  "block",

                color:
                  "#f8fafc",

                fontSize:
                  16,

                marginBottom:
                  5,
              }}
            >
              🏈 Pool NFL privé
            </strong>

            <p
              style={{
                margin:
                  0,

                color:
                  "#94a3b8",

                fontSize:
                  13,

                lineHeight:
                  1.5,
              }}
            >
              Application privée destinée aux participants de
              notre pool NFL. La connexion sert uniquement à
              accéder à tes choix, statistiques et classements.
            </p>
          </div>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "1fr 1fr",

              gap:
                8,

              marginBottom:
                18,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode(
                  "login"
                );

                setMessage(
                  ""
                );
              }}
              style={{
                padding:
                  "11px 12px",

                borderRadius:
                  12,

                border:
                  authMode ===
                  "login"
                    ? "1px solid rgba(34,197,94,0.45)"
                    : "1px solid rgba(148,163,184,0.16)",

                background:
                  authMode ===
                  "login"
                    ? "rgba(34,197,94,0.14)"
                    : "rgba(148,163,184,0.06)",

                color:
                  authMode ===
                  "login"
                    ? "#86efac"
                    : "#94a3b8",

                fontWeight:
                  900,

                cursor:
                  "pointer",
              }}
            >
              Connexion
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode(
                  "signup"
                );

                setMessage(
                  ""
                );
              }}
              style={{
                padding:
                  "11px 12px",

                borderRadius:
                  12,

                border:
                  authMode ===
                  "signup"
                    ? "1px solid rgba(34,197,94,0.45)"
                    : "1px solid rgba(148,163,184,0.16)",

                background:
                  authMode ===
                  "signup"
                    ? "rgba(34,197,94,0.14)"
                    : "rgba(148,163,184,0.06)",

                color:
                  authMode ===
                  "signup"
                    ? "#86efac"
                    : "#94a3b8",

                fontWeight:
                  900,

                cursor:
                  "pointer",
              }}
            >
              Créer un compte
            </button>
          </div>

          <h2>
            {authMode ===
            "login"
              ? "Connexion"
              : "Créer mon compte"}
          </h2>

          <p
            style={{
              color:
                "#94a3b8",
            }}
          >
            {authMode ===
            "login"
              ? "Entre ton courriel et ton mot de passe."
              : "Crée ton compte. Tu choisiras ensuite ton nom d’utilisateur et ton nom réel."}
          </p>

          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder="Ton courriel"
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            disabled={
              loading
            }
          />

          <input
            className="input"
            type="password"
            autoComplete={
              authMode ===
              "login"
                ? "current-password"
                : "new-password"
            }
            placeholder="Mot de passe"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            disabled={
              loading
            }
          />

          {authMode ===
            "signup" && (
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer le mot de passe"
              value={
                confirmPassword
              }
              onChange={(e) =>
                setConfirmPassword(
                  e.target.value
                )
              }
              disabled={
                loading
              }
            />
          )}

          <button
            type="button"
            className="button"
            onClick={
              authMode ===
              "login"
                ? handleLogin
                : handleSignUp
            }
            disabled={
              loading
            }
            style={{
              width:
                "100%",
            }}
          >
            {loading
              ? "Chargement..."
              : authMode ===
                "login"
              ? "Se connecter"
              : "Créer mon compte"}
          </button>

          {message && (
            <p
              style={{
                marginTop:
                  12,

                color:
                  message.includes(
                    "✅"
                  )
                    ? "#86efac"
                    : "#fca5a5",
              }}
            >
              {message}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
