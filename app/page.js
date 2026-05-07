"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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
        <p>Choix des matchs, QB de la semaine et classements.</p>
      </section>

      {user ? (
        <>
          <section className="card">
            <p className="status-ok">Connecté : {user.email} ✅</p>
            <button className="button-secondary" onClick={handleLogout}>
              Se déconnecter
            </button>
          </section>

          <section className="nav-grid">
            <a className="nav-card" href="/matchs">
              📝 Mes choix
              <span>Choisir les gagnants et les écarts</span>
            </a>

            <a className="nav-card" href="/tous-les-choix">
              👀 Tous les choix
              <span>Voir les prédictions des autres joueurs</span>
            </a>

            <a className="nav-card" href="/qb">
              🎯 Choisir mon QB
              <span>Un QB par semaine, sans réutilisation</span>
            </a>

            <a className="nav-card" href="/classements">
              🏆 Classements
              <span>Hebdomadaire et saison</span>
            </a>

            <a className="nav-card" href="/qb-ratings">
              📊 QB Ratings
              <span>Meilleurs et pires passer ratings</span>
            </a>

            <a className="nav-card" href="/admin">
              ⚙️ Admin
              <span>Scores, QB ratings et calculs</span>
            </a>
          </section>
        </>
      ) : (
        <section className="card">
          <h2>Connexion</h2>
          <p>Entre ton email pour recevoir un lien magique.</p>

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
