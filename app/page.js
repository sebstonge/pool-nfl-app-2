"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import BottomNav from "./components/BottomNav";

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

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

useEffect(() => {
  async function loadSession() {
    const { data } = await supabase.auth.getSession();
    const currentUser = data.session?.user ?? null;

    setUser(currentUser);

    if (currentUser) {
      const { data: profile } = await supabase
        .from("users")
        .select("id, email, display_name")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!profile || !profile.display_name?.trim()) {
  window.location.href = "/setup-profile";
  return;
}
    }
  }

  loadSession();

  const { data: listener } = supabase.auth.onAuthStateChange(
    async (_event, session) => {
      const currentUser = session?.user ?? null;

      setUser(currentUser);

      if (currentUser) {
        const { data: profile } = await supabase
          .from("users")
          .select("id, email, display_name")
          .eq("id", currentUser.id)
          .maybeSingle();

      if (!profile || !profile.display_name?.trim()) {
  window.location.href = "/setup-profile";
  return;
}
      }
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
  try {
    await supabase.auth.signOut();

    localStorage.clear();
    sessionStorage.clear();

    setUser(null);

    window.location.replace("/");
  } catch (error) {
    console.error(error);
  }
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
            <p className="status-ok">Connecté : {user.email} ✅</p>

           <button
  type="button"
  className="button-secondary"
  onClick={async () => {
    alert("Déconnexion en cours");

    await supabase.auth.signOut({ scope: "global" });

    localStorage.removeItem("supabase.auth.token");
    localStorage.clear();
    sessionStorage.clear();

    window.location.href = "/auth";
  }}
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
              subtitle="Meilleurs et pires ratings"
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
