"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const handleSignIn = async () => {
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage("Erreur connexion ❌ " + error.message);
    } else {
      setMessage("Connexion réussie ✅");
    }
  };

  const handleSignUp = async () => {
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setMessage("Erreur création compte ❌ " + error.message);
    } else {
      setMessage("Compte créé ✅ Tu peux maintenant te connecter.");
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

          <input
            className="input"
            type="email"
            placeholder="Ton email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="input"
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="button" onClick={handleSignIn}>
            Se connecter
          </button>

          <button
            className="button-secondary"
            onClick={handleSignUp}
            style={{ marginLeft: 10 }}
          >
            Créer mon compte
          </button>

          {message && <p>{message}</p>}
        </section>
      )}
    </main>
  );
}
