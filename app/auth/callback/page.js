"use client";

import { useEffect } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  useEffect(() => {
    async function handleAuth() {
      const { error } = await supabase.auth.exchangeCodeForSession(
        window.location.href
      );

      if (error) {
        console.error("Erreur callback:", error);
      }

      // redirige vers la page principale
      window.location.href = "/";
    }

    handleAuth();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Connexion en cours...</h1>
      <p>Finalisation du login...</p>
    </main>
  );
}
