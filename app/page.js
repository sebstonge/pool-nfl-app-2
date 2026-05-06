"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Vérifie session existante
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    // Écoute login/logout
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
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
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
    <main style={{ padding: 20 }}>
      <h1>Pool NFL 🏈</h1>

      {!user ? (
        <>
          <input
            type="email"
            placeholder="Ton email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, marginRight: 10 }}
          />

          <button onClick={handleLogin} style={{ padding: 10 }}>
            Se connecter
          </button>

          <p>{message}</p>
        </>
      ) : (
        <>
          <p>Connecté : {user.email} ✅</p>

          <button onClick={handleLogout} style={{ padding: 10 }}>
            Se déconnecter
          </button>
        </>
      )}
    </main>
  );
}
