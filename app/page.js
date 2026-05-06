"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [status, setStatus] = useState("Connexion en cours...");

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .limit(1);

      if (error) {
        setStatus("Erreur Supabase ❌");
        console.error(error);
      } else {
        setStatus("Connexion Supabase OK ✅");
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
