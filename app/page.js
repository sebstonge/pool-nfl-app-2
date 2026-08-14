"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import BottomNav from "./components/BottomNav";

function NavItem({ href, icon, title, subtitle, color }) {
  return (
    <a className="nav-card home-nav-card" href={href}>
      <div
        className="nav-icon home-nav-icon"
        style={{ background: color }}
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
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [authMode, setAuthMode] = useState("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  /*
   * =========================================================
   * PROFIL
   * =========================================================
   */

  async function loadProfile(currentUser) {
    if (!currentUser) {
      setProfile(null);
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
        is_admin
      `)
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      console.error(
        "Erreur chargement profil :",
        error.message
      );
    }

    setProfile(profileData || null);

    /*
     * Le profil doit contenir :
     *
     * - display_name = username / pseudo
     * - real_name = vrai nom
     */
    if (
      !profileData ||
      !profileData.display_name?.trim() ||
      !profileData.real_name?.trim()
    ) {
      window.location.href = "/setup-profile";
      return;
    }
  }

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

      setUser(currentUser);

      if (currentUser) {
        await loadProfile(currentUser);
      }
    }

    loadSession();

    const { data: listener } =
      supabase.auth.onAuthStateChange(
        async (_event, session) => {
          const currentUser =
            session?.user ?? null;

          setUser(currentUser);

          if (currentUser) {
            await loadProfile(currentUser);
          } else {
            setProfile(null);
          }
        }
      );

    return () => {
      listener.subscription.unsubscribe();
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
      email.trim().toLowerCase();

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
        email: cleanEmail,
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

    setUser(currentUser);

    if (currentUser) {
      await loadProfile(currentUser);
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
      email.trim().toLowerCase();

    if (!cleanEmail) {
      setMessage(
        "Entre ton adresse courriel."
      );
      return;
    }

    if (password.length < 6) {
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
        email: cleanEmail,
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
          error.message || ""
        ).toLowerCase();

      if (
        text.includes("already") ||
        text.includes("registered") ||
        text.includes("exists")
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

    setUser(currentUser);

    /*
     * Création de la ligne public.users.
     *
     * display_name et real_name seront
     * remplis dans /setup-profile.
     */
    const {
      error: profileError,
    } = await supabase
      .from("users")
      .upsert(
        {
          id: currentUser.id,
          email: currentUser.email,
        },
        {
          onConflict: "id",
        }
      );

    if (profileError) {
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
        key.includes("supabase") ||
        key.includes("sb-")
      ) {
        localStorage.removeItem(
          key
        );
      }
    });

    sessionStorage.clear();

    setUser(null);
    setProfile(null);

    setTimeout(() => {
      window.location.href = "/";
    }, 200);
  }

  /*
   * =========================================================
   * AFFICHAGE
   * =========================================================
   */

  return (
    <main className="page">
      <section className="header-card">
        <h1>
          Pool NFL 🏈
        </h1>

        <p>
          Prêt pour la semaine?
        </p>
      </section>

      {user ? (
        <>
          {/* UTILISATEUR CONNECTÉ */}

          <section className="card">
            <div
              style={{
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  display: "block",
                  color: "#94a3b8",
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 3,
                }}
              >
                Connecté sous
              </span>

              <strong
                style={{
                  display: "block",
                  color: "#f8fafc",
                  fontSize: 20,
                  lineHeight: 1.15,
                }}
              >
                {profile?.display_name ||
                  user.email?.split("@")[0]}
              </strong>

              {profile?.real_name && (
                <span
                  style={{
                    display: "block",
                    marginTop: 3,
                    color: "#94a3b8",
                    fontSize: 14,
                    fontWeight: 400,
                  }}
                >
                  {profile.real_name}
                </span>
              )}

              <span
                style={{
                  display: "block",
                  marginTop: 5,
                  color: "#86efac",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                Connecté ✅
              </span>
            </div>

            <button
              type="button"
              className="button-secondary"
              onClick={handleLogout}
            >
              Se déconnecter
            </button>
          </section>

          {/* NAVIGATION */}

          <section
            className="nav-grid"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(2, minmax(0, 1fr))",
              gap: 14,
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
      ) : (
        /*
         * =====================================================
         * NON CONNECTÉ
         * =====================================================
         */

        <section className="card">
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "1fr 1fr",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setMessage("");
              }}
              style={{
                padding: "11px 12px",
                borderRadius: 12,

                border:
                  authMode === "login"
                    ? "1px solid rgba(34,197,94,0.45)"
                    : "1px solid rgba(148,163,184,0.16)",

                background:
                  authMode === "login"
                    ? "rgba(34,197,94,0.14)"
                    : "rgba(148,163,184,0.06)",

                color:
                  authMode === "login"
                    ? "#86efac"
                    : "#94a3b8",

                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Connexion
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setMessage("");
              }}
              style={{
                padding: "11px 12px",
                borderRadius: 12,

                border:
                  authMode === "signup"
                    ? "1px solid rgba(34,197,94,0.45)"
                    : "1px solid rgba(148,163,184,0.16)",

                background:
                  authMode === "signup"
                    ? "rgba(34,197,94,0.14)"
                    : "rgba(148,163,184,0.06)",

                color:
                  authMode === "signup"
                    ? "#86efac"
                    : "#94a3b8",

                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Créer un compte
            </button>
          </div>

          <h2>
            {authMode === "login"
              ? "Connexion"
              : "Créer mon compte"}
          </h2>

          <p
            style={{
              color: "#94a3b8",
            }}
          >
            {authMode === "login"
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
            disabled={loading}
          />

          <input
            className="input"
            type="password"
            autoComplete={
              authMode === "login"
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
            disabled={loading}
          />

          {authMode === "signup" && (
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer le mot de passe"
              value={confirmPassword}
              onChange={(e) =>
                setConfirmPassword(
                  e.target.value
                )
              }
              disabled={loading}
            />
          )}

          <button
            type="button"
            className="button"
            onClick={
              authMode === "login"
                ? handleLogin
                : handleSignUp
            }
            disabled={loading}
            style={{
              width: "100%",
            }}
          >
            {loading
              ? "Chargement..."
              : authMode === "login"
              ? "Se connecter"
              : "Créer mon compte"}
          </button>

          {message && (
            <p
              style={{
                marginTop: 12,

                color:
                  message.includes("✅")
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
