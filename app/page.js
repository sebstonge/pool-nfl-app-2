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

  const [newPassword, setNewPassword] =
    useState("");
  const [
    confirmNewPassword,
    setConfirmNewPassword,
  ] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] =
    useState(false);

  async function loadProfile(currentUser) {
    if (!currentUser) {
      setProfile(null);
      return;
    }

    const { data: profileData, error } =
      await supabase
        .from("users")
        .select(
          "id, email, display_name, is_admin"
        )
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error) {
      console.error(
        "Erreur chargement profil :",
        error.message
      );
    }

    setProfile(profileData || null);

    if (
      !profileData ||
      !profileData.display_name?.trim()
    ) {
      window.location.href = "/setup-profile";
    }
  }

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

    const { data, error } =
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
      data.user || data.session?.user;

    setUser(currentUser);

    if (currentUser) {
      await loadProfile(currentUser);
    }

    setMessage("");
  }

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

    const { data, error } =
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
      data.user || data.session?.user;

    if (!currentUser) {
      setMessage(
        "Compte créé, mais aucune session n'a été ouverte. Vérifie que Confirm Email est désactivé dans Supabase."
      );
      return;
    }

    setUser(currentUser);

    const { error: profileError } =
      await supabase
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
    }

    window.location.href =
      "/setup-profile";
  }

  async function handleSetPassword() {
    setMessage("");

    if (!user) {
      setMessage(
        "Tu dois être connecté pour définir ton mot de passe."
      );
      return;
    }

    if (newPassword.length < 6) {
      setMessage(
        "Le nouveau mot de passe doit contenir au moins 6 caractères."
      );
      return;
    }

    if (
      newPassword !==
      confirmNewPassword
    ) {
      setMessage(
        "Les deux nouveaux mots de passe ne correspondent pas."
      );
      return;
    }

    setPasswordLoading(true);

    const { error } =
      await supabase.auth.updateUser({
        password: newPassword,
      });

    setPasswordLoading(false);

    if (error) {
      console.error(
        "Erreur mot de passe :",
        error.message
      );

      setMessage(
        "Impossible de définir le mot de passe : " +
          error.message
      );

      return;
    }

    setNewPassword("");
    setConfirmNewPassword("");

    setMessage(
      "Mot de passe enregistré ✅ Tu pourras l'utiliser lors de ta prochaine connexion."
    );
  }

  async function handleLogout() {
    setMessage("Déconnexion...");

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

    Object.keys(localStorage).forEach(
      (key) => {
        if (
          key.includes("supabase") ||
          key.includes("sb-")
        ) {
          localStorage.removeItem(key);
        }
      }
    );

    sessionStorage.clear();

    setUser(null);
    setProfile(null);

    setTimeout(() => {
      window.location.href = "/";
    }, 200);
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Pool NFL 🏈</h1>
        <p>Prêt pour la semaine?</p>
      </section>

      {user ? (
        <>
          <section className="card">
            <p className="status-ok">
              Connecté sous :{" "}
              {profile?.display_name ||
                user.email?.split("@")[0]}{" "}
              ✅
            </p>

            <button
              type="button"
              className="button-secondary"
              onClick={handleLogout}
            >
              Se déconnecter
            </button>
          </section>

          <section className="card">
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Mot de passe 🔐
            </h2>

            <p
              style={{
                color: "#94a3b8",
              }}
            >
              Si ton compte a été créé avec
              l'ancien lien magique, définis
              ici ton mot de passe. Les
              nouveaux joueurs n'ont pas
              besoin de refaire cette étape.
            </p>

            <input
              className="input"
              type="password"
              placeholder="Nouveau mot de passe"
              value={newPassword}
              onChange={(e) =>
                setNewPassword(
                  e.target.value
                )
              }
            />

            <input
              className="input"
              type="password"
              placeholder="Confirmer le mot de passe"
              value={
                confirmNewPassword
              }
              onChange={(e) =>
                setConfirmNewPassword(
                  e.target.value
                )
              }
            />

            <button
              type="button"
              className="button-secondary"
              onClick={
                handleSetPassword
              }
              disabled={
                passwordLoading
              }
            >
              {passwordLoading
                ? "Enregistrement..."
                : "Définir / changer mon mot de passe"}
            </button>

            {message && (
              <p
                style={{
                  marginTop: 12,
                }}
              >
                {message}
              </p>
            )}
          </section>

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
              : "Crée ton compte. Tu choisiras ensuite ton nom d'utilisateur."}
          </p>

          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder="Ton courriel"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
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
