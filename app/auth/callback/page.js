"use client";

import { useEffect } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  useEffect(() => {
    async function handleAuth() {
      await supabase.auth.getSession();
      window.location.href = "/";
    }

    handleAuth();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Connexion en cours...</h1>
      <p>Redirection vers le pool NFL.</p>
    </main>
  );
}
