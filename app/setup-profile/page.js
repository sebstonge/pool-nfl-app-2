"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function SetupProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [realName, setRealName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const currentUser = session?.user;

      if (!currentUser) {
        router.push("/");
        return;
      }

      setUser(currentUser);

      const { data: profile, error } = await supabase
        .from("users")
        .select("display_name, real_name")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Erreur chargement profil :",
          error.message
        );
      }

      if (
        profile?.display_name?.trim() &&
        profile?.real_name?.trim()
      ) {
        router.push("/");
      }
    }

    loadUser();
  }, [router]);

  async function saveProfile() {
    const cleanDisplayName = displayName.trim();
    const cleanRealName = realName.trim();

    if (!cleanDisplayName) {
      setMessage("Entre un nom d’utilisateur.");
      return;
    }

    if (cleanDisplayName.length < 3) {
      setMessage(
        "Le nom d’utilisateur doit contenir au moins 3 caractères."
      );
      return;
    }

    if (!cleanRealName) {
      setMessage("Entre ton vrai nom.");
      return;
    }

    if (!user) {
      setMessage(
        "Session introuvable. Reconnecte-toi."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase
      .from("users")
      .upsert(
        {
          id: user.id,
          email: user.email,
          display_name: cleanDisplayName,
          real_name: cleanRealName,
        },
        {
          onConflict: "id",
        }
      );

    setLoading(false);

    if (error) {
      console.error(
        "Erreur sauvegarde profil :",
        error
      );

      setMessage(
        `Erreur : ${error.message}`
      );

      return;
    }

    router.push("/");
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Crée ton profil 🏈</h1>

        <p>
          Ton nom d’utilisateur sera affiché en premier.
          Ton vrai nom apparaîtra juste en dessous.
        </p>
      </section>

      <section className="card">
        <label
          style={{
            display: "block",
            marginBottom: 6,
            fontWeight: 800,
          }}
        >
          Nom d’utilisateur
        </label>

        <input
          className="input"
          placeholder="Ex: SKOOOOOOL"
          value={displayName}
          onChange={(e) =>
            setDisplayName(e.target.value)
          }
          maxLength={20}
          disabled={loading}
        />

        <label
          style={{
            display: "block",
            marginTop: 14,
            marginBottom: 6,
            fontWeight: 800,
          }}
        >
          Ton vrai nom
        </label>

        <input
          className="input"
          placeholder="Ex: Sébastien St-Onge"
          value={realName}
          onChange={(e) =>
            setRealName(e.target.value)
          }
          maxLength={50}
          disabled={loading}
        />

        <button
          className="button"
          onClick={saveProfile}
          disabled={loading || !user}
          style={{
            width: "100%",
            marginTop: 16,
          }}
        >
          {loading
            ? "Sauvegarde..."
            : "Continuer"}
        </button>

        {message && (
          <p
            style={{
              marginTop: 12,
              color: "#ef4444",
            }}
          >
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
