"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function SetupProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const currentUser = session?.user;

      if (!currentUser) {
        router.push("/auth");
        return;
      }

      setUser(currentUser);

      const { data: profile, error } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Erreur chargement profil :",
          error.message
        );
      }

      if (profile?.display_name) {
        router.push("/");
      }
    }

    loadUser();
  }, [router]);

  async function saveProfile() {
    const cleanName = displayName.trim();

    if (!cleanName) {
      setMessage("Entre un nom d’utilisateur.");
      return;
    }

    if (cleanName.length < 3) {
      setMessage("Minimum 3 caractères.");
      return;
    }

    if (!user) {
      setMessage("Session introuvable. Reconnecte-toi.");
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
          display_name: cleanName,
        },
        {
          onConflict: "id",
        }
      );

    setLoading(false);

    if (error) {
      console.error(
        "Erreur sauvegarde profil :",
        error.message
      );

      setMessage(
        "Nom déjà utilisé ou invalide."
      );

      return;
    }

    router.push("/");
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Choisis ton nom 🏈</h1>

        <p>
          Ce nom sera affiché dans les
          classements et les choix.
        </p>
      </section>

      <section className="card">
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

        <button
          className="button"
          onClick={saveProfile}
          disabled={loading || !user}
          style={{
            width: "100%",
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
