"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  const [message, setMessage] = useState("Connexion en cours...");

  useEffect(() => {
    async function handleAuth() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (!code) {
        setMessage("Erreur : aucun code de connexion trouvé.");
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error(error);
        setMessage("Erreur de connexion : " + error.message);
        return;
      }

      window.location.href = "/";
    }

    handleAuth();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Pool NFL 🏈</h1>
      <p>{message}</p>
    </main>
  );
}
