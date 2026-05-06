"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [status, setStatus] = useState("Test en cours...");

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        setStatus("Erreur Supabase ❌");
        console.error(error);
      } else {
        setStatus("Supabase connecté ✅");
        console.log(data);
      }
    }

    testConnection();
  }, []);

  return (
    <main style={{ padding: 20 }}>
      <h1>Pool NFL 🏈</h1>
      <p>{status}</p>
    </main>
  );
}
