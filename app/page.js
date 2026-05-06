"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
    });

if (error) {
  setMessage("Erreur ❌ " + error.message);
  console.error(error);
} else {
  setMessage("Email envoyé 📩 Vérifie ta boîte");
}
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>Pool NFL 🏈</h1>

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
    </main>
  );
}
