"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  const [message, setMessage] = useState("Connexion en cours...");
  const [debug, setDebug] = useState("");

  useEffect(() => {
    async function handleAuth() {
      const fullUrl = window.location.href;
      const url = new URL(fullUrl);
      const code = url.searchParams.get("code");

      setDebug(fullUrl);

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          setMessage("Erreur exchangeCode : " + error.message);
          return;
        }

        window.location.href = "/";
        return;
      }

      const { data, error } = await supabase.auth.getSession();

      if (error) {
        setMessage("Erreur session : " + error.message);
        return;
      }

      if (data.session) {
        window.location.href = "/";
        return;
      }

      setMessage("Aucune session trouvée après le lien magique.");
    }

    handleAuth();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Pool NFL 🏈</h1>
      <p>{message}</p>
      <p style={{ wordBreak: "break-all" }}>URL reçue : {debug}</p>
    </main>
  );
}
