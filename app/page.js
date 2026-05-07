"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function NavItem({ href, icon, title, subtitle, color }) {
  return (
    <a className="nav-card" href={href}>
      <div className="nav-icon" style={{ background: color }}>
        {icon}
      </div>
      <div>
        {title}
        <span>{subtitle}</span>
      </div>
    </a>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async () => {
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          "https://pool-nfl-app-2.vercel.app/auth/callback",
      },
    });

    if (error) {
      setMessage("Erreur ❌ " + error.message);
    } else {
      setMessage("Email envoyé 📩 Vérifie ta boîte");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <main className="page">
      <section className="header-card">
        <h1>Pool NFL 🏈</h1>
        <p>Prêt pour la semaine?</p>
      </section>

      {user ? (
        <>
          <section className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: "#22c55e",
                  color: "#052e16",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 18,
                }}
              >
                {user.email?.slice(0, 2).toUpperCase()}
              </div>

              <div style={{ flex: 1 }}>
                <strong>Salut!</strong>
                <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                  Connecté : {user.email}
                </p>
              </div>
            </div>

            <button
              className="button-secondary"
              onClick={handleLogout}
              style={{ marginTop: 14 }}
            >
              Se déconnecter
            </button>
          </section>

          <section className="nav-grid">
            <NavItem
              href="/matchs"
              icon="✅"
              title="Mes choix"
              subtitle="Faire mes prédictions"
              color="rgba(34,197,94,0.18)"
            />

            <NavItem
              href="/qb"
              icon="🎯"
              title="Choisir mon QB"
              subtitle="Choisir mon QB de la semaine"
              color="rgba(168,85,247,0.20)"
            />

            <NavItem
              href="/tous-les-choix"
              icon="👀"
              title="Tous les choix"
              subtitle="Voir les prédictions de tous"
              color="rgba(59,130,246,0.20)"
            />

            <NavItem
              href="/classements"
              icon="🏆"
              title="Classements"
              subtitle="Hebdo et saison"
              color="rgba(234,179,8,0.20)"
            />

            <NavItem
              href="/qb-ratings"
              icon="📊"
              title="QB Ratings"
              subtitle="Meilleurs et pires ratings"
              color="rgba(236,72,153,0.20)"
            />

            <NavItem
              href="/admin"
              icon="⚙️"
              title="Admin"
              subtitle="Scores, stats et calculs"
              color="rgba(148,163,184,0.18)"
            />
          </section>

          <nav className="bottom-nav">
            <a href="/">
              <strong>🏠</strong>
              Accueil
            </a>
            <a href="/matchs">
              <strong>✅</strong>
              Mes choix
            </a>
            <a href="/qb">
              <strong>🎯</strong>
              QB
            </a>
            <a href="/classements">
              <strong>🏆</strong>
              Classements
            </a>
            <a href="/tous-les-choix">
              <strong>👀</strong>
              Choix
            </a>
          </nav>
        </>
      ) : (
        <section className="card">
          <h2>Connexion</h2>
          <p style={{ color: "#94a3b8" }}>
            Entre ton email pour recevoir un lien magique.
          </p>

          <input
            className="input"
            type="email"
            placeholder="Ton email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button className="button" onClick={handleLogin}>
            Recevoir mon lien
          </button>

          {message && <p>{message}</p>}
        </section>
      )}
    </main>
  );
}
